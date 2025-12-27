/**
 * Refactored WebSocket Infrastructure Service
 *
 * Pure Effect service with single connection per instance.
 * Each service consumer (LobbyService, UserService) gets its own scoped instance.
 *
 * Key Features:
 * - Single WebSocket connection per service instance
 * - Hub-based event distribution for subscribers
 * - Queue-based message processing (no Effect.runSync in callbacks)
 * - HashMap for efficient command/response correlation
 * - Schema-based encoding/decoding with type inference
 * - Layer.scoped lifecycle management
 * - Type-safe API with no `any` types
 */

import { 
  Effect, 
  Context, 
  Layer,
  Option, 
  pipe, 
  Schema as S, 
  Match,
  Deferred, 
  Ref,
  Queue,
  PubSub,
  HashMap,
  Duration,
  Either
} from 'effect'

import {
  DJCommandSchema,
  ListenerCommandSchema,
  LobbyCommandSchema,
  WebSocketEventSchema,
  type WebSocketEvent,
  type WebSocketCommand
} from '../../domain/schemas/shared/websocket.schema'

import { 
  WebSocketError, 
  WebSocketOperation,
  WsConnectionState 
} from '../../domain/schemas/connection.schema'

import { ConnectionAdapter } from '../../stores'
import { getGlobalLobbyAdapter } from '../../stores/lobby/lobby.adapter'

// We now use WebSocketCommand directly instead of a type alias

// Default timeout for WebSocket operations
const DEFAULT_WEBSOCKET_TIMEOUT = 30000

/**
 * Parsed WebSocket message with type field
 */
type ParsedMessage = {
  readonly type: string
  readonly data: unknown
}

/**
 * WebSocket Client Service Interface (shared)
 */
export interface WebSocketClientServiceImpl {
  /**
   * Connect to WebSocket server
   */
  readonly connect: (url: string) => Effect.Effect<void, WebSocketError>
  
  /**
   * Disconnect from WebSocket server
   */
  readonly disconnect: () => Effect.Effect<void>
  
  /**
   * Send command and wait for typed response
   * Schema inferred from command, expected event type inferred from T
   */
  readonly sendCommand: <T extends WebSocketEvent>(
    command: WebSocketCommand
  ) => Effect.Effect<T, WebSocketError>
  
  /**
   * Send command without waiting for response (fire and forget)
   */
  readonly sendCommandFireForget: (
    command: WebSocketCommand
  ) => Effect.Effect<void, WebSocketError>
  
  /**
   * Subscribe to events of specific type
   */
  readonly subscribe: <T extends WebSocketEvent>(
    eventType: T['type'],
    handler: (event: T) => void
  ) => Effect.Effect<() => void>
}

/**
 * Context Tag for Lobby WebSocket
 */
export class LobbyWebSocket extends Context.Tag("@app/LobbyWebSocket")<
  LobbyWebSocket,
  WebSocketClientServiceImpl
>() {}

/**
 * Context Tag for User/Room WebSocket  
 */
export class UserWebSocket extends Context.Tag("@app/UserWebSocket")<
  UserWebSocket,
  WebSocketClientServiceImpl
>() {}

/**
 * Create WebSocket error with consistent structure
 */
const createWebSocketError = (operation: WebSocketOperation, cause: string, originalError?: unknown): WebSocketError =>
  new WebSocketError({
    cause: originalError ? `${cause}: ${String(originalError)}` : cause,
    operation,
    timestamp: new Date()
  })

/**
 * Helper to get expected event type from command type
 * Maps command types to their corresponding event types using Effect for proper error handling
 */
