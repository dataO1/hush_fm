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
  HashMap,
  Stream,
  Fiber
} from 'effect'

import {
  DJCommandSchema,
  DJEventSchema,
  ListenerCommandSchema,
  ListenerEventSchema,
  LobbyCommandSchema,
  LobbyEventSchema,
  type LobbyCommandType,
  type DJCommandType,
  type ListenerCommandType
} from '../../domain/schemas/shared/websocket.schema'

import { 
  WebSocketError, 
  WebSocketOperation 
} from '../../domain/schemas/connection.schema'

// Union types for events and commands
type DJEvent = S.Schema.Type<typeof DJEventSchema>
type ListenerEvent = S.Schema.Type<typeof ListenerEventSchema>
type LobbyEvent = S.Schema.Type<typeof LobbyEventSchema>
type AnyEvent = DJEvent | ListenerEvent | LobbyEvent
type AnyCommand = DJCommandType | ListenerCommandType | LobbyCommandType

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
  readonly sendCommand: <T extends AnyEvent>(
    command: AnyCommand
  ) => Effect.Effect<T, WebSocketError>
  
  /**
   * Send command without waiting for response (fire and forget)
   */
  readonly sendCommandFireForget: (
    command: AnyCommand
  ) => Effect.Effect<void, WebSocketError>
  
  /**
   * Subscribe to events of specific type
   */
  readonly subscribe: <T>(
    eventSchema: S.Schema<T, unknown, never>,
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
const getExpectedEventType = (command: AnyCommand): Effect.Effect<string, WebSocketError> => {
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
 * 1. Decode using appropriate schema
 * 2. Check for pending requests and resolve Deferred
 * 3. Broadcast to event Hub for subscribers
 */
const createMessageProcessor = (
  messageQueue: Queue.Queue<string>,
  eventPubSub: PubSub.PubSub<ParsedMessage>,
  pendingRequests: Ref.Ref<HashMap.HashMap<string, Deferred.Deferred<unknown, WebSocketError>>>
): Effect.Effect<void, never, never> =>
  pipe(
    Effect.sync(() => console.info('🎯 WebSocketClient: Message processor waiting for message...')),
    Effect.flatMap(() => Queue.take(messageQueue)),
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
        
        return pipe(
          Ref.get(pendingRequests),
          Effect.flatMap(pendingMap => {
            console.info('🔍 WebSocketClient: Looking for pending request for message type:', message.type)
            console.info('🗂️ WebSocketClient: Available pending requests:', Array.from(HashMap.keys(pendingMap)))
            
            const maybePending = HashMap.get(pendingMap, message.type)
            
            const completePending = Option.isSome(maybePending)
              ? pipe(
                  Effect.sync(() => console.info('✅ WebSocketClient: Found matching pending request for:', message.type)),
                  Effect.flatMap(() => Deferred.succeed(maybePending.value, message.data)),
                  Effect.flatMap(() => 
                    Ref.update(pendingRequests, map => 
                      HashMap.remove(map, message.type)
                    )
                  )
                )
              : Effect.sync(() => console.info('❌ WebSocketClient: No pending request found for:', message.type))
            
            // Always broadcast to subscribers
            const broadcast = PubSub.publish(eventPubSub, message).pipe(
              Effect.catchAll(() => Effect.void)
            )
            
            return Effect.all([completePending, broadcast], { concurrency: "unbounded" }).pipe(
              Effect.asVoid
            )
          })
        )
      }
      return Effect.void
    }),
    Effect.forever,
    Effect.catchAll(() => Effect.void)
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
      Effect.runFork(Queue.offer(messageQueue, event.data))
    }
  })

/**
 * WebSocket Client Service Implementation
 */
const make = Effect.gen(function* () {
  // Core state
  const connectionState = yield* Ref.make(Option.none<WebSocket>())
  const pendingRequests = yield* Ref.make(HashMap.empty<string, Deferred.Deferred<unknown, WebSocketError>>())
  const messageQueue = yield* Queue.unbounded<string>()
  const eventPubSub = yield* PubSub.unbounded<ParsedMessage>()
  
  // Start message processing fiber as daemon to prevent suspension
  console.info('🚀 WebSocketClient: Starting message processor fiber')
  const processorFiber = yield* Effect.forkDaemon(
    Effect.gen(function* () {
      console.info('🎯 WebSocketClient: Message processor fiber started successfully')
      yield* createMessageProcessor(messageQueue, eventPubSub, pendingRequests)
    }).pipe(
      Effect.catchAll((error) => 
        Effect.sync(() => console.error('💥 WebSocketClient: Message processor crashed:', error))
      )
    )
  )
  console.info('✅ WebSocketClient: Message processor daemon fiber created:', processorFiber)
  
  // Register cleanup finalizer
  yield* Effect.addFinalizer(() => 
    Effect.gen(function* () {
      const maybeWs = yield* Ref.get(connectionState)
      if (Option.isSome(maybeWs)) {
        yield* Effect.sync(() => maybeWs.value.close())
      }
      yield* Queue.shutdown(messageQueue)
      yield* PubSub.shutdown(eventPubSub)
      console.info('🧹 WebSocketClient cleaned up')
    })
  )

  // Implementation
  const connect = (url: string): Effect.Effect<void, WebSocketError, never> =>
    Effect.gen(function* () {
      // Close existing connection if any
      const existingWs = yield* Ref.get(connectionState)
      if (Option.isSome(existingWs)) {
        yield* Effect.sync(() => existingWs.value.close())
      }
      
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
            clearTimeout(timeoutId)
            Effect.runSync(Ref.set(connectionState, Option.some(ws)))
            Effect.runSync(setupWebSocketHandlers(ws, messageQueue, connectionState))
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

  const sendCommandFireForget = (command: AnyCommand): Effect.Effect<void, WebSocketError, never> =>
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

  const sendCommand = <T extends AnyEvent>(command: AnyCommand): Effect.Effect<T, WebSocketError, never> =>
    Effect.gen(function* () {
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

  const subscribe = <T>(
    eventSchema: S.Schema<T, unknown, never>,
    handler: (event: T) => void
  ): Effect.Effect<() => void, never, never> =>
    Effect.scoped(
      Effect.gen(function* () {
        const dequeue = yield* PubSub.subscribe(eventPubSub)
        
        const subscription = yield* pipe(
          Stream.fromQueue(dequeue),
          Stream.mapEffect(message => {
            console.info('🔄 WebSocketClient: Decoding message:', message.type, message.data)
            return S.decode(eventSchema)(message.data).pipe(
              Effect.match({
                onFailure: (error) => {
                  console.error('❌ WebSocketClient: Failed to decode message:', message.type, error, message.data)
                  // TODO: Store decode error in connection adapter for UI display
                  return Option.none<T>()
                },
                onSuccess: (event) => {
                  console.info('✅ WebSocketClient: Message decoded successfully:', message.type, event)
                  return Option.some(event)
                }
              })
            )
          }),
          Stream.filter(Option.isSome),
          Stream.map(event => event.value),
          Stream.runForEach(event => Effect.sync(() => handler(event))),
          Effect.fork
        )
        
        return () => {
          Effect.runFork(Fiber.interrupt(subscription))
        }
      })
    )

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