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
   * Wait for specific DJ event type with timeout - overloaded for proper type narrowing
   */
  readonly waitForDJEvent: {
    (eventType: 'roomInitialized', timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof RoomInitializedEventSchema>, WebSocketError, never>
    (eventType: 'djTransportReady', timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof DjTransportReadyEventSchema>, WebSocketError, never>
    (eventType: 'transportConnected', timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof TransportConnectedEventSchema>, WebSocketError, never>
    (eventType: 'producerCreated', timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof ProducerCreatedEventSchema>, WebSocketError, never>
    (eventType: 'streamPaused', timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof StreamPausedEventSchema>, WebSocketError, never>
    (eventType: 'streamResumed', timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof StreamResumedEventSchema>, WebSocketError, never>
    (eventType: 'roomClosed', timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof RoomClosedEventSchema>, WebSocketError, never>
    (eventType: 'djCommandFailed', timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof DJCommandFailedEventSchema>, WebSocketError, never>
    (eventType: 'roomNotFound', timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof RoomNotFoundEventSchema>, WebSocketError, never>
    (eventType: string, timeoutMs?: number): Effect.Effect<DJEvent, WebSocketError, never>
  }

  /**
   * Wait for specific Listener event type with timeout - overloaded for proper type narrowing
   */
  readonly waitForListenerEvent: {
    (eventType: 'joinReady', timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof JoinReadyEventSchema>, WebSocketError, never>
    (eventType: 'listenerTransportReady', timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof ListenerTransportReadyEventSchema>, WebSocketError, never>
    (eventType: 'transportConnected', timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof ListenerTransportConnectedEventSchema>, WebSocketError, never>
    (eventType: 'consumerCreated', timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof ConsumerCreatedEventSchema>, WebSocketError, never>
    (eventType: 'routerCapabilities', timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof RouterCapabilitiesEventSchema>, WebSocketError, never>
    (eventType: 'listenerCountUpdated', timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof ListenerCountUpdatedEventSchema>, WebSocketError, never>
    (eventType: 'streamPaused', timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof ListenerStreamPausedEventSchema>, WebSocketError, never>
    (eventType: 'streamResumed', timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof ListenerStreamResumedEventSchema>, WebSocketError, never>
    (eventType: 'roomClosed', timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof ListenerRoomClosedEventSchema>, WebSocketError, never>
    (eventType: 'listenerCommandFailed', timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof ListenerCommandFailedEventSchema>, WebSocketError, never>
    (eventType: 'roomNotFound', timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof ListenerRoomNotFoundEventSchema>, WebSocketError, never>
    (eventType: string, timeoutMs?: number): Effect.Effect<ListenerEvent, WebSocketError, never>
  }

  /**
   * Wait for specific Lobby event type with timeout - overloaded for proper type narrowing
   */
  readonly waitForLobbyEvent: {
    (eventType: 'roomAnnounced', timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof RoomAnnouncedEventSchema>, WebSocketError, never>
    (eventType: 'roomAdded', timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof RoomAddedEventSchema>, WebSocketError, never>
    (eventType: 'roomUpdated', timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof RoomUpdatedEventSchema>, WebSocketError, never>
    (eventType: 'roomRemoved', timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof RoomRemovedEventSchema>, WebSocketError, never>
    (eventType: 'joinApproved', timeoutMs?: number): Effect.Effect<S.Schema.Type<typeof JoinRoomResponseEventSchema>, WebSocketError, never>
    (eventType: string, timeoutMs?: number): Effect.Effect<LobbyEvent, WebSocketError, never>
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

    waitForDJEvent: {
      'roomInitialized': (timeoutMs = 30000) =>
        pipe(
          waitForEvent('roomInitialized', djEventHandlers, 'DJ', timeoutMs),
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
        ),
      'djTransportReady': (timeoutMs = 30000) =>
        pipe(
          waitForEvent('djTransportReady', djEventHandlers, 'DJ', timeoutMs),
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
        ),
      'transportConnected': (timeoutMs = 30000) =>
        pipe(
          waitForEvent('transportConnected', djEventHandlers, 'DJ', timeoutMs),
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
        ),
      'producerCreated': (timeoutMs = 30000) =>
        pipe(
          waitForEvent('producerCreated', djEventHandlers, 'DJ', timeoutMs),
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
        ),
      'streamPaused': (timeoutMs = 30000) =>
        pipe(
          waitForEvent('streamPaused', djEventHandlers, 'DJ', timeoutMs),
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
        ),
      'streamResumed': (timeoutMs = 30000) =>
        pipe(
          waitForEvent('streamResumed', djEventHandlers, 'DJ', timeoutMs),
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
        ),
      'roomClosed': (timeoutMs = 30000) =>
        pipe(
          waitForEvent('roomClosed', djEventHandlers, 'DJ', timeoutMs),
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
        ),
      'djCommandFailed': (timeoutMs = 30000) =>
        pipe(
          waitForEvent('djCommandFailed', djEventHandlers, 'DJ', timeoutMs),
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
        ),
      'roomNotFound': (timeoutMs = 30000) =>
        pipe(
          waitForEvent('roomNotFound', djEventHandlers, 'DJ', timeoutMs),
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
    } as any,

    waitForListenerEvent: {
      'joinReady': (timeoutMs = 30000) =>
        pipe(
          waitForEvent('joinReady', listenerEventHandlers, 'Listener', timeoutMs),
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
        ),
      'listenerTransportReady': (timeoutMs = 30000) =>
        pipe(
          waitForEvent('listenerTransportReady', listenerEventHandlers, 'Listener', timeoutMs),
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
        ),
      'transportConnected': (timeoutMs = 30000) =>
        pipe(
          waitForEvent('transportConnected', listenerEventHandlers, 'Listener', timeoutMs),
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
        ),
      'consumerCreated': (timeoutMs = 30000) =>
        pipe(
          waitForEvent('consumerCreated', listenerEventHandlers, 'Listener', timeoutMs),
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
        ),
      'routerCapabilities': (timeoutMs = 30000) =>
        pipe(
          waitForEvent('routerCapabilities', listenerEventHandlers, 'Listener', timeoutMs),
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
        ),
      'listenerCountUpdated': (timeoutMs = 30000) =>
        pipe(
          waitForEvent('listenerCountUpdated', listenerEventHandlers, 'Listener', timeoutMs),
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
        ),
      'streamPaused': (timeoutMs = 30000) =>
        pipe(
          waitForEvent('streamPaused', listenerEventHandlers, 'Listener', timeoutMs),
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
        ),
      'streamResumed': (timeoutMs = 30000) =>
        pipe(
          waitForEvent('streamResumed', listenerEventHandlers, 'Listener', timeoutMs),
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
        ),
      'roomClosed': (timeoutMs = 30000) =>
        pipe(
          waitForEvent('roomClosed', listenerEventHandlers, 'Listener', timeoutMs),
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
        ),
      'listenerCommandFailed': (timeoutMs = 30000) =>
        pipe(
          waitForEvent('listenerCommandFailed', listenerEventHandlers, 'Listener', timeoutMs),
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
        ),
      'roomNotFound': (timeoutMs = 30000) =>
        pipe(
          waitForEvent('roomNotFound', listenerEventHandlers, 'Listener', timeoutMs),
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
    } as any,

    waitForLobbyEvent: {
      'roomAnnounced': (timeoutMs = 30000) =>
        pipe(
          waitForEvent('roomAnnounced', lobbyEventHandlers, 'Lobby', timeoutMs),
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
        ),
      'roomAdded': (timeoutMs = 30000) =>
        pipe(
          waitForEvent('roomAdded', lobbyEventHandlers, 'Lobby', timeoutMs),
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
        ),
      'roomUpdated': (timeoutMs = 30000) =>
        pipe(
          waitForEvent('roomUpdated', lobbyEventHandlers, 'Lobby', timeoutMs),
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
        ),
      'roomRemoved': (timeoutMs = 30000) =>
        pipe(
          waitForEvent('roomRemoved', lobbyEventHandlers, 'Lobby', timeoutMs),
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
        ),
      'joinApproved': (timeoutMs = 30000) =>
        pipe(
          waitForEvent('joinApproved', lobbyEventHandlers, 'Lobby', timeoutMs),
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
    } as any
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