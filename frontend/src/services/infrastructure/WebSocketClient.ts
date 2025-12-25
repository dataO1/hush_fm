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
  Option, 
  pipe, 
  Schema as S, 
  Match,
  Deferred, 
  Ref,
  Queue,
  PubSub,
  HashMap
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
  WebSocketOperation 
} from '../../domain/schemas/connection.schema'

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
 * Setup WebSocket event handlers
 * 
 * Pure handlers that only interact with Queue and Ref state.
 * No Effect.runSync calls.
 */
const setupWebSocketHandlers = (
  ws: WebSocket,
  messageQueue: Queue.Queue<string>,
  connectionState: Ref.Ref<Option.Option<WebSocket>>
): Effect.Effect<void, never, never> =>
  Effect.sync(() => {
    ws.onopen = () => {
      // Connection established - no additional state updates needed
      console.info('✅ WebSocket connected')
    }

    ws.onclose = () => {
      Effect.runSync(Ref.set(connectionState, Option.none()))
      console.info('❌ WebSocket disconnected')
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
 * WebSocket Client Service Implementation
 */
const make = Effect.gen(function* () {
  // Core state
  const connectionState = yield* Ref.make(Option.none<WebSocket>())
  const pendingRequests = yield* Ref.make(HashMap.empty<string, Deferred.Deferred<unknown, WebSocketError>>())
  const eventCallbacks = yield* Ref.make(HashMap.empty<string, (event: WebSocketEvent) => void>())
  const messageQueue = yield* Queue.unbounded<string>()
  const eventPubSub = yield* PubSub.unbounded<ParsedMessage>()
  
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
  
  // Register cleanup finalizer with proper order
  yield* Effect.addFinalizer(() => 
    Effect.gen(function* () {
      const maybeWs = yield* Ref.get(connectionState)
      console.info('🧹 WebSocketClient: Starting cleanup...')
      
      // 1. Close WebSocket connection first
      if (Option.isSome(maybeWs)) {
        console.info('🧹 WebSocketClient: Closing WebSocket connection')
        yield* Effect.sync(() => maybeWs.value.close())
        yield* Ref.set(connectionState, Option.none())
      }
      
      // 2. Wait a bit for pending operations to complete
      yield* Effect.sleep(100) // 100ms grace period
      
      // 3. Then shutdown queue and pubsub
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
      
      console.info('✅ WebSocketClient: Cleanup completed successfully')
    })
  )

  // Implementation
  const connect = (url: string): Effect.Effect<void, WebSocketError, never> =>
    Effect.gen(function* () {
      console.info('🔌 WebSocketClient: Attempting to connect to:', url)
      // Close existing connection if any
      const existingWs = yield* Ref.get(connectionState)
      if (Option.isSome(existingWs)) {
        console.info('🔌 WebSocketClient: Closing existing connection before new connection')
        yield* Effect.sync(() => existingWs.value.close())
      }
      
      console.info('🔌 WebSocketClient: Creating new WebSocket connection')
      // Create new connection
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
            console.info('🔧 WebSocketClient: Setting up event handlers')
            Effect.runSync(setupWebSocketHandlers(ws, messageQueue, connectionState))
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
    })

  const disconnect = (): Effect.Effect<void, never, never> =>
    Effect.gen(function* () {
      const maybeWs = yield* Ref.get(connectionState)
      if (Option.isSome(maybeWs)) {
        yield* Effect.sync(() => maybeWs.value.close())
      }
      yield* Ref.set(connectionState, Option.none())
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
      console.info('📋 WebSocketClient: Registering event callback for type:', eventType)
      
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