const getExpectedEventType = (command: WebSocketCommand): Effect.Effect<string, WebSocketError> => {
  return Effect.sync(() =>
    Match.value(command).pipe(
      Match.when({ type: "announceRoom" }, () => "roomAnnounced"),
      Match.when({ type: "requestJoin" }, () => "joinRoomResponse"), 
      Match.when({ type: "refreshRooms" }, () => "refreshRooms"), // Fire-and-forget, no specific response
      Match.when({ type: "initRoom" }, () => "roomInitialized"),
      Match.when({ type: "requestDjTransport" }, () => "djTransportReady"),
      Match.when({ type: "connectDjTransport" }, () => "transportConnected"),
      Match.when({ type: "produce" }, () => "producerCreated"),
      Match.when({ type: "pauseStream" }, () => "streamPaused"),
      Match.when({ type: "resumeStream" }, () => "streamResumed"),
      Match.when({ type: "closeRoom" }, () => "roomClosed"),
      Match.when({ type: "initListener" }, () => "listenerTransportReady"),
      Match.when({ type: "getRouterCapabilities" }, () => "routerCapabilities"),
      Match.when({ type: "connectListenerTransport" }, () => "transportConnected"),
      Match.when({ type: "requestConsumer" }, () => "consumerCreated"),
      Match.when({ type: "resumeConsumer" }, () => "resumeConsumer"), // No specific response
      Match.when({ type: "leaveRoom" }, () => "roomClosed"),
      Match.exhaustive
    )
  ).pipe(
    Effect.mapError(() => createWebSocketError(
      WebSocketOperation.ENCODE,
      `Unknown command type: ${command.type}`
    ))
  )
}


/**
 * Message processing fiber
 * 
 * Processes raw messages from the queue:
 * 1. Decode using appropriate schema based on message type
 * 2. Check for pending requests and resolve Deferred
 * 3. Call registered event callback for the specific event type
 */
const createMessageProcessor = (
  messageQueue: Queue.Queue<string>,
  eventPubSub: PubSub.PubSub<ParsedMessage>,
  pendingRequests: Ref.Ref<HashMap.HashMap<string, Deferred.Deferred<unknown, WebSocketError>>>,
  eventCallbacks: Ref.Ref<HashMap.HashMap<string, (event: WebSocketEvent) => void>>
): Effect.Effect<void, never, never> =>
  pipe(
    Effect.sync(() => console.info('🎯 WebSocketClient: Message processor waiting for message...')),
    Effect.flatMap(() => {
      console.info('🔍 WebSocketClient: Taking message from queue...')
      return Queue.take(messageQueue).pipe(
        Effect.tapError((error) => Effect.sync(() => 
          console.error('❌ WebSocketClient: Queue.take failed - queue may be shut down:', error)
        ))
      )
    }),
    Effect.tap((message) => Effect.sync(() => 
      console.info('✅ WebSocketClient: Message taken from queue successfully:', message)
    )),
    Effect.flatMap(rawMessage => {
      console.info('📥 WebSocketClient: Received raw message:', rawMessage)
      return Effect.try({
        try: () => {
          const parsed = JSON.parse(rawMessage)
          console.info('✅ WebSocketClient: JSON parsed successfully:', parsed)
          return parsed
        },
        catch: (error) => {
          console.error('❌ WebSocketClient: Failed to parse JSON:', error, rawMessage)
          return {
            type: 'parse_error',
            data: { error: String(error), rawMessage }
          }
        }
      })
    }),
    Effect.flatMap(parsed => {
      // Ensure we have a proper message structure
      if (typeof parsed === 'object' && parsed !== null && 'type' in parsed) {
        const message: ParsedMessage = {
          type: String(parsed.type),
          data: parsed
        }
        
        return Effect.gen(function* () {
          const eventType = message.type
          
          // Decode using the master WebSocket event union schema
          console.info('🔍 WebSocketClient: Attempting to decode event:', eventType)
          const decodedEvent = yield* pipe(
            S.decode(WebSocketEventSchema)(parsed),
            Effect.tap(() => Effect.sync(() => 
              console.info('✅ WebSocketClient: Event decoded successfully:', eventType)
            )),
            Effect.tapError((error) =>
              Effect.sync(() => console.error('❌ WebSocketClient: Failed to decode event:', eventType, error, 'Raw data:', parsed))
            )
          )
          
          // Handle pending requests with decoded domain event
          console.info('🔍 WebSocketClient: Checking for pending requests for event:', eventType)
          const pendingMap = yield* Ref.get(pendingRequests)
          const pendingKeys = Array.from(HashMap.keys(pendingMap))
          console.info('🔍 WebSocketClient: Current pending request types:', pendingKeys)
          const maybePending = HashMap.get(pendingMap, eventType)
          
          if (Option.isSome(maybePending)) {
            console.info('✅ WebSocketClient: Found matching pending request for:', eventType)
            yield* Deferred.succeed(maybePending.value, decodedEvent)
            yield* Ref.update(pendingRequests, map => HashMap.remove(map, eventType))
            console.info('✅ WebSocketClient: Pending request resolved for:', eventType)
          } else {
            console.info('ℹ️ WebSocketClient: No pending request found for:', eventType)
          }
          
          // Handle event callbacks with decoded domain event
          const callbackMap = yield* Ref.get(eventCallbacks)
          const maybeCallback = HashMap.get(callbackMap, eventType)
          
          if (Option.isSome(maybeCallback)) {
            console.info('🎯 WebSocketClient: Found registered callback for:', eventType)
            yield* Effect.sync(() => maybeCallback.value(decodedEvent as WebSocketEvent))
          }
          
          // Always broadcast to subscribers for backward compatibility
          yield* PubSub.publish(eventPubSub, message).pipe(Effect.catchAll(() => Effect.void))
        }).pipe(
          Effect.catchAll((error) => 
            Effect.sync(() => console.error('💥 WebSocketClient: Error processing message:', message.type, error, 'Full stack:', error))
          )
        )
      } else {
        console.warn('⚠️ WebSocketClient: Received message without proper structure:', parsed)
      }
      return Effect.void
    }),
    Effect.forever,
    Effect.catchAll((error) => {
      console.error('💥 WebSocketClient: Message processor loop crashed:', error)
      return Effect.void
    })
  )

