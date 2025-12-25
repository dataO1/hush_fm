/**
 * WebSocket Infrastructure Service
 *
 * Lazy-loaded stateful service for WebSocket connections.
 * Manages connection state internally and updates ConnectionAdapter.
 *
 * Responsibilities:
 * - WebSocket connection lifecycle management
 * - Internal URL and connection state storage
 * - Message sending/receiving with automatic encoding/decoding
 * - Connection state synchronization with ConnectionAdapter
 * - Minimal exposed interface for application services
 */

import { Effect, Context, Layer, Option, pipe, Schema as S } from 'effect'
import {
  DJCommandSchema,
  DJEventSchema,
  ListenerCommandSchema,
  ListenerEventSchema,
  LobbyCommandSchema,
  LobbyEventSchema,
  type LobbyCommandType,
  type DJCommandType,
  type ListenerCommandType,
  // Event Type Enums
  WEBSOCKET_DJ_EVENT_TYPES,
  type WebSocketDJEventType,
  WEBSOCKET_LOBBY_EVENT_TYPES,
  type WebSocketLobbyEventType,
  WEBSOCKET_LISTENER_EVENT_TYPES,
  type WebSocketListenerEventType,
  // Individual DJ Event Schemas for proper type narrowing
  RoomInitializedEventSchema,
  DjTransportReadyEventSchema,
  TransportConnectedEventSchema,
  ProducerCreatedEventSchema,
  StreamPausedEventSchema,
  StreamResumedEventSchema,
  RoomClosedEventSchema,
  DJCommandFailedEventSchema,
  RoomNotFoundEventSchema,
  // Individual Listener Event Schemas for proper type narrowing
  JoinReadyEventSchema,
  ListenerTransportReadyEventSchema,
  ListenerTransportConnectedEventSchema,
  ConsumerCreatedEventSchema,
  RouterCapabilitiesEventSchema,
  ListenerCountUpdatedEventSchema,
  ListenerStreamPausedEventSchema,
  ListenerStreamResumedEventSchema,
  ListenerRoomClosedEventSchema,
  ListenerCommandFailedEventSchema,
  ListenerRoomNotFoundEventSchema,
  // Individual Lobby Event Schemas for proper type narrowing
  RoomAnnouncedEventSchema,
  RoomAddedEventSchema,
  RoomUpdatedEventSchema,
  RoomRemovedEventSchema,
  JoinRoomResponseEventSchema
} from '../../domain/schemas/shared/websocket.schema'
import { 
  WebSocketError, 
  WebSocketOperation, 
  WsConnectionState 
} from '../../domain/schemas/connection.schema'
import { ConnectionAdapter } from '../../stores'

// Union types for events (use Schema.Type for receiving)
type DJEvent = S.Schema.Type<typeof DJEventSchema>
type ListenerEvent = S.Schema.Type<typeof ListenerEventSchema>
type LobbyEvent = S.Schema.Type<typeof LobbyEventSchema>

/**
 * WebSocket Service Interface
 * 
 * Minimal interface exposing only essential methods.
 * All connection state is managed internally.
 */
interface WebSocketClientServiceImpl {
  /**
   * Lobby connection management
   */
  readonly connectLobby: (url: string) => Effect.Effect<void, WebSocketError, ConnectionAdapter>
  readonly disconnectLobby: () => Effect.Effect<void, never, ConnectionAdapter>
  
  /**
   * Room connection management
   */
  readonly connectRoom: (url: string) => Effect.Effect<void, WebSocketError, ConnectionAdapter>
  readonly disconnectRoom: () => Effect.Effect<void, never, ConnectionAdapter>

  /**
   * Send DJ command (includes type field for discrimination)
   */
  readonly sendDJCommand: (command: DJCommandType) => Effect.Effect<void, WebSocketError, never>

  /**
   * Send Listener command (includes type field for discrimination)
   */
  readonly sendListenerCommand: (command: ListenerCommandType) => Effect.Effect<void, WebSocketError, never>

  /**
   * Send Lobby command (includes type field for discrimination)
   */
  readonly sendLobbyCommand: (command: LobbyCommandType) => Effect.Effect<void, WebSocketError, never>

  /**
   * Subscribe to DJ events
   */
  readonly subscribeDJEvents: (handler: (event: DJEvent) => void) => Effect.Effect<() => void, WebSocketError, never>

  /**
   * Subscribe to Listener events
   */
  readonly subscribeListenerEvents: (handler: (event: ListenerEvent) => void) => Effect.Effect<() => void, WebSocketError, never>

  /**
   * Subscribe to Lobby events
   */
  readonly subscribeLobbyEvents: (handler: (event: LobbyEvent) => void) => Effect.Effect<() => void, WebSocketError, never>

