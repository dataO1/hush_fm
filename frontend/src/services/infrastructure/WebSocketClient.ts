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
  LobbyEventSchema
} from '../../domain/schemas/shared/websocket.schema'
import { 
  WebSocketError, 
  WebSocketOperation, 
  WsConnectionState 
} from '../../domain/schemas/connection.schema'
import { ConnectionAdapter } from '../../stores'

// Union types for commands and events
type DJCommand = S.Schema.Type<typeof DJCommandSchema>
type DJEvent = S.Schema.Type<typeof DJEventSchema>
type ListenerCommand = S.Schema.Type<typeof ListenerCommandSchema>
type ListenerEvent = S.Schema.Type<typeof ListenerEventSchema>
type LobbyCommand = S.Schema.Type<typeof LobbyCommandSchema>
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
   * Send DJ command
   */
  readonly sendDJCommand: (command: DJCommand) => Effect.Effect<void, WebSocketError, never>

  /**
   * Send Listener command
   */
  readonly sendListenerCommand: (command: ListenerCommand) => Effect.Effect<void, WebSocketError, never>

  /**
   * Send Lobby command
   */
  readonly sendLobbyCommand: (command: LobbyCommand) => Effect.Effect<void, WebSocketError, never>

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
   * Wait for specific DJ event type with timeout
   */
  readonly waitForDJEvent: (eventType: string, timeoutMs?: number) => Effect.Effect<DJEvent, WebSocketError, never>

  /**
   * Wait for specific Listener event type with timeout
   */
  readonly waitForListenerEvent: (eventType: string, timeoutMs?: number) => Effect.Effect<ListenerEvent, WebSocketError, never>

  /**
   * Wait for specific Lobby event type with timeout
   */
  readonly waitForLobbyEvent: (eventType: string, timeoutMs?: number) => Effect.Effect<LobbyEvent, WebSocketError, never>
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
  
  // Separate handlers for each event type
  const djEventHandlers: Set<(event: DJEvent) => void> = new Set()
  const listenerEventHandlers: Set<(event: ListenerEvent) => void> = new Set()
  const lobbyEventHandlers: Set<(event: LobbyEvent) => void> = new Set()

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
              lobbyEventHandlers.forEach(handler => {
                try {
                  const lobbyEvent = S.decodeUnknownSync(LobbyEventSchema)(data)
                  handler(lobbyEvent)
                } catch (error) {
                  // Decoding error means it's not a valid lobby event, ignore
                }
              })
            } else {
              // Room connection handles DJ and Listener events
              djEventHandlers.forEach(handler => {
                try {
                  const djEvent = S.decodeUnknownSync(DJEventSchema)(data)
                  handler(djEvent)
                } catch (error) {
                  // Not a DJ event, ignore
                }
              })

              listenerEventHandlers.forEach(handler => {
                try {
                  const listenerEvent = S.decodeUnknownSync(ListenerEventSchema)(data)
                  handler(listenerEvent)
                } catch (error) {
                  // Not a listener event, ignore
                }
              })
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

  // Generic wait for event function
  const waitForEvent = <T>(
    eventType: string,
    handlers: Set<(event: T) => void>,
    eventName: string,
    timeoutMs = 30000
  ): Effect.Effect<T, WebSocketError, never> =>
    Effect.async<T, WebSocketError>((resume) => {
      const timeoutId = setTimeout(() => {
        handlers.delete(eventHandler)
        resume(Effect.fail(createWebSocketError(
          WebSocketOperation.WAIT_FOR_EVENT,
          `Timeout waiting for ${eventName} event: ${eventType}`
        )))
      }, timeoutMs)

      const eventHandler = (event: T) => {
        // Check if this is the event type we're waiting for
        if ((event as any).type === eventType) {
          clearTimeout(timeoutId)
          handlers.delete(eventHandler)
          resume(Effect.succeed(event))
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

    sendDJCommand: (command: DJCommand) =>
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

    sendListenerCommand: (command: ListenerCommand) =>
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

    sendLobbyCommand: (command: LobbyCommand) =>
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
        djEventHandlers.add(handler)
        return () => {
          djEventHandlers.delete(handler)
        }
      }),

    subscribeListenerEvents: (handler: (event: ListenerEvent) => void) =>
      Effect.gen(function* () {
        listenerEventHandlers.add(handler)
        return () => {
          listenerEventHandlers.delete(handler)
        }
      }),

    subscribeLobbyEvents: (handler: (event: LobbyEvent) => void) =>
      Effect.gen(function* () {
        lobbyEventHandlers.add(handler)
        return () => {
          lobbyEventHandlers.delete(handler)
        }
      }),

    waitForDJEvent: (eventType: string, timeoutMs = 30000) =>
      waitForEvent<DJEvent>(eventType, djEventHandlers, 'DJ', timeoutMs),

    waitForListenerEvent: (eventType: string, timeoutMs = 30000) =>
      waitForEvent<ListenerEvent>(eventType, listenerEventHandlers, 'Listener', timeoutMs),

    waitForLobbyEvent: (eventType: string, timeoutMs = 30000) =>
      waitForEvent<LobbyEvent>(eventType, lobbyEventHandlers, 'Lobby', timeoutMs)
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