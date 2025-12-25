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

import { Effect, Context, Layer, Option, pipe, Schema as S, Deferred, Ref, Match } from 'effect'
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
  WebSocketOperation, 
  WsConnectionState 
} from '../../domain/schemas/connection.schema'
import { ConnectionAdapter } from '../../stores'

// Union types for events (use Schema.Type for receiving)
type DJEvent = S.Schema.Type<typeof DJEventSchema>
type ListenerEvent = S.Schema.Type<typeof ListenerEventSchema>
type LobbyEvent = S.Schema.Type<typeof LobbyEventSchema>

// Default timeout for all WebSocket operations
const DEFAULT_WEBSOCKET_TIMEOUT = 30000 // 30 seconds

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
   * Unified command sending with explicit response type
   * Caller must specify the expected response type via generic
   */
  readonly sendCommand: <T>(
    command: DJCommandType | ListenerCommandType | LobbyCommandType
  ) => Effect.Effect<T, WebSocketError, never>
  
  /**
   * Direct command sending (fire and forget) - internal use only
   */
  readonly sendDJCommand: (command: DJCommandType) => Effect.Effect<void, WebSocketError, never>
  readonly sendListenerCommand: (command: ListenerCommandType) => Effect.Effect<void, WebSocketError, never> 
  readonly sendLobbyCommand: (command: LobbyCommandType) => Effect.Effect<void, WebSocketError, never>

  /**
   * Subscribe to DJ events (for streaming/ongoing events not tied to specific commands)
   */
  readonly subscribeDJEvents: (handler: (event: DJEvent) => void) => Effect.Effect<() => void, WebSocketError, never>

  /**
   * Subscribe to Listener events (for streaming/ongoing events not tied to specific commands)
   */
  readonly subscribeListenerEvents: (handler: (event: ListenerEvent) => void) => Effect.Effect<() => void, WebSocketError, never>

  /**
   * Subscribe to Lobby events (for streaming/ongoing events not tied to specific commands)  
   */
  readonly subscribeLobbyEvents: (handler: (event: LobbyEvent) => void) => Effect.Effect<() => void, WebSocketError, never>
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

  // Deferred-based pending events for command/response correlation
  const pendingDJEvents = Ref.unsafeMake<Map<string, Deferred.Deferred<any, WebSocketError>>>(new Map())
  const pendingListenerEvents = Ref.unsafeMake<Map<string, Deferred.Deferred<any, WebSocketError>>>(new Map())
  const pendingLobbyEvents = Ref.unsafeMake<Map<string, Deferred.Deferred<any, WebSocketError>>>(new Map())


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
            // Clear pending lobby events
            Effect.runSync(Ref.set(pendingLobbyEvents, new Map()))
          } else {
            djEventHandlers.clear()
            listenerEventHandlers.clear()
            // Clear pending DJ and listener events
            Effect.runSync(Ref.set(pendingDJEvents, new Map()))
            Effect.runSync(Ref.set(pendingListenerEvents, new Map()))
          }
        }

        ws.onmessage = (message) => {
          try {
            const data = JSON.parse(message.data)
            const eventType = typeof data === 'object' && data !== null && 'type' in data ? (data as any).type : null
            
            if (connectionType === 'lobby') {
              // Check for pending Deferred first - try both eventType and all pending keys
              if (eventType) {
                Effect.runSync(pipe(
                  Ref.get(pendingLobbyEvents),
                  Effect.flatMap(pending => {
                    // First try exact eventType match
                    let deferred = pending.get(eventType)
                    if (deferred) {
                      pending.delete(eventType)
                      return Deferred.succeed(deferred, data as LobbyEvent)
                    }
                    
                    // Then try to find any pending deferred that might be waiting for this event
                    for (const [key, def] of pending.entries()) {
                      if (key.includes('response_')) {
                        pending.delete(key)
                        return Deferred.succeed(def, data as LobbyEvent)
                      }
                    }
                    return Effect.void
                  })
                ))
              }
              // Always notify regular handlers
              lobbyEventHandlers.forEach(handler => handler(data))
            } else {
              // Check for pending Deferred in both DJ and Listener maps
              if (eventType) {
                Effect.runSync(pipe(
                  Ref.get(pendingDJEvents),
                  Effect.flatMap(pending => {
                    // First try exact eventType match
                    let deferred = pending.get(eventType)
                    if (deferred) {
                      pending.delete(eventType)
                      return Deferred.succeed(deferred, data as DJEvent)
                    }
                    
                    // Then try to find any pending deferred that might be waiting for this event
                    for (const [key, def] of pending.entries()) {
                      if (key.includes('response_')) {
                        pending.delete(key)
                        return Deferred.succeed(def, data as DJEvent)
                      }
                    }
                    return Effect.void
                  })
                ))
                
                Effect.runSync(pipe(
                  Ref.get(pendingListenerEvents),
                  Effect.flatMap(pending => {
                    // First try exact eventType match
                    let deferred = pending.get(eventType)
                    if (deferred) {
                      pending.delete(eventType)
                      return Deferred.succeed(deferred, data as ListenerEvent)
                    }
                    
                    // Then try to find any pending deferred that might be waiting for this event
                    for (const [key, def] of pending.entries()) {
                      if (key.includes('response_')) {
                        pending.delete(key)
                        return Deferred.succeed(def, data as ListenerEvent)
                      }
                    }
                    return Effect.void
                  })
                ))
              }
              // Always notify regular handlers
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

  // Internal helper functions for type-safe command handling (not exposed in interface)
  const sendDJCommandInternal = <T>(command: DJCommandType): Effect.Effect<T, WebSocketError, never> =>
    Effect.gen(function* () {
      console.info(`⏳ WebSocketClient: Sending DJ command: ${command.type}`)
      
      const tempEventKey = `response_${command.type}_${Date.now()}`
      const deferred = yield* Deferred.make<T, WebSocketError>()
      
      yield* Ref.update(pendingDJEvents, pending => {
        pending.set(tempEventKey, deferred)
        return pending
      })

      yield* Effect.try({
        try: () => S.encodeSync(DJCommandSchema)(command),
        catch: (error) => createWebSocketError(
          WebSocketOperation.ENCODE,
          'Failed to encode DJ command',
          error
        )
      }).pipe(
        Effect.flatMap(encoded => sendEncodedCommand(encoded, 'room'))
      )

      return yield* pipe(
        Deferred.await(deferred),
        Effect.timeout(DEFAULT_WEBSOCKET_TIMEOUT),
        Effect.catchAll((error) => {
          return Effect.gen(function* () {
            yield* Ref.update(pendingDJEvents, pending => {
              pending.delete(tempEventKey)
              return pending
            })
            
            if (error._tag === 'TimeoutException') {
              return yield* Effect.fail(createWebSocketError(
                WebSocketOperation.WAIT_FOR_EVENT,
                `Timeout waiting for DJ response: ${command.type}`
              ))
            }
            
            return yield* Effect.fail(error as WebSocketError)
          })
        }),
        Effect.tap(() => Effect.sync(() => {
          console.info(`✅ WebSocketClient: Received DJ response: ${command.type}`)
        }))
      )
    })

  const sendListenerCommandInternal = <T>(command: ListenerCommandType): Effect.Effect<T, WebSocketError, never> =>
    Effect.gen(function* () {
      console.info(`⏳ WebSocketClient: Sending Listener command: ${command.type}`)
      
      const tempEventKey = `response_${command.type}_${Date.now()}`
      const deferred = yield* Deferred.make<T, WebSocketError>()
      
      yield* Ref.update(pendingListenerEvents, pending => {
        pending.set(tempEventKey, deferred)
        return pending
      })

      yield* Effect.try({
        try: () => S.encodeSync(ListenerCommandSchema)(command),
        catch: (error) => createWebSocketError(
          WebSocketOperation.ENCODE,
          'Failed to encode Listener command',
          error
        )
      }).pipe(
        Effect.flatMap(encoded => sendEncodedCommand(encoded, 'room'))
      )

      return yield* pipe(
        Deferred.await(deferred),
        Effect.timeout(DEFAULT_WEBSOCKET_TIMEOUT),
        Effect.catchAll((error) => {
          return Effect.gen(function* () {
            yield* Ref.update(pendingListenerEvents, pending => {
              pending.delete(tempEventKey)
              return pending
            })
            
            if (error._tag === 'TimeoutException') {
              return yield* Effect.fail(createWebSocketError(
                WebSocketOperation.WAIT_FOR_EVENT,
                `Timeout waiting for Listener response: ${command.type}`
              ))
            }
            
            return yield* Effect.fail(error as WebSocketError)
          })
        }),
        Effect.tap(() => Effect.sync(() => {
          console.info(`✅ WebSocketClient: Received Listener response: ${command.type}`)
        }))
      )
    })

  const sendLobbyCommandInternal = <T>(command: LobbyCommandType): Effect.Effect<T, WebSocketError, never> =>
    Effect.gen(function* () {
      console.info(`⏳ WebSocketClient: Sending Lobby command: ${command.type}`)
      
      const tempEventKey = `response_${command.type}_${Date.now()}`
      const deferred = yield* Deferred.make<T, WebSocketError>()
      
      yield* Ref.update(pendingLobbyEvents, pending => {
        pending.set(tempEventKey, deferred)
        return pending
      })

      yield* Effect.try({
        try: () => S.encodeSync(LobbyCommandSchema)(command),
        catch: (error) => createWebSocketError(
          WebSocketOperation.ENCODE,
          'Failed to encode Lobby command',
          error
        )
      }).pipe(
        Effect.flatMap(encoded => sendEncodedCommand(encoded, 'lobby'))
      )

      return yield* pipe(
        Deferred.await(deferred),
        Effect.timeout(DEFAULT_WEBSOCKET_TIMEOUT),
        Effect.catchAll((error) => {
          return Effect.gen(function* () {
            yield* Ref.update(pendingLobbyEvents, pending => {
              pending.delete(tempEventKey)
              return pending
            })
            
            if (error._tag === 'TimeoutException') {
              return yield* Effect.fail(createWebSocketError(
                WebSocketOperation.WAIT_FOR_EVENT,
                `Timeout waiting for Lobby response: ${command.type}`
              ))
            }
            
            return yield* Effect.fail(error as WebSocketError)
          })
        }),
        Effect.tap(() => Effect.sync(() => {
          console.info(`✅ WebSocketClient: Received Lobby response: ${command.type}`)
        }))
      )
    })



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
        Effect.runSync(Ref.set(pendingLobbyEvents, new Map()))
        connectionAdapter.setLobbyWSState(WsConnectionState.DISCONNECTED)
      } else {
        djEventHandlers.clear()
        listenerEventHandlers.clear()
        Effect.runSync(Ref.set(pendingDJEvents, new Map()))
        Effect.runSync(Ref.set(pendingListenerEvents, new Map()))
        connectionAdapter.setRoomWSState(WsConnectionState.DISCONNECTED)
      }
    }) as Effect.Effect<void, never, never>


  const service: WebSocketClientServiceImpl = {
    connectLobby: (url: string): Effect.Effect<void, WebSocketError, ConnectionAdapter> =>
      Effect.gen(function* () {
        const connectionAdapter = yield* ConnectionAdapter
        yield* createConnection(url, 'lobby', connectionAdapter)
      }) as Effect.Effect<void, WebSocketError, ConnectionAdapter>,

    connectRoom: (url: string): Effect.Effect<void, WebSocketError, ConnectionAdapter> =>
      Effect.gen(function* () {
        const connectionAdapter = yield* ConnectionAdapter
        
        // Check if already connected to this URL
        const currentConnection = connections.room
        const isAlreadyConnected = pipe(
          currentConnection.websocket,
          Option.match({
            onNone: () => false,
            onSome: (ws) => ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING
          })
        ) && pipe(
          currentConnection.url,
          Option.match({
            onNone: () => false,
            onSome: (currentUrl) => currentUrl === url
          })
        )

        if (isAlreadyConnected) {
          console.info('🔗 WebSocketClient: Already connected to room WebSocket, skipping connection')
          return
        }

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

    // Specific typed command methods for direct sending
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

    // Unified command wrapper using Effect Match pattern for type narrowing
    sendCommand: <T>(
      command: DJCommandType | ListenerCommandType | LobbyCommandType
    ): Effect.Effect<T, WebSocketError, never> => 
      pipe(
        Match.value(command),
        Match.when(
          (cmd): cmd is DJCommandType => S.is(DJCommandSchema)(cmd),
          (djCommand) => sendDJCommandInternal<T>(djCommand)
        ),
        Match.when(
          (cmd): cmd is ListenerCommandType => S.is(ListenerCommandSchema)(cmd),
          (listenerCommand) => sendListenerCommandInternal<T>(listenerCommand)
        ),
        Match.when(
          (cmd): cmd is LobbyCommandType => S.is(LobbyCommandSchema)(cmd),
          (lobbyCommand) => sendLobbyCommandInternal<T>(lobbyCommand)
        ),
        Match.orElse(() => Effect.fail(createWebSocketError(
          WebSocketOperation.SEND,
          'Unknown command type - command does not match any known schema'
        )))
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