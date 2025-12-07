/**
 * WebSocket Service - Effect-TS Integration
 * 
 * Provides typed WebSocket communication with Effect-TS patterns including:
 * - Connection management with automatic reconnection
 * - Message validation and serialization
 * - Trace context injection
 * - Message queueing for offline states
 */

import { Effect, pipe, Queue, Ref, Option } from 'effect'
import type { 
  ClientCommand, 
  ServerEvent, 
  LobbyEvent,
  TraceContext 
} from '../models/websocket'

/**
 * WebSocket service errors
 */
export class WebSocketServiceError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message)
    this.name = 'WebSocketServiceError'
  }
}

export class ConnectionError extends WebSocketServiceError {
  constructor(url: string, cause?: unknown) {
    super(`Failed to connect to WebSocket: ${url}`, cause)
    this.name = 'ConnectionError'
  }
}

export class SendError extends WebSocketServiceError {
  constructor(message: string, cause?: unknown) {
    super(`Failed to send message: ${message}`, cause)
    this.name = 'SendError'
  }
}

export class ValidationError extends WebSocketServiceError {
  constructor(message: string) {
    super(`Message validation failed: ${message}`)
    this.name = 'ValidationError'
  }
}

/**
 * WebSocket connection state
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'

/**
 * WebSocket service configuration
 */
export interface WebSocketConfig {
  /** Base URL for WebSocket connections */
  baseUrl: string
  /** Maximum number of reconnection attempts */
  maxReconnectAttempts: number
  /** Base delay for exponential backoff (ms) */
  reconnectDelay: number
  /** Maximum delay between reconnection attempts (ms) */
  maxReconnectDelay: number
  /** Message queue size limit */
  queueLimit: number
  /** Enable trace context injection */
  enableTracing: boolean
}

/**
 * Default WebSocket configuration
 */
export const defaultWebSocketConfig: WebSocketConfig = {
  baseUrl: 'ws://localhost:3000',
  maxReconnectAttempts: 5,
  reconnectDelay: 1000,
  maxReconnectDelay: 30000,
  queueLimit: 100,
  enableTracing: true,
}

/**
 * WebSocket service interface
 */
export interface WebSocketService {
  /** Connect to WebSocket endpoint */
  connect: (path: string) => Effect.Effect<void, ConnectionError>
  /** Disconnect from WebSocket */
  disconnect: () => Effect.Effect<void, never>
  /** Send client command */
  sendCommand: (command: ClientCommand) => Effect.Effect<void, SendError>
  /** Subscribe to server events */
  subscribeToEvents: <T extends ServerEvent | LobbyEvent>(
    filter: (event: ServerEvent | LobbyEvent) => event is T,
    handler: (event: T) => void
  ) => Effect.Effect<() => void, never>
  /** Get current connection state */
  getConnectionState: () => Effect.Effect<ConnectionState, never>
  /** Enable/disable automatic reconnection */
  setAutoReconnect: (enabled: boolean) => Effect.Effect<void, never>
}

/**
 * Create WebSocket service with Effect-TS integration
 */