/**
 * Reconnection logic with exponential backoff and retry loop
 */
const attemptReconnection = (reconnectState: {
  lastConnectionUrl: Ref.Ref<Option.Option<string>>
  reconnectAttempts: Ref.Ref<number>
  shouldReconnect: Ref.Ref<boolean>
  maxAttempts: number
  baseDelay: number
  connectFn: (url: string) => Effect.Effect<void, WebSocketError, never>
}): Effect.Effect<void, WebSocketError, never> =>
  Effect.gen(function* () {
    const shouldReconnectValue = yield* Ref.get(reconnectState.shouldReconnect)
    const url = yield* Ref.get(reconnectState.lastConnectionUrl)
    
    if (!shouldReconnectValue || Option.isNone(url)) {
      console.info('🚫 Reconnection disabled or no URL stored')
      return
    }
    
    // Retry loop with exponential backoff
    while (true) {
      const attempts = yield* Ref.get(reconnectState.reconnectAttempts)
      
      if (attempts >= reconnectState.maxAttempts) {
        console.error(`💥 Max reconnection attempts (${reconnectState.maxAttempts}) reached. Giving up.`)
        return
      }
      
      const delay = reconnectState.baseDelay * Math.pow(2, attempts)
      console.info(`🔄 Reconnecting in ${delay}ms (attempt ${attempts + 1}/${reconnectState.maxAttempts})`)
      
      yield* Ref.update(reconnectState.reconnectAttempts, n => n + 1)
      yield* Effect.sleep(Duration.millis(delay))
      
      // Try to reconnect
      const result = yield* reconnectState.connectFn(url.value).pipe(
        Effect.either
      )
      
      if (Either.isRight(result)) {
        console.info('✅ Reconnection successful!')
        // Reset attempts counter on successful connection
        yield* Ref.set(reconnectState.reconnectAttempts, 0)
        return
      } else {
        console.warn(`⚠️ Reconnection attempt ${attempts + 1} failed:`, result.left)
        // Continue the loop to try again
      }
    }
  })

/**
 * Setup WebSocket event handlers
 * 
 * Pure handlers that only interact with Queue and Ref state.
 * No Effect.runSync calls.
 */