  /**
   * Wait for specific DJ event type with timeout - overloaded for type safety
   */
  // Individual overloaded functions - each returns a specific type
  readonly waitForDJEvent: {
    (eventType: typeof WEBSOCKET_DJ_EVENT_TYPES.ROOM_INITIALIZED, timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof RoomInitializedEventSchema>, WebSocketError, never>
    (eventType: typeof WEBSOCKET_DJ_EVENT_TYPES.DJ_TRANSPORT_READY, timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof DjTransportReadyEventSchema>, WebSocketError, never>
    (eventType: typeof WEBSOCKET_DJ_EVENT_TYPES.TRANSPORT_CONNECTED, timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof TransportConnectedEventSchema>, WebSocketError, never>
    (eventType: typeof WEBSOCKET_DJ_EVENT_TYPES.PRODUCER_CREATED, timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof ProducerCreatedEventSchema>, WebSocketError, never>
    (eventType: typeof WEBSOCKET_DJ_EVENT_TYPES.STREAM_PAUSED, timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof StreamPausedEventSchema>, WebSocketError, never>
    (eventType: typeof WEBSOCKET_DJ_EVENT_TYPES.STREAM_RESUMED, timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof StreamResumedEventSchema>, WebSocketError, never>
    (eventType: typeof WEBSOCKET_DJ_EVENT_TYPES.ROOM_CLOSED, timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof RoomClosedEventSchema>, WebSocketError, never>
    (eventType: typeof WEBSOCKET_DJ_EVENT_TYPES.DJ_COMMAND_FAILED, timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof DJCommandFailedEventSchema>, WebSocketError, never>
    (eventType: typeof WEBSOCKET_DJ_EVENT_TYPES.ROOM_NOT_FOUND, timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof RoomNotFoundEventSchema>, WebSocketError, never>
  }

  /**
   * Wait for specific Listener event type with timeout - overloaded for type safety
   */
  // Individual overloaded functions - each returns a specific type
  readonly waitForListenerEvent: {
    (eventType: typeof WEBSOCKET_LISTENER_EVENT_TYPES.JOIN_READY, timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof JoinReadyEventSchema>, WebSocketError, never>
    (eventType: typeof WEBSOCKET_LISTENER_EVENT_TYPES.LISTENER_TRANSPORT_READY, timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof ListenerTransportReadyEventSchema>, WebSocketError, never>
    (eventType: typeof WEBSOCKET_LISTENER_EVENT_TYPES.TRANSPORT_CONNECTED, timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof ListenerTransportConnectedEventSchema>, WebSocketError, never>
    (eventType: typeof WEBSOCKET_LISTENER_EVENT_TYPES.CONSUMER_CREATED, timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof ConsumerCreatedEventSchema>, WebSocketError, never>
    (eventType: typeof WEBSOCKET_LISTENER_EVENT_TYPES.ROUTER_CAPABILITIES, timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof RouterCapabilitiesEventSchema>, WebSocketError, never>
    (eventType: typeof WEBSOCKET_LISTENER_EVENT_TYPES.LISTENER_COUNT_UPDATED, timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof ListenerCountUpdatedEventSchema>, WebSocketError, never>
    (eventType: typeof WEBSOCKET_LISTENER_EVENT_TYPES.STREAM_PAUSED, timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof ListenerStreamPausedEventSchema>, WebSocketError, never>
    (eventType: typeof WEBSOCKET_LISTENER_EVENT_TYPES.STREAM_RESUMED, timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof ListenerStreamResumedEventSchema>, WebSocketError, never>
    (eventType: typeof WEBSOCKET_LISTENER_EVENT_TYPES.ROOM_CLOSED, timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof ListenerRoomClosedEventSchema>, WebSocketError, never>
    (eventType: typeof WEBSOCKET_LISTENER_EVENT_TYPES.LISTENER_COMMAND_FAILED, timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof ListenerCommandFailedEventSchema>, WebSocketError, never>
    (eventType: typeof WEBSOCKET_LISTENER_EVENT_TYPES.ROOM_NOT_FOUND, timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof ListenerRoomNotFoundEventSchema>, WebSocketError, never>
  }

  /**
   * Wait for specific Lobby event type with timeout - overloaded for type safety
   */
  // Individual overloaded functions - each returns a specific type
  readonly waitForLobbyEvent: {
    (eventType: typeof WEBSOCKET_LOBBY_EVENT_TYPES.ROOM_ANNOUNCED, timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof RoomAnnouncedEventSchema>, WebSocketError, never>
    (eventType: typeof WEBSOCKET_LOBBY_EVENT_TYPES.ROOM_ADDED, timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof RoomAddedEventSchema>, WebSocketError, never>
    (eventType: typeof WEBSOCKET_LOBBY_EVENT_TYPES.ROOM_UPDATED, timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof RoomUpdatedEventSchema>, WebSocketError, never>
    (eventType: typeof WEBSOCKET_LOBBY_EVENT_TYPES.ROOM_REMOVED, timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof RoomRemovedEventSchema>, WebSocketError, never>
    (eventType: typeof WEBSOCKET_LOBBY_EVENT_TYPES.JOIN_APPROVED, timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof JoinRoomResponseEventSchema>, WebSocketError, never>
  }
}

/**
 * WebSocket Client Context Tag
 */
export class WebSocketClientService extends Context.Tag("@app/services/WebSocketClientService")<
  WebSocketClientService,
  WebSocketClientServiceImpl
>() {}

/**
 * Connection types
 */
type ConnectionType = 'lobby' | 'room'

/**
 * Connection state for each WebSocket
 */
type ConnectionState = {
  websocket: Option.Option<WebSocket>
  url: Option.Option<string>
  timeoutId: Option.Option<NodeJS.Timeout>
}

/**
 * WebSocket Client Implementation
 */
const createWebSocketClientImpl = (): WebSocketClientServiceImpl => {
  // Consolidated connection storage
  const connections: Record<ConnectionType, ConnectionState> = {
    lobby: {
      websocket: Option.none(),
      url: Option.none(),
      timeoutId: Option.none()
    },
    room: {
      websocket: Option.none(),
      url: Option.none(),
      timeoutId: Option.none()
    }
  }
  
  // Separate handlers for each event type (handle raw data, not decoded)
  const djEventHandlers: Set<(data: unknown) => void> = new Set()
  const listenerEventHandlers: Set<(data: unknown) => void> = new Set()
  const lobbyEventHandlers: Set<(data: unknown) => void> = new Set()

  // Generic helper functions
  const clearConnectionTimeout = (connectionType: ConnectionType): Effect.Effect<void, never, never> =>
    Effect.sync(() => {
      const connection = connections[connectionType]
      pipe(
        connection.timeoutId,
        Option.match({
          onNone: () => {},
          onSome: (timeoutId) => {
            clearTimeout(timeoutId)
            connections[connectionType] = {
              ...connection,
              timeoutId: Option.none()
            }
          }
        })
      )
    })


  const createWebSocketError = (operation: WebSocketOperation, cause: string, originalError?: unknown): WebSocketError =>
    new WebSocketError({
      cause: originalError ? `${cause}: ${String(originalError)}` : cause,
      operation,
      timestamp: new Date()
    })

  const setupWebSocketEventHandlers = (
    ws: WebSocket, 
    connectionType: ConnectionType,
    connectionAdapter: Context.Tag.Service<ConnectionAdapter>
  ) =>
    Effect.gen(function* () {
      const setWSState = connectionType === 'lobby' 
        ? (state: WsConnectionState) => connectionAdapter.setLobbyWSState(state)
        : (state: WsConnectionState) => connectionAdapter.setRoomWSState(state)

      yield* Effect.sync(() => {
        ws.onopen = () => {
          Effect.runSync(clearConnectionTimeout(connectionType))
          setWSState(WsConnectionState.CONNECTED)
          connectionAdapter.clearError()
        }

        ws.onerror = (event) => {
          Effect.runSync(clearConnectionTimeout(connectionType))
          const error = createWebSocketError(
            WebSocketOperation.CONNECT,
            'WebSocket connection error',
            event
          )
          connectionAdapter.setConnectionError(error)
          setWSState(WsConnectionState.DISCONNECTED)
        }

        ws.onclose = () => {
          Effect.runSync(clearConnectionTimeout(connectionType))
          setWSState(WsConnectionState.DISCONNECTED)
          connections[connectionType] = {
            ...connections[connectionType],
            websocket: Option.none()
          }
          if (connectionType === 'lobby') {
            lobbyEventHandlers.clear()
          } else {
            djEventHandlers.clear()
            listenerEventHandlers.clear()
          }
        }

        ws.onmessage = (message) => {
          try {
            const data = JSON.parse(message.data)
            
            if (connectionType === 'lobby') {
              // Lobby connection only handles lobby events
              lobbyEventHandlers.forEach(handler => handler(data))
            } else {
              // Room connection handles DJ and Listener events
              // Pass raw data to handlers - they'll decode as needed
              djEventHandlers.forEach(handler => handler(data))
              listenerEventHandlers.forEach(handler => handler(data))
            }
          } catch (error) {
            // JSON parse error - report to adapter
            const wsError = createWebSocketError(
              WebSocketOperation.RECEIVE,
              'Failed to parse WebSocket message',
              error
            )
            connectionAdapter.setConnectionError(wsError)
          }
        }
      })
    })

  const sendRawMessage = (data: string, connectionType: ConnectionType): Effect.Effect<void, WebSocketError, never> =>
    Effect.gen(function* () {
      const ws = yield* pipe(
        connections[connectionType].websocket,
        Option.match({
          onNone: () => Effect.fail(createWebSocketError(
            WebSocketOperation.SEND,
            `No active ${connectionType} WebSocket connection`
          )),
          onSome: (ws) => Effect.succeed(ws)
        })
      )

      yield* Effect.try({
        try: () => {
          if (ws.readyState !== WebSocket.OPEN) {
            throw new Error(`WebSocket not open (state: ${ws.readyState})`)
          }
          ws.send(data)
        },
        catch: (error) => createWebSocketError(
          WebSocketOperation.SEND,
          'Failed to send WebSocket message',
          error
        )
      })
    }) as Effect.Effect<void, WebSocketError, never>

  const sendEncodedCommand = (encodedCommand: unknown, connectionType: ConnectionType): Effect.Effect<void, WebSocketError, never> =>
    sendRawMessage(JSON.stringify(encodedCommand), connectionType)

  // Generic connection function
  const createConnection = (
    url: string,
    connectionType: ConnectionType,
    connectionAdapter: Context.Tag.Service<ConnectionAdapter>
  ): Effect.Effect<void, WebSocketError, never> =>
    Effect.gen(function* () {
      // Close existing connection if any
      yield* pipe(
        connections[connectionType].websocket,
        Option.match({
          onNone: () => Effect.void,
          onSome: (ws) => Effect.sync(() => {
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
              ws.close()
            }
          })
        })
      )

      // Store URL
      connections[connectionType] = {
        ...connections[connectionType],
        url: Option.some(url)
      }

      // Update to disconnected state initially
      const setWSState = connectionType === 'lobby'
        ? (state: WsConnectionState) => connectionAdapter.setLobbyWSState(state)
        : (state: WsConnectionState) => connectionAdapter.setRoomWSState(state)
      setWSState(WsConnectionState.DISCONNECTED)

      // Create new WebSocket connection
      yield* Effect.async<void, WebSocketError>((resume) => {
        try {
          const ws = new WebSocket(url)
          connections[connectionType] = {
            ...connections[connectionType],
            websocket: Option.some(ws)
          }

          // Setup connection timeout
          const timeoutId = setTimeout(() => {
            ws.close()
            resume(Effect.fail(createWebSocketError(
              WebSocketOperation.CONNECT,
              `${connectionType === 'lobby' ? 'Lobby' : 'Room'} WebSocket connection timeout (30s)`
            )))
          }, 30000)
          connections[connectionType] = {
            ...connections[connectionType],
            timeoutId: Option.some(timeoutId)
          }

          ws.onopen = () => {
            clearTimeout(timeoutId)
            connections[connectionType] = {
              ...connections[connectionType],
              timeoutId: Option.none()
            }
            resume(Effect.succeed(undefined))
          }

          ws.onerror = (event) => {
            clearTimeout(timeoutId)
            connections[connectionType] = {
              ...connections[connectionType],
              timeoutId: Option.none()
            }
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

      // Setup event handlers after successful connection
      yield* pipe(
        connections[connectionType].websocket,
        Option.match({
          onNone: () => Effect.fail(createWebSocketError(
            WebSocketOperation.CONNECT,
            `${connectionType === 'lobby' ? 'Lobby' : 'Room'} WebSocket not available after connection`
          )),
          onSome: (ws) => setupWebSocketEventHandlers(ws, connectionType, connectionAdapter)
        })
      )
    }) as Effect.Effect<void, WebSocketError, never>

  // Generic disconnect function
  const disconnect = (
    connectionType: ConnectionType,
    connectionAdapter: Context.Tag.Service<ConnectionAdapter>
  ): Effect.Effect<void, never, never> =>
    Effect.gen(function* () {
      yield* clearConnectionTimeout(connectionType)
      
      yield* pipe(
        connections[connectionType].websocket,
        Option.match({
          onNone: () => Effect.void,
          onSome: (ws) => Effect.sync(() => {
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
              ws.close()
            }
          })
        })
      )

      connections[connectionType] = {
        websocket: Option.none(),
        url: Option.none(),
        timeoutId: Option.none()
      }

      if (connectionType === 'lobby') {
        lobbyEventHandlers.clear()
        connectionAdapter.setLobbyWSState(WsConnectionState.DISCONNECTED)
      } else {
        djEventHandlers.clear()
        listenerEventHandlers.clear()
        connectionAdapter.setRoomWSState(WsConnectionState.DISCONNECTED)
      }
    }) as Effect.Effect<void, never, never>

  // Generic wait for event function (handles raw data)
  const waitForEvent = (
    eventType: string,
    handlers: Set<(data: unknown) => void>,
    eventName: string,
    timeoutMs = 30000
  ): Effect.Effect<unknown, WebSocketError, never> =>
    Effect.async<unknown, WebSocketError>((resume) => {
      const timeoutId = setTimeout(() => {
        handlers.delete(eventHandler)
        resume(Effect.fail(createWebSocketError(
          WebSocketOperation.WAIT_FOR_EVENT,
          `Timeout waiting for ${eventName} event: ${eventType}`
        )))
      }, timeoutMs)

      const eventHandler = (data: unknown) => {
        // Check if this is the event type we're waiting for
        if (typeof data === 'object' && data !== null && 'type' in data && (data as any).type === eventType) {
          clearTimeout(timeoutId)
          handlers.delete(eventHandler)
          resume(Effect.succeed(data))
        }
      }

      handlers.add(eventHandler)
    })

  const service: WebSocketClientServiceImpl = {
    connectLobby: (url: string): Effect.Effect<void, WebSocketError, ConnectionAdapter> =>
      Effect.gen(function* () {
        const connectionAdapter = yield* ConnectionAdapter
        yield* createConnection(url, 'lobby', connectionAdapter)
      }) as Effect.Effect<void, WebSocketError, ConnectionAdapter>,

    connectRoom: (url: string): Effect.Effect<void, WebSocketError, ConnectionAdapter> =>
      Effect.gen(function* () {
        const connectionAdapter = yield* ConnectionAdapter
        yield* createConnection(url, 'room', connectionAdapter)
      }) as Effect.Effect<void, WebSocketError, ConnectionAdapter>,

    disconnectLobby: (): Effect.Effect<void, never, ConnectionAdapter> =>
      Effect.gen(function* () {
        const connectionAdapter = yield* ConnectionAdapter
        yield* disconnect('lobby', connectionAdapter)
      }) as Effect.Effect<void, never, ConnectionAdapter>,

    disconnectRoom: (): Effect.Effect<void, never, ConnectionAdapter> =>
      Effect.gen(function* () {
        const connectionAdapter = yield* ConnectionAdapter
        yield* disconnect('room', connectionAdapter)
      }) as Effect.Effect<void, never, ConnectionAdapter>,

    sendDJCommand: (command: DJCommandType) =>
      pipe(
        Effect.try({
          try: () => S.encodeSync(DJCommandSchema)(command),
          catch: (error) => createWebSocketError(
            WebSocketOperation.ENCODE,
            'Failed to encode DJ command',
            error
          )
        }),
        Effect.flatMap(encoded => sendEncodedCommand(encoded, 'room'))
      ),

    sendListenerCommand: (command: ListenerCommandType) =>
      pipe(
        Effect.try({
          try: () => S.encodeSync(ListenerCommandSchema)(command),
          catch: (error) => createWebSocketError(
            WebSocketOperation.ENCODE,
            'Failed to encode Listener command',
            error
          )
        }),
        Effect.flatMap(encoded => sendEncodedCommand(encoded, 'room'))
      ),

    sendLobbyCommand: (command: LobbyCommandType) =>
      pipe(
        Effect.try({
          try: () => S.encodeSync(LobbyCommandSchema)(command),
          catch: (error) => createWebSocketError(
            WebSocketOperation.ENCODE,
            'Failed to encode Lobby command',
            error
          )
        }),
        Effect.flatMap(encoded => sendEncodedCommand(encoded, 'lobby'))
      ),

    subscribeDJEvents: (handler: (event: DJEvent) => void) =>
      Effect.gen(function* () {
        // Wrap handler to decode before calling
        const decodingHandler = (data: unknown) => {
          try {
            const event = S.decodeUnknownSync(DJEventSchema)(data)
            handler(event)
          } catch {
            // Not a DJ event, ignore
          }
        }
        djEventHandlers.add(decodingHandler)
        return () => {
          djEventHandlers.delete(decodingHandler)
        }
      }),

    subscribeListenerEvents: (handler: (event: ListenerEvent) => void) =>
      Effect.gen(function* () {
        // Wrap handler to decode before calling
        const decodingHandler = (data: unknown) => {
          try {
            const event = S.decodeUnknownSync(ListenerEventSchema)(data)
            handler(event)
          } catch {
            // Not a Listener event, ignore
          }
        }
        listenerEventHandlers.add(decodingHandler)
        return () => {
          listenerEventHandlers.delete(decodingHandler)
        }
      }),

    subscribeLobbyEvents: (handler: (event: LobbyEvent) => void) =>
      Effect.gen(function* () {
        // Wrap handler to decode before calling
        const decodingHandler = (data: unknown) => {
          try {
            const event = S.decodeUnknownSync(LobbyEventSchema)(data)
            handler(event)
          } catch {
            // Not a Lobby event, ignore
          }
        }
        lobbyEventHandlers.add(decodingHandler)
        return () => {
          lobbyEventHandlers.delete(decodingHandler)
        }
      }),

    waitForDJEvent: (eventType: WebSocketDJEventType, timeoutMs = 30000): any => {
      switch (eventType) {
        case WEBSOCKET_DJ_EVENT_TYPES.ROOM_INITIALIZED:
          return pipe(
            waitForEvent(WEBSOCKET_DJ_EVENT_TYPES.ROOM_INITIALIZED, djEventHandlers, 'DJ', timeoutMs),
            Effect.flatMap(data => 
              Effect.try({
                try: () => S.decodeUnknownSync(RoomInitializedEventSchema)(data),
                catch: (error) => createWebSocketError(
                  WebSocketOperation.DECODE,
                  'Failed to decode DJ event: roomInitialized',
                  error
                )
              })
            )
          )
        case WEBSOCKET_DJ_EVENT_TYPES.DJ_TRANSPORT_READY:
          return pipe(
            waitForEvent(WEBSOCKET_DJ_EVENT_TYPES.DJ_TRANSPORT_READY, djEventHandlers, 'DJ', timeoutMs),
            Effect.flatMap(data => 
              Effect.try({
                try: () => S.decodeUnknownSync(DjTransportReadyEventSchema)(data),
                catch: (error) => createWebSocketError(
                  WebSocketOperation.DECODE,
                  'Failed to decode DJ event: djTransportReady',
                  error
                )
              })
            )
          )
        case WEBSOCKET_DJ_EVENT_TYPES.TRANSPORT_CONNECTED:
          return pipe(
            waitForEvent(WEBSOCKET_DJ_EVENT_TYPES.TRANSPORT_CONNECTED, djEventHandlers, 'DJ', timeoutMs),
            Effect.flatMap(data => 
              Effect.try({
                try: () => S.decodeUnknownSync(TransportConnectedEventSchema)(data),
                catch: (error) => createWebSocketError(
                  WebSocketOperation.DECODE,
                  'Failed to decode DJ event: transportConnected',
                  error
                )
              })
            )
          )
        case WEBSOCKET_DJ_EVENT_TYPES.PRODUCER_CREATED:
          return pipe(
            waitForEvent(WEBSOCKET_DJ_EVENT_TYPES.PRODUCER_CREATED, djEventHandlers, 'DJ', timeoutMs),
            Effect.flatMap(data => 
              Effect.try({
                try: () => S.decodeUnknownSync(ProducerCreatedEventSchema)(data),
                catch: (error) => createWebSocketError(
                  WebSocketOperation.DECODE,
                  'Failed to decode DJ event: producerCreated',
                  error
                )
              })
            )
          )
        case WEBSOCKET_DJ_EVENT_TYPES.STREAM_PAUSED:
          return pipe(
            waitForEvent(WEBSOCKET_DJ_EVENT_TYPES.STREAM_PAUSED, djEventHandlers, 'DJ', timeoutMs),
            Effect.flatMap(data => 
              Effect.try({
                try: () => S.decodeUnknownSync(StreamPausedEventSchema)(data),
                catch: (error) => createWebSocketError(
                  WebSocketOperation.DECODE,
                  'Failed to decode DJ event: streamPaused',
                  error
                )
              })
            )
          )
        case WEBSOCKET_DJ_EVENT_TYPES.STREAM_RESUMED:
          return pipe(
            waitForEvent(WEBSOCKET_DJ_EVENT_TYPES.STREAM_RESUMED, djEventHandlers, 'DJ', timeoutMs),
            Effect.flatMap(data => 
              Effect.try({
                try: () => S.decodeUnknownSync(StreamResumedEventSchema)(data),
                catch: (error) => createWebSocketError(
                  WebSocketOperation.DECODE,
                  'Failed to decode DJ event: streamResumed',
                  error
                )
              })
            )
          )
        case WEBSOCKET_DJ_EVENT_TYPES.ROOM_CLOSED:
          return pipe(
            waitForEvent(WEBSOCKET_DJ_EVENT_TYPES.ROOM_CLOSED, djEventHandlers, 'DJ', timeoutMs),
            Effect.flatMap(data => 
              Effect.try({
                try: () => S.decodeUnknownSync(RoomClosedEventSchema)(data),
                catch: (error) => createWebSocketError(
                  WebSocketOperation.DECODE,
                  'Failed to decode DJ event: roomClosed',
                  error
                )
              })
            )
          )
        case WEBSOCKET_DJ_EVENT_TYPES.DJ_COMMAND_FAILED:
          return pipe(
            waitForEvent(WEBSOCKET_DJ_EVENT_TYPES.DJ_COMMAND_FAILED, djEventHandlers, 'DJ', timeoutMs),
            Effect.flatMap(data => 
              Effect.try({
                try: () => S.decodeUnknownSync(DJCommandFailedEventSchema)(data),
                catch: (error) => createWebSocketError(
                  WebSocketOperation.DECODE,
                  'Failed to decode DJ event: djCommandFailed',
                  error
                )
              })
            )
          )
        case WEBSOCKET_DJ_EVENT_TYPES.ROOM_NOT_FOUND:
          return pipe(
            waitForEvent(WEBSOCKET_DJ_EVENT_TYPES.ROOM_NOT_FOUND, djEventHandlers, 'DJ', timeoutMs),
            Effect.flatMap(data => 
              Effect.try({
                try: () => S.decodeUnknownSync(RoomNotFoundEventSchema)(data),
                catch: (error) => createWebSocketError(
                  WebSocketOperation.DECODE,
                  'Failed to decode DJ event: roomNotFound',
                  error
                )
              })
            )
          )
        default:
          return Effect.fail(createWebSocketError(
            WebSocketOperation.DECODE,
            `Unknown DJ event type: ${eventType}`,
            new Error(`Invalid DJ event type: ${eventType}`)
          ))
      }
    },

    waitForListenerEvent: (eventType: WebSocketListenerEventType, timeoutMs = 30000): any => {
      switch (eventType) {
        case WEBSOCKET_LISTENER_EVENT_TYPES.JOIN_READY:
          return pipe(
            waitForEvent(WEBSOCKET_LISTENER_EVENT_TYPES.JOIN_READY, listenerEventHandlers, 'Listener', timeoutMs),
            Effect.flatMap(data => 
              Effect.try({
                try: () => S.decodeUnknownSync(JoinReadyEventSchema)(data),
                catch: (error) => createWebSocketError(
                  WebSocketOperation.DECODE,
                  'Failed to decode Listener event: joinReady',
                  error
                )
              })
            )
          )
        case WEBSOCKET_LISTENER_EVENT_TYPES.LISTENER_TRANSPORT_READY:
          return pipe(
            waitForEvent(WEBSOCKET_LISTENER_EVENT_TYPES.LISTENER_TRANSPORT_READY, listenerEventHandlers, 'Listener', timeoutMs),
            Effect.flatMap(data => 
              Effect.try({
                try: () => S.decodeUnknownSync(ListenerTransportReadyEventSchema)(data),
                catch: (error) => createWebSocketError(
                  WebSocketOperation.DECODE,
                  'Failed to decode Listener event: listenerTransportReady',
                  error
                )
              })
            )
          )
        case WEBSOCKET_LISTENER_EVENT_TYPES.TRANSPORT_CONNECTED:
          return pipe(
            waitForEvent(WEBSOCKET_LISTENER_EVENT_TYPES.TRANSPORT_CONNECTED, listenerEventHandlers, 'Listener', timeoutMs),
            Effect.flatMap(data => 
              Effect.try({
                try: () => S.decodeUnknownSync(ListenerTransportConnectedEventSchema)(data),
                catch: (error) => createWebSocketError(
                  WebSocketOperation.DECODE,
                  'Failed to decode Listener event: transportConnected',
                  error
                )
              })
            )
          )
        case WEBSOCKET_LISTENER_EVENT_TYPES.CONSUMER_CREATED:
          return pipe(
            waitForEvent(WEBSOCKET_LISTENER_EVENT_TYPES.CONSUMER_CREATED, listenerEventHandlers, 'Listener', timeoutMs),
            Effect.flatMap(data => 
              Effect.try({
                try: () => S.decodeUnknownSync(ConsumerCreatedEventSchema)(data),
                catch: (error) => createWebSocketError(
                  WebSocketOperation.DECODE,
                  'Failed to decode Listener event: consumerCreated',
                  error
                )
              })
            )
          )
        case WEBSOCKET_LISTENER_EVENT_TYPES.ROUTER_CAPABILITIES:
          return pipe(
            waitForEvent(WEBSOCKET_LISTENER_EVENT_TYPES.ROUTER_CAPABILITIES, listenerEventHandlers, 'Listener', timeoutMs),
            Effect.flatMap(data => 
              Effect.try({
                try: () => S.decodeUnknownSync(RouterCapabilitiesEventSchema)(data),
                catch: (error) => createWebSocketError(
                  WebSocketOperation.DECODE,
                  'Failed to decode Listener event: routerCapabilities',
                  error
                )
              })
            )
          )
        case WEBSOCKET_LISTENER_EVENT_TYPES.LISTENER_COUNT_UPDATED:
          return pipe(
            waitForEvent(WEBSOCKET_LISTENER_EVENT_TYPES.LISTENER_COUNT_UPDATED, listenerEventHandlers, 'Listener', timeoutMs),
            Effect.flatMap(data => 
              Effect.try({
                try: () => S.decodeUnknownSync(ListenerCountUpdatedEventSchema)(data),
                catch: (error) => createWebSocketError(
                  WebSocketOperation.DECODE,
                  'Failed to decode Listener event: listenerCountUpdated',
                  error
                )
              })
            )
          )
        case WEBSOCKET_LISTENER_EVENT_TYPES.STREAM_PAUSED:
          return pipe(
            waitForEvent(WEBSOCKET_LISTENER_EVENT_TYPES.STREAM_PAUSED, listenerEventHandlers, 'Listener', timeoutMs),
            Effect.flatMap(data => 
              Effect.try({
                try: () => S.decodeUnknownSync(ListenerStreamPausedEventSchema)(data),
                catch: (error) => createWebSocketError(
                  WebSocketOperation.DECODE,
                  'Failed to decode Listener event: streamPaused',
                  error
                )
              })
            )
          )
        case WEBSOCKET_LISTENER_EVENT_TYPES.STREAM_RESUMED:
          return pipe(
            waitForEvent(WEBSOCKET_LISTENER_EVENT_TYPES.STREAM_RESUMED, listenerEventHandlers, 'Listener', timeoutMs),
            Effect.flatMap(data => 
              Effect.try({
                try: () => S.decodeUnknownSync(ListenerStreamResumedEventSchema)(data),
                catch: (error) => createWebSocketError(
                  WebSocketOperation.DECODE,
                  'Failed to decode Listener event: streamResumed',
                  error
                )
              })
            )
          )
        case WEBSOCKET_LISTENER_EVENT_TYPES.ROOM_CLOSED:
          return pipe(
            waitForEvent(WEBSOCKET_LISTENER_EVENT_TYPES.ROOM_CLOSED, listenerEventHandlers, 'Listener', timeoutMs),
            Effect.flatMap(data => 
              Effect.try({
                try: () => S.decodeUnknownSync(ListenerRoomClosedEventSchema)(data),
                catch: (error) => createWebSocketError(
                  WebSocketOperation.DECODE,
                  'Failed to decode Listener event: roomClosed',
                  error
                )
              })
            )
          )
        case WEBSOCKET_LISTENER_EVENT_TYPES.LISTENER_COMMAND_FAILED:
          return pipe(
            waitForEvent(WEBSOCKET_LISTENER_EVENT_TYPES.LISTENER_COMMAND_FAILED, listenerEventHandlers, 'Listener', timeoutMs),
            Effect.flatMap(data => 
              Effect.try({
                try: () => S.decodeUnknownSync(ListenerCommandFailedEventSchema)(data),
                catch: (error) => createWebSocketError(
                  WebSocketOperation.DECODE,
                  'Failed to decode Listener event: listenerCommandFailed',
                  error
                )
              })
            )
          )
        case WEBSOCKET_LISTENER_EVENT_TYPES.ROOM_NOT_FOUND:
          return pipe(
            waitForEvent(WEBSOCKET_LISTENER_EVENT_TYPES.ROOM_NOT_FOUND, listenerEventHandlers, 'Listener', timeoutMs),
            Effect.flatMap(data => 
              Effect.try({
                try: () => S.decodeUnknownSync(ListenerRoomNotFoundEventSchema)(data),
                catch: (error) => createWebSocketError(
                  WebSocketOperation.DECODE,
                  'Failed to decode Listener event: roomNotFound',
                  error
                )
              })
            )
          )
        default:
          return Effect.fail(createWebSocketError(
            WebSocketOperation.DECODE,
            `Unknown Listener event type: ${eventType}`,
            new Error(`Invalid Listener event type: ${eventType}`)
          ))
      }
    },

    waitForLobbyEvent: (eventType: WebSocketLobbyEventType, timeoutMs = 30000): any => {
      switch (eventType) {
        case WEBSOCKET_LOBBY_EVENT_TYPES.ROOM_ANNOUNCED:
          return pipe(
            waitForEvent(WEBSOCKET_LOBBY_EVENT_TYPES.ROOM_ANNOUNCED, lobbyEventHandlers, 'Lobby', timeoutMs),
            Effect.flatMap(data => 
              Effect.try({
                try: () => S.decodeUnknownSync(RoomAnnouncedEventSchema)(data),
                catch: (error) => createWebSocketError(
                  WebSocketOperation.DECODE,
                  'Failed to decode Lobby event: roomAnnounced',
                  error
                )
              })
            )
          )
        case WEBSOCKET_LOBBY_EVENT_TYPES.ROOM_ADDED:
          return pipe(
            waitForEvent(WEBSOCKET_LOBBY_EVENT_TYPES.ROOM_ADDED, lobbyEventHandlers, 'Lobby', timeoutMs),
            Effect.flatMap(data => 
              Effect.try({
                try: () => S.decodeUnknownSync(RoomAddedEventSchema)(data),
                catch: (error) => createWebSocketError(
                  WebSocketOperation.DECODE,
                  'Failed to decode Lobby event: roomAdded',
                  error
                )
              })
            )
          )
        case WEBSOCKET_LOBBY_EVENT_TYPES.ROOM_UPDATED:
          return pipe(
            waitForEvent(WEBSOCKET_LOBBY_EVENT_TYPES.ROOM_UPDATED, lobbyEventHandlers, 'Lobby', timeoutMs),
            Effect.flatMap(data => 
              Effect.try({
                try: () => S.decodeUnknownSync(RoomUpdatedEventSchema)(data),
                catch: (error) => createWebSocketError(
                  WebSocketOperation.DECODE,
                  'Failed to decode Lobby event: roomUpdated',
                  error
                )
              })
            )
          )
        case WEBSOCKET_LOBBY_EVENT_TYPES.ROOM_REMOVED:
          return pipe(
            waitForEvent(WEBSOCKET_LOBBY_EVENT_TYPES.ROOM_REMOVED, lobbyEventHandlers, 'Lobby', timeoutMs),
            Effect.flatMap(data => 
              Effect.try({
                try: () => S.decodeUnknownSync(RoomRemovedEventSchema)(data),
                catch: (error) => createWebSocketError(
                  WebSocketOperation.DECODE,
                  'Failed to decode Lobby event: roomRemoved',
                  error
                )
              })
            )
          )
        case WEBSOCKET_LOBBY_EVENT_TYPES.JOIN_APPROVED:
          return pipe(
            waitForEvent(WEBSOCKET_LOBBY_EVENT_TYPES.JOIN_APPROVED, lobbyEventHandlers, 'Lobby', timeoutMs),
            Effect.flatMap(data => 
              Effect.try({
                try: () => S.decodeUnknownSync(JoinRoomResponseEventSchema)(data),
                catch: (error) => createWebSocketError(
                  WebSocketOperation.DECODE,
                  'Failed to decode Lobby event: joinApproved',
                  error
                )
              })
            )
          )
        default:
          return Effect.fail(createWebSocketError(
            WebSocketOperation.DECODE,
            `Unknown Lobby event type: ${eventType}`,
            new Error(`Invalid Lobby event type: ${eventType}`)
          ))
      }
    }
  }
  
  return service
}

/**
 * WebSocket Client Service Layer
 */
export const WebSocketClientServiceLive = Layer.succeed(
  WebSocketClientService,
  createWebSocketClientImpl()
)

/**
 * Lazy-loaded WebSocket client instance
 * 
 * Service is created on first access, not at module load time.
 */
let webSocketClientInstance: Option.Option<WebSocketClientServiceImpl> = Option.none()

/**
 * Get or create the lazy-loaded WebSocket client service
 */
export const getWebSocketClient = (): WebSocketClientServiceImpl => {
  return pipe(
    webSocketClientInstance,
    Option.match({
      onNone: () => {
        const service = createWebSocketClientImpl()
        webSocketClientInstance = Option.some(service)
        return service
      },
      onSome: (service) => service
    })
  )
}

/**
 * Reset the WebSocket client instance (useful for testing)
 */
export const resetWebSocketClient = (): void => {
  webSocketClientInstance = Option.none()
}