export const createWebSocketService = (
  config: Partial<WebSocketConfig> = {}
): Effect.Effect<WebSocketService, never> => {
  const finalConfig = { ...defaultWebSocketConfig, ...config }

  return Effect.gen(function* (_) {
    // Service state
    const connectionState = yield* _(Ref.make<ConnectionState>('disconnected'))
    const websocket = yield* _(Ref.make<WebSocket | null>(null))
    const messageQueue = yield* _(Queue.bounded<ClientCommand>(finalConfig.queueLimit))
    const eventHandlers = yield* _(Ref.make<Array<(event: ServerEvent | LobbyEvent) => void>>([]))
    const autoReconnect = yield* _(Ref.make(true))
    const currentUrl = yield* _(Ref.make<string | null>(null))
    const reconnectAttempts = yield* _(Ref.make(0))

    /**
     * Validate and inject trace context into messages
     */
    const enrichMessage = (message: ClientCommand): Effect.Effect<ClientCommand, never> =>
      Effect.sync(() => {
        if (!finalConfig.enableTracing) return message

        // Generate trace context if not present
        if (Option.isNone(message._traceContext)) {
          const traceContext: TraceContext = {
            traceparent: `00-${generateTraceId()}-${generateSpanId()}-01`,
            tracestate: Option.none(),
            metadata: Option.none()
          }
          return { ...message, _traceContext: Option.some(traceContext) }
        }

        return message
      })

    /**
     * Validate incoming messages
     */
    const validateMessage = (data: unknown): Effect.Effect<ServerEvent | LobbyEvent, ValidationError> =>
      pipe(
        Effect.try(() => {
          if (typeof data !== 'object' || data === null) {
            throw new ValidationError('Message must be an object')
          }

          const message = data as any
          if (typeof message.type !== 'string') {
            throw new ValidationError('Message must have a type field')
          }

          return message as ServerEvent | LobbyEvent
        }),
        Effect.catchAll((error) =>
          Effect.fail(
            error instanceof ValidationError 
              ? error 
              : new ValidationError(String(error))
          )
        )
      )

    /**
     * Process queued messages when connection is established
     */
    const processMessageQueue = (): Effect.Effect<void, never> =>
      pipe(
        Queue.takeAll(messageQueue),
        Effect.andThen((messages) =>
          Effect.forEach(messages, (message) =>
            pipe(
              sendCommandDirect(message),
              Effect.catchAll((error) =>
                Effect.logError(`Failed to send queued message: ${error.message}`)
              )
            ),
            { discard: true }
          )
        )
      )

    /**
     * Send command directly to WebSocket (internal)
     */
    const sendCommandDirect = (command: ClientCommand): Effect.Effect<void, SendError> =>
      pipe(
        Ref.get(websocket),
        Effect.andThen((ws) => {
          if (!ws || ws.readyState !== WebSocket.OPEN) {
            return Effect.fail(new SendError('WebSocket not connected'))
          }

          return pipe(
            enrichMessage(command),
            Effect.andThen((enrichedCommand) =>
              Effect.try(() => {
                ws.send(JSON.stringify(enrichedCommand))
              })
            ),
            Effect.catchAll((error) =>
              Effect.fail(new SendError(command.type, error))
            ),
            Effect.tap(() => Effect.logDebug(`Sent command: ${command.type}`))
          )
        })
      )

    /**
     * Handle incoming WebSocket messages
     */
    const handleMessage = (event: MessageEvent): Effect.Effect<void, never> =>
      pipe(
        Effect.try(() => JSON.parse(event.data)),
        Effect.andThen(validateMessage),
        Effect.andThen((message) =>
          pipe(
            Ref.get(eventHandlers),
            Effect.andThen((handlers) =>
              Effect.sync(() => {
                handlers.forEach((handler) => {
                  try {
                    handler(message)
                  } catch (error) {
                    console.error('Event handler error:', error)
                  }
                })
              })
            ),
            Effect.tap(() => Effect.logDebug(`Received event: ${message.type}`))
          )
        ),
        Effect.catchAll((error) =>
          Effect.logError(`Failed to handle message: ${error.message}`)
        )
      )

    /**
     * Setup WebSocket event handlers
     */
    const setupWebSocketHandlers = (ws: WebSocket): Effect.Effect<void, never> =>
      Effect.sync(() => {
        ws.onopen = () => {
          Effect.runSync(pipe(
            Ref.set(connectionState, 'connected'),
            Effect.andThen(() => Ref.set(reconnectAttempts, 0)),
            Effect.andThen(() => processMessageQueue()),
            Effect.andThen(() => Effect.logInfo('WebSocket connected'))
          ))
        }

        ws.onmessage = (event) => {
          Effect.runFork(handleMessage(event))
        }

        ws.onclose = () => {
          Effect.runSync(pipe(
            Ref.set(connectionState, 'disconnected'),
            Effect.andThen(() => Ref.set(websocket, null)),
            Effect.andThen(() => scheduleReconnect()),
            Effect.andThen(() => Effect.logInfo('WebSocket disconnected'))
          ))
        }

        ws.onerror = () => {
          Effect.runSync(pipe(
            Ref.set(connectionState, 'error'),
            Effect.andThen(() => Effect.logError('WebSocket error'))
          ))
        }
      })

    /**
     * Schedule reconnection with exponential backoff
     */
    const scheduleReconnect = (): Effect.Effect<void, never> =>
      pipe(
        Ref.get(autoReconnect),
        Effect.andThen((shouldReconnect) => {
          if (!shouldReconnect) return Effect.void

          return pipe(
            Ref.get(reconnectAttempts),
            Effect.andThen((attempts) => {
              if (attempts >= finalConfig.maxReconnectAttempts) {
                return pipe(
                  Ref.set(connectionState, 'error'),
                  Effect.andThen(() => Effect.logError('Max reconnection attempts reached'))
                )
              }

              const delay = Math.min(
                finalConfig.reconnectDelay * Math.pow(2, attempts),
                finalConfig.maxReconnectDelay
              )

              return pipe(
                Ref.set(connectionState, 'reconnecting'),
                Effect.andThen(() => Ref.update(reconnectAttempts, (n) => n + 1)),
                Effect.andThen(() => Effect.logInfo(`Reconnecting in ${delay}ms (attempt ${attempts + 1})`)),
                Effect.andThen(() => Effect.sleep(delay)),
                Effect.andThen(() => Ref.get(currentUrl)),
                Effect.andThen((url) => 
                  url 
                    ? pipe(
                        connectInternal(url),
                        Effect.catchAll(() => scheduleReconnect())
                      )
                    : Effect.void
                )
              )
            })
          )
        })
      )

    /**
     * Internal connection logic
     */
    const connectInternal = (url: string): Effect.Effect<void, ConnectionError> =>
      pipe(
        Ref.set(connectionState, 'connecting'),
        Effect.andThen(() => Effect.logInfo(`Connecting to WebSocket: ${url}`)),
        Effect.andThen(() =>
          Effect.async<WebSocket, ConnectionError>((resume) => {
            const ws = new WebSocket(url)
            
            const onOpen = () => {
              cleanup()
              resume(Effect.succeed(ws))
            }
            
            const onError = () => {
              cleanup()
              resume(Effect.fail(new ConnectionError(url)))
            }
            
            const cleanup = () => {
              ws.removeEventListener('open', onOpen)
              ws.removeEventListener('error', onError)
            }
            
            ws.addEventListener('open', onOpen)
            ws.addEventListener('error', onError)
            
            return Effect.sync(cleanup)
          })
        ),
        Effect.andThen((ws) =>
          pipe(
            Ref.set(websocket, ws),
            Effect.andThen(() => setupWebSocketHandlers(ws))
          )
        ),
        Effect.catchAll((error) =>
          pipe(
            Ref.set(connectionState, 'error'),
            Effect.andThen(() => Effect.fail(error))
          )
        )
      )

    /**
     * Public API implementation
     */
    const connect = (path: string): Effect.Effect<void, ConnectionError> => {
      const url = `${finalConfig.baseUrl}${path}`
      return pipe(
        Ref.set(currentUrl, url),
        Effect.andThen(() => connectInternal(url))
      )
    }

    const disconnect = (): Effect.Effect<void, never> =>
      pipe(
        Ref.set(autoReconnect, false),
        Effect.andThen(() => Ref.get(websocket)),
        Effect.andThen((ws) => {
          if (ws) {
            ws.close()
          }
          return Effect.void
        }),
        Effect.andThen(() => Ref.set(websocket, null)),
        Effect.andThen(() => Ref.set(connectionState, 'disconnected'))
      )

    const sendCommand = (command: ClientCommand): Effect.Effect<void, SendError> =>
      pipe(
        Ref.get(connectionState),
        Effect.andThen((state) => {
          if (state === 'connected') {
            return sendCommandDirect(command)
          } else {
            // Queue message for later delivery
            return pipe(
              Queue.offer(messageQueue, command),
              Effect.andThen(() => Effect.logDebug(`Queued command: ${command.type}`)),
              Effect.catchAll(() => Effect.fail(new SendError('Message queue full')))
            )
          }
        })
      )

    const subscribeToEvents = <T extends ServerEvent | LobbyEvent>(
      filter: (event: ServerEvent | LobbyEvent) => event is T,
      handler: (event: T) => void
    ): Effect.Effect<() => void, never> =>
      pipe(
        Effect.sync(() => {
          const wrappedHandler = (event: ServerEvent | LobbyEvent) => {
            if (filter(event)) {
              handler(event)
            }
          }
          return wrappedHandler
        }),
        Effect.andThen((wrappedHandler) =>
          pipe(
            Ref.update(eventHandlers, (handlers) => [...handlers, wrappedHandler]),
            Effect.map(() => () => {
              Effect.runSync(
                Ref.update(eventHandlers, (handlers) =>
                  handlers.filter((h) => h !== wrappedHandler)
                )
              )
            })
          )
        )
      )

    const getConnectionState = (): Effect.Effect<ConnectionState, never> =>
      Ref.get(connectionState)

    const setAutoReconnect = (enabled: boolean): Effect.Effect<void, never> =>
      Ref.set(autoReconnect, enabled)

    return {
      connect,
      disconnect,
      sendCommand,
      subscribeToEvents,
      getConnectionState,
      setAutoReconnect,
    }
  })
}

/**
 * Utility functions
 */
const generateTraceId = (): string => {
  return Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('')
}

const generateSpanId = (): string => {
  return Array.from({ length: 8 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('')
}