const setupWebSocketHandlers = (
  ws: WebSocket,
  messageQueue: Queue.Queue<string>,
  connectionState: Ref.Ref<Option.Option<WebSocket>>,
  connectionAdapter: Context.Tag.Service<ConnectionAdapter>,
  connectionType: 'lobby' | 'room',
  reconnectState?: {
    lastConnectionUrl: Ref.Ref<Option.Option<string>>
    reconnectAttempts: Ref.Ref<number>
    shouldReconnect: Ref.Ref<boolean>
    maxAttempts: number
    baseDelay: number
    connectFn: (url: string) => Effect.Effect<void, WebSocketError, never>
  },
  lobbyAdapter?: ReturnType<typeof getGlobalLobbyAdapter> | null
): Effect.Effect<void, never, never> =>
  Effect.sync(() => {
    ws.onopen = () => {
      // Connection established - update appropriate WebSocket state
      console.info('✅ WebSocket connected')
      if (connectionType === 'lobby') {
        connectionAdapter.setLobbyWSState(WsConnectionState.CONNECTED)
      } else {
        connectionAdapter.setRoomWSState(WsConnectionState.CONNECTED)
      }
    }

    ws.onclose = () => {
      Effect.runSync(Ref.set(connectionState, Option.none()))
      console.info('❌ WebSocket disconnected')
      
      // Update appropriate WebSocket state
      if (connectionType === 'lobby') {
        connectionAdapter.setLobbyWSState(WsConnectionState.DISCONNECTED)
        // Clear lobby state to prevent stale room data on reconnection
        if (lobbyAdapter) {
          console.info('🧹 WebSocketClient: Clearing lobby state on disconnect')
          lobbyAdapter.clear()
        }
      } else {
        connectionAdapter.setRoomWSState(WsConnectionState.DISCONNECTED)
      }
      
      // Attempt reconnection if state is provided
      if (reconnectState) {
        Effect.runPromise(Effect.gen(function* () {
          yield* attemptReconnection(reconnectState)
        })).catch(error => {
          console.error('❌ Reconnection completely failed:', error)
        })
      }
    }

    ws.onerror = (event) => {
      Effect.runSync(Ref.set(connectionState, Option.none()))
      console.error('💥 WebSocket error:', event)
    }

    ws.onmessage = (event) => {
      console.info('🔔 WebSocket: Raw message received, offering to queue:', event.data)
      // Only offer to queue - no other processing
      Effect.runFork(
        Queue.offer(messageQueue, event.data).pipe(
          Effect.tap(() => Effect.sync(() => 
            console.info('✅ WebSocket: Message successfully offered to queue')
          )),
          Effect.catchAll((error) => 
            Effect.sync(() => console.error('❌ WebSocket: Failed to offer message to queue:', error))
          )
        )
      )
    }
  })

/**
 * WebSocket Client Service Implementation Factory
 */
