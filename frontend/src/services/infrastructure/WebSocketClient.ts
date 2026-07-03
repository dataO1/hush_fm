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
 * - Heartbeat (ping/pong) for listener connections with silent-death detection
 * - Unlimited auto-reconnect with capped exponential backoff (single backoff owner)
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
   * Connect to WebSocket server (bounded initial retries; fails with error if unreachable)
   */
  readonly connect: (url: string) => Effect.Effect<void, WebSocketError>

  /**
   * Deliberately disconnect. Sets shouldReconnect=false — auto-reconnect stops permanently
   * until connect() is called again.
   */
  readonly disconnect: () => Effect.Effect<void>

  /**
   * Send command and wait for typed response.
   * Schema inferred from command, expected event type inferred from T.
   */
  readonly sendCommand: <T extends WebSocketEvent>(
    command: WebSocketCommand
  ) => Effect.Effect<T, WebSocketError>

  /**
   * Send command without waiting for response (fire and forget).
   */
  readonly sendCommandFireForget: (
    command: WebSocketCommand
  ) => Effect.Effect<void, WebSocketError>

  /**
   * Subscribe to events of specific type. Returns unsubscribe function.
   */
  readonly subscribe: <T extends WebSocketEvent>(
    eventType: T['type'],
    handler: (event: T) => void
  ) => Effect.Effect<() => void>

  /**
   * Synchronously check whether the WebSocket is currently open and ready.
   * Safe to call from any context (uses runSync on a pure Ref read).
   */
  readonly isSocketOpen: () => boolean

  /**
   * Force an immediate reconnection attempt.
   * Resets the backoff counter and closes the current socket (if open),
   * which triggers the existing onclose → attemptReconnection path.
   *
   * Simplification: if a backoff sleep is in progress in an existing loop,
   * it is NOT interrupted — the sleeping attempt will observe reconnectAttempts=0
   * on its next wake and proceed with minimum delay.
   */
  readonly forceReconnectNow: () => Effect.Effect<void, never, never>

  /**
   * Call when the browser tab regains visibility (document.visibilityState === 'visible').
   * Resets the backoff counter so the next reconnect attempt is fast.
   * If the socket is open, sends an immediate ping to probe liveness (listener URLs only).
   * If the socket is closed, calls forceReconnectNow.
   */
  readonly notifyVisibilityResume: () => Effect.Effect<void, never, never>
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
 * Helper to get expected event type from command type.
 * Maps command types to their corresponding event types.
 */