const make = (connectionType: 'lobby' | 'room') => Effect.gen(function* () {
  // Generate unique instance ID for debugging
  const instanceId = Math.random().toString(36).substring(7)
  console.warn(`🔧 WebSocketClient[${instanceId}]: Creating new ${connectionType} WebSocketClient instance`)
  
  // Get ConnectionAdapter dependency
  const connectionAdapter = yield* ConnectionAdapter
  
  // Get LobbyAdapter instance for lobby connections to clear state on disconnect  
  const lobbyAdapter = connectionType === 'lobby' ? getGlobalLobbyAdapter() : null
  
  // Core state
  const connectionState = yield* Ref.make(Option.none<WebSocket>())
  const pendingRequests = yield* Ref.make(HashMap.empty<string, Deferred.Deferred<unknown, WebSocketError>>())
  const eventCallbacks = yield* Ref.make(HashMap.empty<string, (event: WebSocketEvent) => void>())
  const messageQueue = yield* Queue.unbounded<string>()
  const eventPubSub = yield* PubSub.unbounded<ParsedMessage>()
  
  // Reconnection state
  const lastConnectionUrl = yield* Ref.make(Option.none<string>())
  const reconnectAttempts = yield* Ref.make(0)
  const shouldReconnect = yield* Ref.make(true)
  const MAX_RECONNECT_ATTEMPTS = 5
  const BASE_RECONNECT_DELAY = 1000
  
  // Start message processing fiber as daemon to prevent suspension
  console.info('🚀 WebSocketClient: Starting message processor fiber')
  const processorFiber = yield* Effect.forkDaemon(
    Effect.gen(function* () {
      console.info('🎯 WebSocketClient: Message processor fiber started successfully')
      yield* createMessageProcessor(messageQueue, eventPubSub, pendingRequests, eventCallbacks)
    }).pipe(
      Effect.catchAll((error) => 
        Effect.sync(() => console.error('💥 WebSocketClient: Message processor crashed:', error))
      )
    )
  )
  console.info('✅ WebSocketClient: Message processor daemon fiber created:', processorFiber)
  
  // Register cleanup finalizer with proper order and aggressive cleanup
  yield* Effect.addFinalizer(() => 
    Effect.gen(function* () {
      const maybeWs = yield* Ref.get(connectionState)
      console.info('🧹 WebSocketClient: Starting finalizer cleanup...')
      
      // 1. Aggressively close WebSocket connection
      if (Option.isSome(maybeWs)) {
        console.info('🧹 WebSocketClient: Force closing WebSocket connection')
        yield* Effect.sync(() => {
          const ws = maybeWs.value
          // Remove all event handlers to prevent lingering callbacks
          ws.onopen = null
          ws.onclose = null
          ws.onerror = null
          ws.onmessage = null
          // Force close with non-normal code to ensure immediate termination
          ws.close(1001, 'Service disposing')
        })
        yield* Ref.set(connectionState, Option.none())
      }
      
      // 2. Clear all pending requests immediately
      console.info('🧹 WebSocketClient: Force clearing pending requests')
      const pendingMap = yield* Ref.get(pendingRequests)
      const pendingCount = HashMap.size(pendingMap)
      if (pendingCount > 0) {
        console.info(`🧹 WebSocketClient: Force failing ${pendingCount} pending requests`)
        yield* Effect.forEach(
          HashMap.values(pendingMap),
          (deferred) => Deferred.fail(deferred, createWebSocketError(
            WebSocketOperation.SEND,
            'Service disposing - connection terminated'
          )).pipe(Effect.catchAll(() => Effect.void))
        )
      }
      yield* Ref.set(pendingRequests, HashMap.empty())
      
      // 3. Clear event callbacks
      console.info('🧹 WebSocketClient: Force clearing event callbacks')
      yield* Ref.set(eventCallbacks, HashMap.empty())
      
      // 4. Wait a bit for cleanup to propagate
      yield* Effect.sleep(50) // Shorter grace period
      
      // 5. Shutdown infrastructure
      console.info('🧹 WebSocketClient: Shutting down message queue')
      yield* Queue.shutdown(messageQueue).pipe(
        Effect.catchAll((error) => 
          Effect.sync(() => console.warn('⚠️ WebSocketClient: Queue shutdown error (may already be closed):', error))
        )
      )
      
      console.info('🧹 WebSocketClient: Shutting down event PubSub')
      yield* PubSub.shutdown(eventPubSub).pipe(
        Effect.catchAll((error) => 
          Effect.sync(() => console.warn('⚠️ WebSocketClient: PubSub shutdown error (may already be closed):', error))
        )
      )
      
      console.info('✅ WebSocketClient: Finalizer cleanup completed successfully')
    })
  )

  // Implementation with retry logic for initial connection
  const connect = (url: string): Effect.Effect<void, WebSocketError, never> =>
    Effect.gen(function* () {
      console.info(`🔌 WebSocketClient[${instanceId}]: Starting connection with retry logic to:`, url)
      
      // Check if we're already connected to this URL
      const currentWs = yield* Ref.get(connectionState)
      const currentUrl = yield* Ref.get(lastConnectionUrl)
      
      if (Option.isSome(currentWs) && Option.isSome(currentUrl) && currentUrl.value === url) {
        if (currentWs.value.readyState === WebSocket.OPEN) {
          console.info('✅ WebSocketClient: Already connected to this URL, skipping connection')
          return
        }
      }
      
      // Store URL and reset reconnection state
      yield* Ref.set(lastConnectionUrl, Option.some(url))
      yield* Ref.set(reconnectAttempts, 0)
      yield* Ref.set(shouldReconnect, true)
      
      // Retry loop for initial connection
      while (true) {
        const attempts = yield* Ref.get(reconnectAttempts)
        
        if (attempts >= MAX_RECONNECT_ATTEMPTS) {
          console.error(`💥 Max initial connection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`)
          return yield* Effect.fail(createWebSocketError(
            WebSocketOperation.CONNECT,
            'Max connection attempts reached'
          ))
        }
        
        if (attempts > 0) {
          const delay = BASE_RECONNECT_DELAY * Math.pow(2, attempts - 1)
          console.info(`🔄 Initial connection attempt ${attempts + 1}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`)
          yield* Effect.sleep(Duration.millis(delay))
        } else {
          console.info(`🔄 Initial connection attempt ${attempts + 1}/${MAX_RECONNECT_ATTEMPTS}`)
        }
        
        yield* Ref.update(reconnectAttempts, n => n + 1)
        
        // Close existing connection if any
        const existingWs = yield* Ref.get(connectionState)
        if (Option.isSome(existingWs)) {
          console.info('🔌 WebSocketClient: Closing existing connection before new connection')
          yield* Effect.sync(() => existingWs.value.close())
        }
        
        // Try to connect
        const result = yield* Effect.gen(function* () {
          console.info('🔌 WebSocketClient: Creating new WebSocket connection')
          yield* Effect.async<void, WebSocketError>((resume) => {
            try {
              const ws = new WebSocket(url)
              
              const timeoutId = setTimeout(() => {
                ws.close()
                resume(Effect.fail(createWebSocketError(
                  WebSocketOperation.CONNECT,
                  'WebSocket connection timeout'
                )))
              }, DEFAULT_WEBSOCKET_TIMEOUT)
              
              ws.onopen = () => {
                console.info('✅ WebSocketClient: Connection established successfully')
                clearTimeout(timeoutId)
                Effect.runSync(Ref.set(connectionState, Option.some(ws)))
                
                // Update connection state immediately in the callback
                console.info('🔧 WebSocketClient: Updating connection adapter state')
                if (connectionType === 'lobby') {
                  connectionAdapter.setLobbyWSState(WsConnectionState.CONNECTED)
                  console.info('✅ WebSocketClient: Lobby WebSocket state set to CONNECTED')
                } else {
                  connectionAdapter.setRoomWSState(WsConnectionState.CONNECTED)
                  console.info('✅ WebSocketClient: Room WebSocket state set to CONNECTED')
                }
                
                console.info('🔧 WebSocketClient: Setting up event handlers')
                Effect.runSync(setupWebSocketHandlers(ws, messageQueue, connectionState, connectionAdapter, connectionType, {
                  lastConnectionUrl,
                  reconnectAttempts,
                  shouldReconnect,
                  maxAttempts: MAX_RECONNECT_ATTEMPTS,
                  baseDelay: BASE_RECONNECT_DELAY,
                  connectFn: connect
                }, lobbyAdapter))
                console.info('🚀 WebSocketClient: Ready to process messages')
                resume(Effect.succeed(undefined))
              }
              
              ws.onerror = (event) => {
                clearTimeout(timeoutId)
                resume(Effect.fail(createWebSocketError(
                  WebSocketOperation.CONNECT,
                  'WebSocket connection failed',
                  event
                )))
              }
            } catch (error) {
              resume(Effect.fail(createWebSocketError(
                WebSocketOperation.CONNECT,
                'Failed to create WebSocket',
                error
              )))
            }
          })
        }).pipe(Effect.either)
        
        if (Either.isRight(result)) {
          console.info('✅ Initial connection successful!')
          // Reset attempts counter on successful connection
          yield* Ref.set(reconnectAttempts, 0)
          
          // After successful reconnection, check if we need to notify services to re-subscribe
          // This handles the case where the LobbyService called connectToLobby() once,
          // but then the WebSocket reconnected automatically
          const currentCallbacks = yield* Ref.get(eventCallbacks)
          const callbackCount = HashMap.size(currentCallbacks)
          if (callbackCount === 0 && connectionType === 'lobby') {
            console.warn('⚠️ WebSocketClient: Successful connection but no event callbacks registered. Service may need to re-subscribe.')
          }
          
          return
        } else {
          console.warn(`⚠️ Initial connection attempt ${attempts + 1} failed:`, result.left)
          // Continue the loop to try again
        }
      }
    })

  const disconnect = (): Effect.Effect<void, never, never> =>
    Effect.gen(function* () {
      console.info('🔌 WebSocketClient: Starting disconnect sequence')
      
      // Prevent auto-reconnection
      yield* Ref.set(shouldReconnect, false)
      
      // 1. Close WebSocket connection first
      const maybeWs = yield* Ref.get(connectionState)
      if (Option.isSome(maybeWs)) {
        console.info('🔌 WebSocketClient: Closing WebSocket connection')
        yield* Effect.sync(() => maybeWs.value.close())
      }
      yield* Ref.set(connectionState, Option.none())
      
      // 2. Clear pending requests to prevent memory leaks
      console.info('🔌 WebSocketClient: Clearing pending requests')
      const pendingMap = yield* Ref.get(pendingRequests)
      const pendingCount = HashMap.size(pendingMap)
      if (pendingCount > 0) {
        console.info(`🔌 WebSocketClient: Found ${pendingCount} pending requests, failing them`)
        yield* Effect.forEach(
          HashMap.values(pendingMap),
          (deferred) => Deferred.fail(deferred, createWebSocketError(
            WebSocketOperation.SEND,
            'WebSocket disconnected'
          )).pipe(Effect.catchAll(() => Effect.void))
        )
      }
      yield* Ref.set(pendingRequests, HashMap.empty())
      
      // 3. Clear event callbacks
      console.info('🔌 WebSocketClient: Clearing event callbacks')
      yield* Ref.set(eventCallbacks, HashMap.empty())
      
      console.info('✅ WebSocketClient: Disconnect sequence completed')
    })

  const sendRawMessage = (message: string): Effect.Effect<void, WebSocketError, never> =>
    Effect.gen(function* () {
      const maybeWs = yield* Ref.get(connectionState)
      const ws = yield* pipe(
        maybeWs,
        Option.match({
          onNone: () => Effect.fail(createWebSocketError(
            WebSocketOperation.SEND,
            'Not connected to WebSocket'
          )),
          onSome: (ws) => Effect.succeed(ws)
        })
      )
      
      yield* Effect.try({
        try: () => {
          if (ws.readyState !== WebSocket.OPEN) {
            throw new Error(`WebSocket not open (state: ${ws.readyState})`)
          }
          ws.send(message)
        },
        catch: (error) => createWebSocketError(
          WebSocketOperation.SEND,
          'Failed to send WebSocket message',
          error
        )
      })
    })

  const sendCommandFireForget = (command: WebSocketCommand): Effect.Effect<void, WebSocketError, never> =>
    Effect.gen(function* () {
      // Encode command using appropriate schema
      console.info('🔄 WebSocketClient: Encoding command:', command.type, command)
      const encoded = yield* pipe(
        Effect.try(() => {
          if (S.is(DJCommandSchema)(command)) {
            const result = S.encodeSync(DJCommandSchema)(command)
            console.info('✅ WebSocketClient: DJ command encoded successfully:', result)
            return result
          }
          if (S.is(ListenerCommandSchema)(command)) {
            const result = S.encodeSync(ListenerCommandSchema)(command)
            console.info('✅ WebSocketClient: Listener command encoded successfully:', result)
            return result
          }
          if (S.is(LobbyCommandSchema)(command)) {
            const result = S.encodeSync(LobbyCommandSchema)(command)
            console.info('✅ WebSocketClient: Lobby command encoded successfully:', result)
            return result
          }
          throw new Error("Unknown command type")
        }),
        Effect.mapError(error => {
          console.error('❌ WebSocketClient: Failed to encode command:', command.type, error)
          return createWebSocketError(
            WebSocketOperation.ENCODE,
            'Failed to encode command',
            error
          )
        })
      )
      yield* sendRawMessage(JSON.stringify(encoded))
    })

  const sendCommand = <T extends WebSocketEvent>(command: WebSocketCommand): Effect.Effect<T, WebSocketError, never> =>
    Effect.gen(function* () {
      // 1. Validate WebSocket connection state
      const currentWs = yield* Ref.get(connectionState)
      if (Option.isNone(currentWs)) {
        console.error('❌ WebSocketClient: Cannot send command - WebSocket not connected')
        return yield* Effect.fail(createWebSocketError(
          WebSocketOperation.SEND,
          'WebSocket not connected'
        ))
      }

      // 2. Check if WebSocket is in ready state
      if (currentWs.value.readyState !== WebSocket.OPEN) {
        console.error('❌ WebSocketClient: Cannot send command - WebSocket not in OPEN state:', currentWs.value.readyState)
        return yield* Effect.fail(createWebSocketError(
          WebSocketOperation.SEND,
          `WebSocket not ready, state: ${currentWs.value.readyState}`
        ))
      }

      console.info('✅ WebSocketClient: WebSocket connection validated for command:', command.type)
      
      const deferred = yield* Deferred.make<T, WebSocketError>()
      
      // Get expected event type using the Effect-based helper
      const eventType = yield* getExpectedEventType(command)
      
      console.info('🔄 WebSocketClient: Sending command:', command.type, 'expecting event type:', eventType)
      
      // Register pending request using expected event type as key
      yield* Ref.update(pendingRequests, map => {
        const newMap = HashMap.set(map, eventType, deferred as Deferred.Deferred<unknown, WebSocketError>)
        console.info('📋 WebSocketClient: Registered pending request for event type:', eventType, 'Total pending:', HashMap.size(newMap))
        return newMap
      })
      
      // Send command
      yield* sendCommandFireForget(command)
      
      // Wait for response with timeout
      const result = yield* Deferred.await(deferred).pipe(
        Effect.timeout(DEFAULT_WEBSOCKET_TIMEOUT),
        Effect.catchTag("TimeoutException", () => {
          // Cleanup pending request on timeout
          return Effect.gen(function* () {
            yield* Ref.update(pendingRequests, map => 
              HashMap.remove(map, eventType)
            )
            return yield* Effect.fail(createWebSocketError(
              WebSocketOperation.WAIT_FOR_EVENT,
              `Timeout waiting for response event: ${eventType}`
            ))
          })
        })
      )
      
      return result as T
    })

  const subscribe = <T extends WebSocketEvent>(
    eventType: T['type'],
    handler: (event: T) => void
  ): Effect.Effect<() => void, never, never> =>
    Effect.gen(function* () {
      console.info(`📋 WebSocketClient[${instanceId}]: Registering event callback for type:`, eventType)
      
      // Check if we already have a handler for this event type
      const currentCallbacks = yield* Ref.get(eventCallbacks)
      const existingHandler = HashMap.get(currentCallbacks, eventType)
      
      if (Option.isSome(existingHandler)) {
        console.warn(`⚠️ WebSocketClient: Replacing existing handler for event type: ${eventType}`)
      }
      
      // Register callback in the HashMap
      yield* Ref.update(eventCallbacks, map => 
        HashMap.set(map, eventType, handler as (event: WebSocketEvent) => void)
      )
      
      // Return unsubscribe function
      return () => {
        console.info('🗑️ WebSocketClient: Unregistering event callback for type:', eventType)
        Effect.runFork(
          Ref.update(eventCallbacks, map => HashMap.remove(map, eventType))
        )
      }
    })

  return {
    connect,
    disconnect,
    sendCommand,
    sendCommandFireForget,
    subscribe
  }
})

/**
 * WebSocket Client Service Implementation Factory
 * Use this to create specific instances for LobbyWebSocket and UserWebSocket
 */
export { make as createWebSocketClientService }

/**
 * Lobby WebSocket Live Layer
 */
export const LobbyWebSocketLive = Layer.scoped(
  LobbyWebSocket,
  make('lobby')
)

/**
 * User WebSocket Live Layer  
 */
export const UserWebSocketLive = Layer.scoped(
  UserWebSocket, 
  make('room')
)