const getExpectedEventType = (command: WebSocketCommand): Effect.Effect<string, WebSocketError> => {
  return Effect.sync(() =>
    Match.value(command).pipe(
      Match.when({ type: "announceRoom" }, () => "roomAnnounced"),
      Match.when({ type: "requestJoin" }, () => "joinRoomResponse"),
      Match.when({ type: "refreshRooms" }, () => "refreshRooms"),
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
      Match.when({ type: "resumeConsumer" }, () => "resumeConsumer"),
      Match.when({ type: "leaveRoom" }, () => "roomClosed"),
      // ping is intentionally fire-and-forget — use sendCommandFireForget, not sendCommand.
      // Returning a sentinel that never matches any event type so the deferred is never
      // resolved via the pendingRequests map (card 5 uses the internal pong hook).
      Match.when({ type: "ping" }, () => "__heartbeat_no_pending_request"),
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
 * 4. Call onInternalPong hook when a 'pong' event is received (heartbeat stamp)
 */
const createMessageProcessor = (
  messageQueue: Queue.Queue<string>,
  eventPubSub: PubSub.PubSub<ParsedMessage>,
  pendingRequests: Ref.Ref<HashMap.HashMap<string, Deferred.Deferred<unknown, WebSocketError>>>,
  eventCallbacks: Ref.Ref<HashMap.HashMap<string, (event: WebSocketEvent) => void>>,
  onInternalPong?: () => Effect.Effect<void, never, never>
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
          type: String((parsed as Record<string, unknown>).type),
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

          // Internal heartbeat hook: stamp lastPongAt and reset missedPings on pong.
          // This runs after the normal callback path so external subscribers still fire first.
          if (eventType === 'pong' && onInternalPong) {
            yield* onInternalPong()
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
 * Reconnection logic — SINGLE BACKOFF OWNER for auto-reconnect after session drop.
 *
 * Retries indefinitely with capped exponential backoff (max 30 s) while
 * shouldReconnect is true.  deliberate disconnect() sets shouldReconnect=false,
 * which terminates this loop.
 *
 * connect() owns initial-connection bounded retries (user-visible error on failure).
 * attemptReconnection owns post-drop unbounded retries.
 *
 * Uses establishConnectionFn (single attempt, no inner loop) to avoid the
 * double-nested / conflicting retry pattern that existed when connect() was used.
 */
const attemptReconnection = (reconnectState: {
  lastConnectionUrl: Ref.Ref<Option.Option<string>>
  reconnectAttempts: Ref.Ref<number>
  shouldReconnect: Ref.Ref<boolean>
  baseDelay: number
  establishConnectionFn: (url: string) => Effect.Effect<void, WebSocketError, never>
}): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const shouldReconnectValue = yield* Ref.get(reconnectState.shouldReconnect)
    const url = yield* Ref.get(reconnectState.lastConnectionUrl)

    if (!shouldReconnectValue || Option.isNone(url)) {
      console.info('🚫 Reconnection disabled or no URL stored')
      return
    }

    // Unbounded retry loop — never gives up while shouldReconnect is true
    while (true) {
      const shouldContinue = yield* Ref.get(reconnectState.shouldReconnect)
      if (!shouldContinue) {
        console.info('🚫 Reconnection cancelled (shouldReconnect=false)')
        return
      }

      const attempts = yield* Ref.get(reconnectState.reconnectAttempts)
      // Capped exponential backoff: 1s → 2s → 4s → … → 30s
      const delay = Math.min(reconnectState.baseDelay * Math.pow(2, attempts), 30_000)
      console.info(`🔄 Auto-reconnect in ${delay}ms (attempt ${attempts + 1}, unbounded while shouldReconnect=true)`)

      yield* Ref.update(reconnectState.reconnectAttempts, n => n + 1)
      yield* Effect.sleep(Duration.millis(delay))

      // Re-check after sleep — user may have called disconnect() during the wait
      const stillShouldReconnect = yield* Ref.get(reconnectState.shouldReconnect)
      if (!stillShouldReconnect) {
        console.info('🚫 Reconnection cancelled after sleep (shouldReconnect=false)')
        return
      }

      const result = yield* reconnectState.establishConnectionFn(url.value).pipe(
        Effect.either
      )

      if (Either.isRight(result)) {
        console.info('✅ Auto-reconnection successful!')
        yield* Ref.set(reconnectState.reconnectAttempts, 0)
        return
      } else {
        console.warn(`⚠️ Auto-reconnect attempt ${attempts + 1} failed:`, result.left)
        // Loop continues
      }
    }
  }).pipe(
    Effect.catchAll((error) => Effect.sync(() =>
      console.error('💥 attemptReconnection loop crashed:', error)
    ))
  )

/**
 * Setup WebSocket event handlers
 *
 * Pure handlers that only interact with Queue and Ref state.
 *
 * @param reconnectCallback - Called on socket close to trigger auto-reconnect.
 *   The callback is responsible for stopping the heartbeat before reconnecting.
 */
const setupWebSocketHandlers = (
  ws: WebSocket,
  messageQueue: Queue.Queue<string>,
  connectionState: Ref.Ref<Option.Option<WebSocket>>,
  connectionAdapter: Context.Tag.Service<ConnectionAdapter>,
  connectionType: 'lobby' | 'room',
  reconnectCallback?: () => void,
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

      // Trigger auto-reconnect (stops heartbeat first, then retries indefinitely)
      if (reconnectCallback) {
        reconnectCallback()
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
        Queue.offer(messageQueue, event.data as string).pipe(
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

  // Heartbeat state — populated only for listener WebSocket connections
  // (URLs containing '/ws/listener/').  Heartbeat is never started for lobby
  // or DJ sockets because the backend Ping handler exists on the listener loop only.
  const lastPongAt = yield* Ref.make(0)    // ms timestamp; 0 = not yet received
  const missedPings = yield* Ref.make(0)   // incremented on send, reset on pong
  const heartbeatHandle = yield* Ref.make<Option.Option<ReturnType<typeof setInterval>>>(Option.none())

  // Internal pong hook — yielded by the message processor on every 'pong' event.
  // Stamps lastPongAt and resets missedPings so the heartbeat timer knows the
  // connection is alive.
  const onInternalPong = (): Effect.Effect<void, never, never> =>
    Effect.gen(function* () {
      yield* Ref.set(lastPongAt, Date.now())
      yield* Ref.set(missedPings, 0)
      console.info('💓 Heartbeat: pong received, liveness confirmed')
    })

  // Start message processing fiber as daemon to prevent suspension
  console.info('🚀 WebSocketClient: Starting message processor fiber')
  const processorFiber = yield* Effect.forkDaemon(
    Effect.gen(function* () {
      console.info('🎯 WebSocketClient: Message processor fiber started successfully')
      yield* createMessageProcessor(messageQueue, eventPubSub, pendingRequests, eventCallbacks, onInternalPong)
    }).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => console.error('💥 WebSocketClient: Message processor crashed:', error))
      )
    )
  )
  console.info('✅ WebSocketClient: Message processor daemon fiber created:', processorFiber)

  // ──────────────────────────────────────────────────────────────────
  // Core send / subscribe (defined before heartbeat so startHeartbeat
  // can close over sendCommandFireForget)
  // ──────────────────────────────────────────────────────────────────

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

  // ──────────────────────────────────────────────────────────────────
  // Heartbeat helpers
  //
  // Only active for listener WebSocket connections (URL contains '/ws/listener/').
  // The backend Ping handler lives on the listener event loop only; DJ and lobby
  // sockets do not respond to ping.
  //
  // On each 22 s tick:
  //   • If ≥ 70 s elapsed since last pong (≈ 3 missed pings), the socket is
  //     silently dead — force-close to trigger reconnect.
  //   • Otherwise send a fire-and-forget ping.  Send failure also forces close.
  //
  // 70 s threshold is generous to survive Chrome background-tab throttling,
  // which can suppress timers to ~1/min when audio focus is lost.  The heartbeat
  // is evaluated on tab resume, not in real time during suppression.
  // ──────────────────────────────────────────────────────────────────

  const stopHeartbeat = (): Effect.Effect<void, never, never> =>
    Effect.gen(function* () {
      const handle = yield* Ref.get(heartbeatHandle)
      if (Option.isSome(handle)) {
        clearInterval(handle.value)
        yield* Ref.set(heartbeatHandle, Option.none())
        console.info('💓 Heartbeat stopped')
      }
    })

  const startHeartbeat = (): Effect.Effect<void, never, never> =>
    Effect.gen(function* () {
      // Clear any existing interval first
      yield* stopHeartbeat()

      // Treat the initial connection as an implicit pong so the first tick
      // does not falsely fire the stale-socket logic
      yield* Ref.set(lastPongAt, Date.now())
      yield* Ref.set(missedPings, 0)

      const handle = setInterval(() => {
        Effect.runPromise(
          Effect.gen(function* () {
            const maybeWs = yield* Ref.get(connectionState)
            if (Option.isNone(maybeWs) || maybeWs.value.readyState !== WebSocket.OPEN) {
              // Socket already gone — the onclose callback handles reconnect
              return
            }

            const pongTs = yield* Ref.get(lastPongAt)
            const elapsed = Date.now() - pongTs

            if (elapsed > 70_000) {
              // ~3 missed pings (3 × 22 s ≈ 66 s): socket is silently dead
              console.warn(`💓 Heartbeat: no pong in ${elapsed}ms — force-closing socket to trigger reconnect`)
              yield* Ref.set(missedPings, 0)
              yield* Effect.sync(() => maybeWs.value.close())
              return
            }

            // Send ping (fire-and-forget).  Failure also indicates a dead socket.
            const ws = maybeWs.value
            yield* Ref.update(missedPings, n => n + 1)
            yield* sendCommandFireForget({ type: 'ping' } as WebSocketCommand).pipe(
              Effect.tap(() => Effect.sync(() => console.info('💓 Heartbeat: ping sent'))),
              Effect.catchAll((error) => Effect.sync(() => {
                console.warn('💓 Heartbeat: ping send failed, force-closing socket:', error)
                ws.close()
              }))
            )
          })
        ).catch(error => {
          console.error('💓 Heartbeat: timer callback error:', error)
        })
      }, 22_000)

      yield* Ref.set(heartbeatHandle, Option.some(handle))
      console.info('💓 Heartbeat started (22 s interval)')
    })

  // ──────────────────────────────────────────────────────────────────
  // Single-attempt connection helper
  //
  // Opens exactly one WebSocket, installs handlers, and starts the
  // heartbeat for listener URLs.  No retry loop — callers own retry.
  //   • connect() calls it inside a bounded initial-retry loop
  //   • attemptReconnection() calls it inside an unbounded auto-retry loop
  //
  // Guard: returns immediately (no-op) if already open to this URL,
  // preventing duplicate connections when forceReconnectNow races with
  // an in-flight reconnect loop.
  // ──────────────────────────────────────────────────────────────────

  const establishConnection = (url: string): Effect.Effect<void, WebSocketError, never> =>
    Effect.gen(function* () {
      // No-op guard: prevents duplicate connections
      const currentWs = yield* Ref.get(connectionState)
      if (Option.isSome(currentWs) && currentWs.value.readyState === WebSocket.OPEN) {
        const currentUrl = yield* Ref.get(lastConnectionUrl)
        if (Option.isSome(currentUrl) && currentUrl.value === url) {
          console.info('✅ WebSocketClient: establishConnection: already open to this URL, skipping')
          return
        }
      }

      return yield* Effect.async<void, WebSocketError>((resume) => {
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

            // Update connection state
            console.info('🔧 WebSocketClient: Updating connection adapter state')
            if (connectionType === 'lobby') {
              connectionAdapter.setLobbyWSState(WsConnectionState.CONNECTED)
              console.info('✅ WebSocketClient: Lobby WebSocket state set to CONNECTED')
            } else {
              connectionAdapter.setRoomWSState(WsConnectionState.CONNECTED)
              console.info('✅ WebSocketClient: Room WebSocket state set to CONNECTED')
            }

            // Build the reconnect callback used by the onclose handler.
            // This callback stops the heartbeat (avoids stale pings during downtime)
            // and then kicks off the unbounded auto-reconnect loop.
            const reconnectCallback = () => {
              Effect.runPromise(
                Effect.gen(function* () {
                  yield* stopHeartbeat()
                  yield* attemptReconnection({
                    lastConnectionUrl,
                    reconnectAttempts,
                    shouldReconnect,
                    baseDelay: BASE_RECONNECT_DELAY,
                    establishConnectionFn: establishConnection
                  })
                })
              ).catch(error => {
                console.error('❌ Auto-reconnection completely failed:', error)
              })
            }

            console.info('🔧 WebSocketClient: Setting up event handlers')
            Effect.runSync(setupWebSocketHandlers(
              ws,
              messageQueue,
              connectionState,
              connectionAdapter,
              connectionType,
              reconnectCallback,
              lobbyAdapter
            ))

            // Heartbeat is only enabled for listener WebSocket URLs.
            // The backend Ping handler is implemented on the listener event loop;
            // DJ and lobby WebSocket loops do not respond to ping.
            if (url.includes('/ws/listener/')) {
              Effect.runFork(startHeartbeat())
            }

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

  // ──────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────

  /**
   * Initial connection with bounded retries.
   * Returns a user-visible WebSocketError after MAX_RECONNECT_ATTEMPTS failures.
   * Does NOT call connect() recursively from attemptReconnection — that loop
   * calls establishConnection() directly, avoiding conflicting state resets.
   */
  const connect = (url: string): Effect.Effect<void, WebSocketError, never> =>
    Effect.gen(function* () {
      console.info(`🔌 WebSocketClient[${instanceId}]: Starting connection to:`, url)

      // Skip if already open to this URL
      const currentWs = yield* Ref.get(connectionState)
      const currentUrl = yield* Ref.get(lastConnectionUrl)

      if (Option.isSome(currentWs) && Option.isSome(currentUrl) && currentUrl.value === url) {
        if (currentWs.value.readyState === WebSocket.OPEN) {
          console.info('✅ WebSocketClient: Already connected to this URL, skipping connection')
          return
        }
      }

      // Store URL and arm auto-reconnect
      yield* Ref.set(lastConnectionUrl, Option.some(url))
      yield* Ref.set(reconnectAttempts, 0)
      yield* Ref.set(shouldReconnect, true)

      // Bounded retry loop for initial connection
      while (true) {
        const attempts = yield* Ref.get(reconnectAttempts)

        if (attempts >= MAX_RECONNECT_ATTEMPTS) {
          console.error(`💥 Max initial connection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`)
          return yield* Effect.fail(createWebSocketError(
            WebSocketOperation.CONNECT,
            'Max initial connection attempts reached'
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

        // Close any stale connection before attempting
        const existingWs = yield* Ref.get(connectionState)
        if (Option.isSome(existingWs)) {
          console.info('🔌 WebSocketClient: Closing existing connection before new attempt')
          yield* Effect.sync(() => existingWs.value.close())
        }

        const result = yield* establishConnection(url).pipe(Effect.either)

        if (Either.isRight(result)) {
          console.info('✅ Initial connection successful!')
          yield* Ref.set(reconnectAttempts, 0)

          // Warn if no callbacks registered (service may need to re-subscribe)
          const currentCallbacks = yield* Ref.get(eventCallbacks)
          const callbackCount = HashMap.size(currentCallbacks)
          if (callbackCount === 0 && connectionType === 'lobby') {
            console.warn('⚠️ WebSocketClient: Successful connection but no event callbacks registered. Service may need to re-subscribe.')
          }

          return
        } else {
          console.warn(`⚠️ Initial connection attempt ${attempts + 1} failed:`, result.left)
          // Continue retry loop
        }
      }
    })

  const disconnect = (): Effect.Effect<void, never, never> =>
    Effect.gen(function* () {
      console.info('🔌 WebSocketClient: Starting disconnect sequence')

      // Stop heartbeat before touching the socket
      yield* stopHeartbeat()

      // Prevent auto-reconnection — this is the key semantic of a deliberate disconnect
      yield* Ref.set(shouldReconnect, false)

      // 1. Close WebSocket connection
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

  // ──────────────────────────────────────────────────────────────────
  // Recovery hooks for application layer (consumed by card 6)
  // ──────────────────────────────────────────────────────────────────

  const isSocketOpen = (): boolean => {
    const maybeWs = Effect.runSync(Ref.get(connectionState))
    return Option.isSome(maybeWs) && maybeWs.value.readyState === WebSocket.OPEN
  }

  const forceReconnectNow = (): Effect.Effect<void, never, never> =>
    Effect.gen(function* () {
      console.info('⚡ WebSocketClient: forceReconnectNow called')
      // Reset backoff counter so the next attempt uses minimum delay
      yield* Ref.set(reconnectAttempts, 0)

      const maybeWs = yield* Ref.get(connectionState)
      if (Option.isSome(maybeWs)) {
        // Close socket; onclose → reconnectCallback → attemptReconnection (unbounded)
        yield* Effect.sync(() => maybeWs.value.close())
      } else {
        // Already disconnected — kick off reconnection loop directly
        const url = yield* Ref.get(lastConnectionUrl)
        if (Option.isSome(url)) {
          yield* Effect.forkDaemon(
            attemptReconnection({
              lastConnectionUrl,
              reconnectAttempts,
              shouldReconnect,
              baseDelay: BASE_RECONNECT_DELAY,
              establishConnectionFn: establishConnection
            })
          ).pipe(Effect.asVoid)
        }
      }
    })

  const notifyVisibilityResume = (): Effect.Effect<void, never, never> =>
    Effect.gen(function* () {
      console.info('👁️ WebSocketClient: notifyVisibilityResume — tab visible again')
      // Reset backoff so any reconnect attempt is fast
      yield* Ref.set(reconnectAttempts, 0)

      const maybeWs = yield* Ref.get(connectionState)
      const urlOpt = yield* Ref.get(lastConnectionUrl)
      // Only probe via ping on listener connections (backend ping handler is listener-only)
      const isListenerUrl = Option.isSome(urlOpt) && urlOpt.value.includes('/ws/listener/')

      if (Option.isSome(maybeWs) && maybeWs.value.readyState === WebSocket.OPEN) {
        // Socket appears open — send a probe ping to confirm liveness
        if (isListenerUrl) {
          yield* sendCommandFireForget({ type: 'ping' } as WebSocketCommand).pipe(
            Effect.catchAll((error) => Effect.sync(() =>
              console.warn('👁️ WebSocketClient: visibility resume ping failed:', error)
            ))
          )
        }
      } else {
        // Socket is down — reconnect immediately
        yield* forceReconnectNow()
      }
    })

  // Register cleanup finalizer
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      const maybeWs = yield* Ref.get(connectionState)
      console.info('🧹 WebSocketClient: Starting finalizer cleanup...')

      // 0. Stop heartbeat
      yield* stopHeartbeat()

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
      yield* Effect.sleep(50)

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

  return {
    connect,
    disconnect,
    sendCommand,
    sendCommandFireForget,
    subscribe,
    isSocketOpen,
    forceReconnectNow,
    notifyVisibilityResume
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
