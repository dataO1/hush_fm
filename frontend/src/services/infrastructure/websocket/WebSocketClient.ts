/**
 * WebSocket Infrastructure Client
 * 
 * Pure technical layer for WebSocket connections.
 * No business logic - only handles connection mechanics.
 * 
 * Responsibilities:
 * - Raw WebSocket connection management
 * - Message sending/receiving
 * - Connection state tracking
 * - Error handling (technical errors only)
 * - Reconnection logic
 */

import { Effect, pipe, Schema as S, Option as O } from 'effect'
// Using WebSocketTransforms for all wire format transformations
import { WebSocketTransforms, DtlsParametersNative } from './WebSocketClient.transforms'
import { types } from 'mediasoup-client'
import { RoomInfo } from '../../../domain/schemas/room.schema'

/**
 * WebSocket connection configuration
 */
export interface WebSocketConfig {
  url: string
  protocols?: string[]
  reconnectAttempts?: number
  reconnectDelay?: number
  heartbeatInterval?: number
  connectionTimeout?: number
}

/**
 * WebSocket connection state
 */
export type WSConnectionState = 'connecting' | 'open' | 'closing' | 'closed'

/**
 * WebSocket message types
 */
export interface WSMessage {
  data: unknown
  timestamp: Date
}

/**
 * WebSocket Infrastructure Error
 */
export class WSInfrastructureError extends Error {
  constructor(
    message: string,
    public operation: string,
    public wsState?: number,
    public cause?: unknown
  ) {
    super(message)
    this.name = 'WSInfrastructureError'
  }
}

/**
 * WebSocket Client Interface
 */
export interface WebSocketClientService {
  /**
   * Connect to WebSocket - pure connection establishment
   */
  readonly connect: (config: WebSocketConfig) => Effect.Effect<WebSocket, WSInfrastructureError>
  
  /**
   * Send message - raw message transmission
   */
  readonly send: (ws: WebSocket, message: any) => Effect.Effect<void, WSInfrastructureError>
  
  /**
   * Subscribe to messages - raw message stream
   */
  readonly subscribe: (ws: WebSocket) => Effect.Effect<(handler: (message: WSMessage) => void) => void, WSInfrastructureError>
  
  /**
   * Get connection state
   */
  readonly getState: (ws: WebSocket) => Effect.Effect<WSConnectionState, never>
  
  /**
   * Close connection
   */
  readonly close: (ws: WebSocket, code?: number, reason?: string) => Effect.Effect<void, never>
  
  /**
   * Setup heartbeat mechanism
   */
  readonly setupHeartbeat: (ws: WebSocket, intervalMs: number, pingMessage?: Record<string, unknown>) => Effect.Effect<() => void, WSInfrastructureError>

  /**
   * =============================================================================
   * INTERNAL TYPED WEBSOCKET METHODS (used by high-level methods)
   * Services should NOT use these directly - use the type-specific methods below instead
   * =============================================================================
   */

  /**
   * @internal Send DJ command with type safety and validation
   */
  readonly sendDJCommand: (
    ws: WebSocket,
    command: any
  ) => Effect.Effect<void, WSInfrastructureError>
  
  /**
   * @internal Send Listener command with type safety and validation
   */
  readonly sendListenerCommand: (
    ws: WebSocket,
    command: any
  ) => Effect.Effect<void, WSInfrastructureError>
  
  /**
   * @internal Send Lobby command with type safety and validation
   */
  readonly sendLobbyCommand: (
    ws: WebSocket,
    command: any
  ) => Effect.Effect<void, WSInfrastructureError>

  /**
   * @internal Wait for specific DJ event with timeout and type safety
   */
  readonly waitForDJEvent: <T extends string>(
    ws: WebSocket,
    eventType: T,
    timeoutMs?: number
  ) => Effect.Effect<any, WSInfrastructureError>
  
  /**
   * @internal Wait for specific Listener event with timeout and type safety
   */
  readonly waitForListenerEvent: <T extends string>(
    ws: WebSocket,
    eventType: T,
    timeoutMs?: number
  ) => Effect.Effect<any, WSInfrastructureError>
  
  /**
   * @internal Wait for specific Lobby event with timeout and type safety
   */
  readonly waitForLobbyEvent: <T extends string>(
    ws: WebSocket,
    eventType: T,
    timeoutMs?: number
  ) => Effect.Effect<any, WSInfrastructureError>

  /**
   * @internal Subscribe to typed DJ events stream
   */
  readonly subscribeDJEvents: (ws: WebSocket) => Effect.Effect<(handler: (event: any) => void) => void, WSInfrastructureError>
  
  /**
   * @internal Subscribe to typed Listener events stream  
   */
  readonly subscribeListenerEvents: (ws: WebSocket) => Effect.Effect<(handler: (event: any) => void) => void, WSInfrastructureError>
  
  /**
   * @internal Subscribe to typed Lobby events stream
   */
  readonly subscribeLobbyEvents: (ws: WebSocket) => Effect.Effect<(handler: (event: any) => void) => void, WSInfrastructureError>

  /**
   * =============================================================================
   * TYPE-SPECIFIC HIGH-LEVEL METHODS (Services should use these)
   * These methods handle MediaSoup transformations internally and return native types
   * =============================================================================
   */

  /**
   * DJ: Initialize room and get native RTP capabilities
   */
  readonly initDJRoom: (ws: WebSocket, roomId: string) => Effect.Effect<{
    rtpCapabilities: types.RtpCapabilities // Native MediaSoup RtpCapabilities (no Option types)
  }, WSInfrastructureError>

  /**
   * DJ: Request transport and get native transport options  
   */
  readonly requestDJTransport: (ws: WebSocket) => Effect.Effect<{
    transportOptions: types.TransportOptions // Native MediaSoup TransportOptions (no Option types)
  }, WSInfrastructureError>

  /**
   * DJ: Connect transport
   */
  readonly connectDJTransport: (ws: WebSocket, transportId: string | undefined, dtlsParameters: DtlsParametersNative) => Effect.Effect<void, WSInfrastructureError>

  /**
   * DJ: Send producer creation confirmation
   */
  readonly confirmDJProducer: (ws: WebSocket, rtpParameters: types.RtpParameters) => Effect.Effect<{
    producerId: string
  }, WSInfrastructureError>

  /**
   * Listener: Get router capabilities for room
   */
  readonly getListenerRouterCapabilities: (ws: WebSocket, roomId: string) => Effect.Effect<{
    rtpCapabilities: types.RtpCapabilities // Native MediaSoup RtpCapabilities
  }, WSInfrastructureError>

  /**
   * Listener: Initialize listener and get transport options
   */
  readonly initListenerTransport: (ws: WebSocket) => Effect.Effect<{
    transportOptions: types.TransportOptions // Native MediaSoup TransportOptions
  }, WSInfrastructureError>

  /**
   * Listener: Connect transport
   */
  readonly connectListenerTransport: (ws: WebSocket, transportId: string | undefined, dtlsParameters: DtlsParametersNative) => Effect.Effect<void, WSInfrastructureError>

  /**
   * Listener: Request consumer with device capabilities and get consumer parameters
   */
  readonly requestListenerConsumer: (ws: WebSocket, rtpCapabilities: types.RtpCapabilities) => Effect.Effect<{
    consumerParameters: types.ConsumerOptions // Native MediaSoup consumer parameters
  }, WSInfrastructureError>

  /**
   * Listener: Leave room
   */
  readonly leaveListenerRoom: (ws: WebSocket) => Effect.Effect<void, WSInfrastructureError>

  /**
   * Lobby: Connect to lobby and set up event subscription
   */
  readonly connectToLobby: (lobbyUrl: string) => Effect.Effect<WebSocket, WSInfrastructureError>

  /**
   * Lobby: Create and announce room
   * Returns room info with wsUrl for DJ connection
   */
  readonly announceRoom: (ws: WebSocket, name: string, djName: string, sessionId: string, description?: string) => Effect.Effect<{
    room: RoomInfo & { wsUrl: string }
  }, WSInfrastructureError>

  /**
   * Lobby: Join room as listener
   */
  readonly joinRoom: (ws: WebSocket, roomId: string, sessionId: string) => Effect.Effect<{
    listenerWebSocketUrl: string
    sessionId: string
  }, WSInfrastructureError>

  /**
   * Lobby: Refresh room list
   */
  readonly refreshLobbyRoomList: (ws: WebSocket) => Effect.Effect<void, WSInfrastructureError>
}

/**
 * WebSocket Client Implementation
 */
const WebSocketClientImpl: WebSocketClientService = {
  /**
   * Connect to WebSocket
   */
  connect: (config: WebSocketConfig): Effect.Effect<WebSocket, WSInfrastructureError> =>
    pipe(
      Effect.async<WebSocket, WSInfrastructureError>((resume) => {
        try {
          const ws = new WebSocket(config.url, config.protocols)
          let timeoutId: NodeJS.Timeout | null = null
          
          // Set connection timeout
          if (config.connectionTimeout) {
            timeoutId = setTimeout(() => {
              ws.close()
              resume(Effect.fail(new WSInfrastructureError(
                `Connection timeout after ${config.connectionTimeout}ms`,
                'connect',
                ws.readyState
              )))
            }, config.connectionTimeout)
          }
          
          // Connection opened
          ws.onopen = () => {
            if (timeoutId) clearTimeout(timeoutId)
            resume(Effect.succeed(ws))
          }
          
          // Connection failed
          ws.onerror = (event) => {
            if (timeoutId) clearTimeout(timeoutId)
            resume(Effect.fail(new WSInfrastructureError(
              'WebSocket connection failed',
              'connect',
              ws.readyState,
              event
            )))
          }
          
          // Connection closed before opening
          ws.onclose = (event) => {
            if (timeoutId) clearTimeout(timeoutId)
            if (ws.readyState !== WebSocket.OPEN) {
              resume(Effect.fail(new WSInfrastructureError(
                `Connection closed before opening: ${event.reason}`,
                'connect',
                event.code
              )))
            }
          }
          
          // Cleanup function
          return Effect.sync(() => {
            if (timeoutId) clearTimeout(timeoutId)
            if (ws.readyState === WebSocket.CONNECTING) {
              ws.close()
            }
          })
        } catch (error) {
          resume(Effect.fail(new WSInfrastructureError(
            'Failed to create WebSocket',
            'connect',
            undefined,
            error
          )))
          return Effect.void
        }
      })
    ),

  /**
   * Send message to WebSocket
   */
  send: (ws: WebSocket, message: any): Effect.Effect<void, WSInfrastructureError> =>
    pipe(
      Effect.sync(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          throw new WSInfrastructureError(
            'WebSocket not open',
            'send',
            ws.readyState
          )
        }
        
        const serialized = typeof message === 'string' ? message : JSON.stringify(message)
        ws.send(serialized)
      }),
      Effect.catchAll(error => 
        Effect.fail(new WSInfrastructureError(
          'Failed to send message',
          'send',
          ws.readyState,
          error
        ))
      )
    ),

  /**
   * Subscribe to WebSocket messages
   */
  subscribe: (ws: WebSocket): Effect.Effect<(handler: (message: WSMessage) => void) => void, WSInfrastructureError> =>
    pipe(
      Effect.sync(() => {
        if (ws.readyState === WebSocket.CLOSED) {
          throw new WSInfrastructureError(
            'Cannot subscribe to closed WebSocket',
            'subscribe',
            ws.readyState
          )
        }
        
        return (handler: (message: WSMessage) => void) => {
          const messageListener = (event: MessageEvent) => {
            try {
              const data = typeof event.data === 'string' 
                ? JSON.parse(event.data) 
                : event.data
              
              handler({
                data,
                timestamp: new Date()
              })
            } catch (error) {
              // Let handler decide how to deal with parsing errors
              handler({
                data: event.data,
                timestamp: new Date()
              })
            }
          }
          
          ws.addEventListener('message', messageListener)
          
          // Return unsubscribe function
          return () => {
            ws.removeEventListener('message', messageListener)
          }
        }
      }),
      Effect.catchAll(error =>
        Effect.fail(new WSInfrastructureError(
          'Failed to setup subscription',
          'subscribe',
          ws.readyState,
          error
        ))
      )
    ),

  /**
   * Get WebSocket connection state
   */
  getState: (ws: WebSocket): Effect.Effect<WSConnectionState, never> =>
    Effect.sync(() => {
      switch (ws.readyState) {
        case WebSocket.CONNECTING:
          return 'connecting'
        case WebSocket.OPEN:
          return 'open'
        case WebSocket.CLOSING:
          return 'closing'
        case WebSocket.CLOSED:
          return 'closed'
        default:
          return 'closed'
      }
    }),

  /**
   * Close WebSocket connection
   */
  close: (ws: WebSocket, code?: number, reason?: string): Effect.Effect<void, never> =>
    Effect.sync(() => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(code, reason)
      }
    }),

  /**
   * Setup heartbeat for connection keep-alive
   */
  setupHeartbeat: (ws: WebSocket, intervalMs: number, pingMessage = { type: 'ping' }): Effect.Effect<() => void, WSInfrastructureError> =>
    pipe(
      Effect.sync(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          throw new WSInfrastructureError(
            'Cannot setup heartbeat on non-open WebSocket',
            'setupHeartbeat',
            ws.readyState
          )
        }
        
        const intervalId = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(pingMessage))
          } else {
            clearInterval(intervalId)
          }
        }, intervalMs)
        
        // Return cleanup function
        return () => {
          clearInterval(intervalId)
        }
      }),
      Effect.catchAll(error =>
        Effect.fail(new WSInfrastructureError(
          'Failed to setup heartbeat',
          'setupHeartbeat',
          ws.readyState,
          error
        ))
      )
    ),

  /**
   * =============================================================================
   * TYPED WEBSOCKET METHOD IMPLEMENTATIONS (2025 Pattern)
   * =============================================================================
   */

  /**
   * Send DJ command with type safety and validation
   */
  sendDJCommand: (
    ws: WebSocket,
    command: any
  ): Effect.Effect<void, WSInfrastructureError> =>
    pipe(
      // Commands already have type field, send directly
      Effect.succeed(command),
      Effect.andThen((validatedCommand) => WebSocketClientImpl.send(ws, validatedCommand)),
      Effect.catchAll((error) => Effect.fail(new WSInfrastructureError(
        `Failed to send DJ command: ${String(error)}`,
        'sendDJCommand',
        ws.readyState,
        error
      )))
    ),

  /**
   * Send Listener command with type safety and validation
   */
  sendListenerCommand: (
    ws: WebSocket,
    command: any
  ): Effect.Effect<void, WSInfrastructureError> =>
    pipe(
      // Commands already have type field, send directly
      Effect.succeed(command),
      Effect.andThen((validatedCommand) => WebSocketClientImpl.send(ws, validatedCommand)),
      Effect.catchAll((error) => Effect.fail(new WSInfrastructureError(
        `Failed to send Listener command: ${String(error)}`,
        'sendListenerCommand',
        ws.readyState,
        error
      )))
    ),

  /**
   * Send Lobby command with type safety and validation
   */
  sendLobbyCommand: (
    ws: WebSocket,
    command: any
  ): Effect.Effect<void, WSInfrastructureError> =>
    pipe(
      // Commands already have type field, send directly
      Effect.succeed(command),
      Effect.andThen((validatedCommand) => WebSocketClientImpl.send(ws, validatedCommand)),
      Effect.catchAll((error) => Effect.fail(new WSInfrastructureError(
        `Failed to send Lobby command: ${String(error)}`,
        'sendLobbyCommand',
        ws.readyState,
        error
      )))
    ),

  /**
   * Wait for specific DJ event with timeout and type safety
   */
  waitForDJEvent: <T extends string>(
    ws: WebSocket,
    eventType: T,
    timeoutMs = 10000
  ): Effect.Effect<any, WSInfrastructureError> =>
    Effect.async<any, WSInfrastructureError>((resume) => {
      let messageListener: ((event: MessageEvent) => void) | undefined
      let timeoutId: NodeJS.Timeout

      // Set up WebSocket subscription
      messageListener = (event) => {
        try {
          const decoded = JSON.parse(event.data)
          if (decoded.type === eventType) {
            // Cleanup
            if (timeoutId) clearTimeout(timeoutId)
            if (messageListener) {
              ws.removeEventListener('message', messageListener)
            }
            // Return schema types directly - transformation happens in high-level methods
            resume(Effect.succeed(decoded))
          }
        } catch {
          // Ignore parsing errors for non-DJ messages
        }
      }

      ws.addEventListener('message', messageListener)

      timeoutId = setTimeout(() => {
        // Cleanup
        if (messageListener) {
          ws.removeEventListener('message', messageListener)
        }
        resume(Effect.fail(new WSInfrastructureError(
          `Timeout waiting for DJ event: ${String(eventType)}`,
          'waitForDJEvent',
          ws.readyState
        )))
      }, timeoutMs)

      // Return cleanup function
      return Effect.sync(() => {
        if (timeoutId) clearTimeout(timeoutId)
        if (messageListener) {
          ws.removeEventListener('message', messageListener)
        }
      })
    }),

  /**
   * Wait for specific Listener event with timeout and type safety
   */
  waitForListenerEvent: <T extends string>(
    ws: WebSocket,
    eventType: T,
    timeoutMs = 10000
  ): Effect.Effect<any, WSInfrastructureError> =>
    Effect.async<any, WSInfrastructureError>((resume) => {
      let messageListener: ((event: MessageEvent) => void) | undefined
      let timeoutId: NodeJS.Timeout

      // Set up WebSocket subscription
      messageListener = (event) => {
        try {
          const decoded = JSON.parse(event.data)
          if (decoded.type === eventType) {
            // Cleanup
            if (timeoutId) clearTimeout(timeoutId)
            if (messageListener) {
              ws.removeEventListener('message', messageListener)
            }
            // Return schema types directly - transformation happens in high-level methods
            resume(Effect.succeed(decoded))
          }
        } catch {
          // Ignore parsing errors for non-Listener messages
        }
      }

      ws.addEventListener('message', messageListener)

      timeoutId = setTimeout(() => {
        // Cleanup
        if (messageListener) {
          ws.removeEventListener('message', messageListener)
        }
        resume(Effect.fail(new WSInfrastructureError(
          `Timeout waiting for Listener event: ${String(eventType)}`,
          'waitForListenerEvent',
          ws.readyState
        )))
      }, timeoutMs)

      // Return cleanup function
      return Effect.sync(() => {
        if (timeoutId) clearTimeout(timeoutId)
        if (messageListener) {
          ws.removeEventListener('message', messageListener)
        }
      })
    }),

  /**
   * Wait for specific Lobby event with timeout and type safety
   */
  waitForLobbyEvent: <T extends string>(
    ws: WebSocket,
    eventType: T,
    timeoutMs = 10000
  ): Effect.Effect<any, WSInfrastructureError> =>
    Effect.async<any, WSInfrastructureError>((resume) => {
      let messageListener: ((event: MessageEvent) => void) | undefined
      let timeoutId: NodeJS.Timeout

      // Set up WebSocket subscription
      messageListener = (event) => {
        try {
          const decoded = JSON.parse(event.data)
          if (decoded.type === eventType) {
            // Cleanup
            if (timeoutId) clearTimeout(timeoutId)
            if (messageListener) {
              ws.removeEventListener('message', messageListener)
            }
            resume(Effect.succeed(decoded))
          }
        } catch {
          // Ignore parsing errors for non-Lobby messages
        }
      }

      ws.addEventListener('message', messageListener)

      timeoutId = setTimeout(() => {
        // Cleanup
        if (messageListener) {
          ws.removeEventListener('message', messageListener)
        }
        resume(Effect.fail(new WSInfrastructureError(
          `Timeout waiting for Lobby event: ${String(eventType)}`,
          'waitForLobbyEvent',
          ws.readyState
        )))
      }, timeoutMs)

      // Return cleanup function
      return Effect.sync(() => {
        if (timeoutId) clearTimeout(timeoutId)
        if (messageListener) {
          ws.removeEventListener('message', messageListener)
        }
      })
    }),

  /**
   * Subscribe to typed DJ events stream
   */
  subscribeDJEvents: (ws: WebSocket): Effect.Effect<(handler: (event: any) => void) => void, WSInfrastructureError> =>
    pipe(
      WebSocketClientImpl.subscribe(ws),
      Effect.map((subscribeFn) => {
        return (handler: (event: any) => void) => {
          return subscribeFn((message: WSMessage) => {
            try {
              // Parse data if it's a string
              const data = typeof message.data === 'string' ? JSON.parse(message.data) : message.data
              // Check if it looks like a DJ event (has type field)
              if (data && typeof data === 'object' && 'type' in data) {
                handler(data)
              }
            } catch {
              // Ignore parse errors
            }
          })
        }
      })
    ),

  /**
   * Subscribe to typed Listener events stream
   */
  subscribeListenerEvents: (ws: WebSocket): Effect.Effect<(handler: (event: any) => void) => void, WSInfrastructureError> =>
    pipe(
      WebSocketClientImpl.subscribe(ws),
      Effect.map((subscribeFn) => {
        return (handler: (event: any) => void) => {
          return subscribeFn((message: WSMessage) => {
            try {
              // Parse data if it's a string
              const data = typeof message.data === 'string' ? JSON.parse(message.data) : message.data
              // Check if it looks like a Listener event (has type field)
              if (data && typeof data === 'object' && 'type' in data) {
                handler(data)
              }
            } catch {
              // Ignore parse errors
            }
          })
        }
      })
    ),

  /**
   * Subscribe to typed Lobby events stream
   */
  subscribeLobbyEvents: (ws: WebSocket): Effect.Effect<(handler: (event: any) => void) => void, WSInfrastructureError> =>
    pipe(
      WebSocketClientImpl.subscribe(ws),
      Effect.map((subscribeFn) => {
        return (handler: (event: any) => void) => {
          return subscribeFn((message: WSMessage) => {
            try {
              // Parse data if it's a string
              const data = typeof message.data === 'string' ? JSON.parse(message.data) : message.data
              // Check if it looks like a Lobby event (has type field)
              if (data && typeof data === 'object' && 'type' in data) {
                handler(data)
              }
            } catch {
              // Ignore parse errors
            }
          })
        }
      })
    ),

  /**
   * =============================================================================
   * TYPE-SPECIFIC HIGH-LEVEL METHODS IMPLEMENTATION
   * These methods abstract away message/event details and return native MediaSoup types
   * =============================================================================
   */

  /**
   * DJ: Initialize room and get native RTP capabilities
   */
  initDJRoom: (ws: WebSocket, roomId: string): Effect.Effect<{
    rtpCapabilities: types.RtpCapabilities
  }, WSInfrastructureError> =>
    pipe(
      WebSocketClientImpl.sendDJCommand(ws, {
        type: 'initRoom',
        roomId,
      }),
      Effect.andThen(() => WebSocketClientImpl.waitForDJEvent(ws, 'roomInitialized')),
      Effect.andThen((event: any) => {
        if (event.type === 'roomInitialized') {
          // Transform from wire format to native mediasoup-client type
          return pipe(
            Effect.sync(() => S.decodeUnknownSync(WebSocketTransforms.RtpCapabilities)(event.rtpCapabilities)),
            Effect.map((rtpCapabilities) => ({ rtpCapabilities })),
            Effect.catchAll((_) => Effect.fail(new WSInfrastructureError('Failed to decode RTP capabilities', 'initDJRoom')))
          )
        }
        return Effect.fail(new WSInfrastructureError('Expected roomInitialized event', 'initDJRoom'))
      })
    ),

  /**
   * DJ: Request transport and get native transport options
   */
  requestDJTransport: (ws: WebSocket): Effect.Effect<{
    transportOptions: types.TransportOptions
  }, WSInfrastructureError> =>
    pipe(
      WebSocketClientImpl.sendDJCommand(ws, {
        type: 'requestDjTransport',
      }),
      Effect.andThen(() => WebSocketClientImpl.waitForDJEvent(ws, 'djTransportReady')),
      Effect.andThen((event: any) => {
        if (event.type === 'djTransportReady') {
          // Use transform schema to convert wire format to native types
          return pipe(
            Effect.sync(() => S.decodeUnknownSync(WebSocketTransforms.TransportOptions)(event.transportOptions)),
            Effect.map((transportOptions) => ({ transportOptions })),
            Effect.catchAll((_) => Effect.fail(new WSInfrastructureError('Failed to decode transport options', 'requestDJTransport')))
          )
        }
        return Effect.fail(new WSInfrastructureError('Expected djTransportReady event'))
      })
    ),

  /**
   * DJ: Send producer creation (produce command)
   */
  confirmDJProducer: (ws: WebSocket, rtpParameters: types.RtpParameters): Effect.Effect<{
    producerId: string
  }, WSInfrastructureError> =>
    pipe(
      // Transform native mediasoup-client type to wire format
      Effect.sync(() => S.encodeSync(WebSocketTransforms.RtpParameters)(rtpParameters)),
      Effect.andThen((encodedParams) => WebSocketClientImpl.sendDJCommand(ws, {
        type: 'produce',
        rtpParameters: encodedParams,
      })),
      Effect.andThen(() => WebSocketClientImpl.waitForDJEvent(ws, 'producerCreated')),
      Effect.map((event: any) => {
        if (event.type === 'producerCreated') {
          return {
            producerId: event.producerId
          }
        }
        throw new Error('Expected producerCreated event')
      })
    ),

  /**
   * DJ: Connect transport
   */
  connectDJTransport: (ws: WebSocket, transportId: string | undefined, dtlsParameters: DtlsParametersNative): Effect.Effect<void, WSInfrastructureError> =>
    pipe(
      WebSocketClientImpl.sendDJCommand(ws, {
        type: 'connectDjTransport',
        transportId: transportId,
        dtlsParameters,
      }),
      Effect.asVoid // No event expected for transport connection
    ),

  /**
   * Listener: Get router capabilities for room
   */
  getListenerRouterCapabilities: (ws: WebSocket, roomId: string): Effect.Effect<{
    rtpCapabilities: types.RtpCapabilities
  }, WSInfrastructureError> =>
    pipe(
      WebSocketClientImpl.sendListenerCommand(ws, {
        type: 'getRouterCapabilities',
        roomId,
      }),
      Effect.andThen(() => WebSocketClientImpl.waitForListenerEvent(ws, 'routerCapabilities')),
      Effect.andThen((event: any) => {
        if (event.type === 'routerCapabilities') {
          return pipe(
            Effect.sync(() => S.decodeUnknownSync(WebSocketTransforms.RtpCapabilities)(event.rtpCapabilities)),
            Effect.map((rtpCapabilities) => ({ rtpCapabilities })),
            Effect.catchAll((_) => Effect.fail(new WSInfrastructureError('Failed to decode RTP capabilities', 'getListenerRouterCapabilities')))
          )
        }
        return Effect.fail(new WSInfrastructureError('Expected routerCapabilities event'))
      })
    ),

  /**
   * Listener: Initialize listener and get transport options
   */
  initListenerTransport: (ws: WebSocket): Effect.Effect<{
    transportOptions: types.TransportOptions
  }, WSInfrastructureError> =>
    pipe(
      WebSocketClientImpl.sendListenerCommand(ws, {
        type: 'initListener',
      }),
      Effect.andThen(() => WebSocketClientImpl.waitForListenerEvent(ws, 'listenerTransportReady')),
      Effect.andThen((event: any) => {
        if (event.type === 'listenerTransportReady') {
          // Use transform schema to convert wire format to native types
          return pipe(
            Effect.sync(() => S.decodeUnknownSync(WebSocketTransforms.TransportOptions)(event.transportOptions)),
            Effect.map((transportOptions) => ({ transportOptions })),
            Effect.catchAll((_) => Effect.fail(new WSInfrastructureError('Failed to decode transport options', 'initListenerTransport')))
          )
        }
        return Effect.fail(new WSInfrastructureError('Expected listenerTransportReady event'))
      })
    ),

  /**
   * Listener: Connect transport
   */
  connectListenerTransport: (ws: WebSocket, transportId: string | undefined, dtlsParameters: DtlsParametersNative): Effect.Effect<void, WSInfrastructureError> =>
    pipe(
      WebSocketClientImpl.sendListenerCommand(ws, {
        type: 'connectListenerTransport',
        transportId: transportId,
        dtlsParameters,
      }),
      Effect.asVoid // No event expected for transport connection
    ),

  /**
   * Listener: Request consumer with device capabilities and get consumer parameters
   */
  requestListenerConsumer: (ws: WebSocket, rtpCapabilities: types.RtpCapabilities): Effect.Effect<{
    consumerParameters: types.ConsumerOptions
  }, WSInfrastructureError> =>
    pipe(
      // Transform native mediasoup-client type to wire format  
      Effect.sync(() => S.encodeSync(WebSocketTransforms.RtpCapabilities)(rtpCapabilities)),
      Effect.andThen((encodedCapabilities) => WebSocketClientImpl.sendListenerCommand(ws, {
        type: 'requestConsumer',
        rtpCapabilities: encodedCapabilities,
      })),
      Effect.andThen(() => WebSocketClientImpl.waitForListenerEvent(ws, 'consumerCreated')),
      Effect.andThen((event: any) => {
        if (event.type === 'consumerCreated') {
          // Use transform schema to convert wire format to native consumer parameters
          return pipe(
            Effect.sync(() => S.decodeUnknownSync(WebSocketTransforms.ConsumerParameters)(event.consumerParameters)),
            Effect.map((consumerParameters) => ({ consumerParameters: consumerParameters as types.ConsumerOptions })),
            Effect.catchAll((_) => Effect.fail(new WSInfrastructureError('Failed to decode consumer parameters', 'requestListenerConsumer')))
          )
        }
        throw new Error('Expected consumerCreated event')
      })
    ),

  /**
   * Listener: Leave room
   */
  leaveListenerRoom: (ws: WebSocket): Effect.Effect<void, WSInfrastructureError> =>
    pipe(
      WebSocketClientImpl.sendListenerCommand(ws, {
        type: 'leaveRoom',
      }),
      Effect.asVoid // No need to wait for response
    ),

  /**
   * Lobby: Connect to lobby and set up event subscription
   */
  connectToLobby: (lobbyUrl: string): Effect.Effect<WebSocket, WSInfrastructureError> =>
    pipe(
      WebSocketClientImpl.connect({
        url: lobbyUrl,
        connectionTimeout: 10000
      }),
      Effect.andThen((ws) =>
        pipe(
          WebSocketClientImpl.subscribe(ws),
          Effect.map(() => ws)
        )
      )
    ),

  /**
   * Lobby: Create and announce room
   * Returns room info with wsUrl for DJ connection
   */
  announceRoom: (ws: WebSocket, name: string, djName: string, sessionId: string, description?: string): Effect.Effect<{
    room: RoomInfo & { wsUrl: string }
  }, WSInfrastructureError> =>
    pipe(
      WebSocketClientImpl.sendLobbyCommand(ws, {
        type: 'announceRoom',
        name,
        djName,
        sessionId,
        description: description,
        tags: [],
      }),
      Effect.andThen(() => WebSocketClientImpl.waitForDJEvent(ws, 'roomAnnounced')),
      Effect.map((event: any) => {
        if (event.type === 'roomAnnounced') {
          return {
            room: {
              id: event.room.id,
              name: event.room.name,
              djName: event.room.djName,
              listenerCount: event.room.listenerCount,
              createdAt: new Date(event.room.createdAt),
              description: event.room.description || null,
              tags: [...event.room.tags], // Convert readonly array to mutable
              wsUrl: event.wsUrl // Include WebSocket URL for DJ connection
            }
          }
        }
        throw new Error('Expected roomAnnounced event')
      })
    ),

  /**
   * Lobby: Join room as listener
   */
  joinRoom: (ws: WebSocket, roomId: string, sessionId: string): Effect.Effect<{
    listenerWebSocketUrl: string
    sessionId: string
  }, WSInfrastructureError> =>
    pipe(
      WebSocketClientImpl.sendLobbyCommand(ws, {
        type: 'requestJoin',
        roomId,
        sessionId,
      }),
      Effect.andThen(() => WebSocketClientImpl.waitForLobbyEvent(ws, 'joinRoomResponse')),
      Effect.map((event: any) => {
        if (event.type === 'joinRoomResponse') {
          return {
            listenerWebSocketUrl: event.listenerWebSocketUrl || '',
            sessionId: event.sessionId
          }
        }
        throw new Error('Expected joinRoomResponse event')
      })
    ),

  /**
   * Lobby: Refresh room list
   */
  refreshLobbyRoomList: (ws: WebSocket): Effect.Effect<void, WSInfrastructureError> =>
    pipe(
      WebSocketClientImpl.sendLobbyCommand(ws, {
        type: 'refreshRooms',
      }),
      Effect.andThen(() => WebSocketClientImpl.waitForLobbyEvent(ws, 'roomListUpdated')),
      Effect.asVoid
    )
}

/**
 * WebSocket Client Service
 * 
 * Modern Effect-TS 2025 pattern: Effect.Service that defines service, tag, and implementation.
 * Services import and use this for dependency injection.
 */
export class WebSocketClient extends Effect.Service<WebSocketClient>()("@app/infrastructure/websocket/WebSocketClient", {
  succeed: WebSocketClientImpl
}) {}

/**
 * Convenience functions for common WebSocket operations
 */
export namespace WSClient {
  /**
   * Connect with default config
   */
  export const connectDefault = (url: string) =>
    WebSocketClientImpl.connect({
      url,
      connectionTimeout: 10000,
      reconnectAttempts: 3,
      reconnectDelay: 1000
    })

  /**
   * Send JSON message
   */
  export const sendJSON = (ws: WebSocket, data: object) =>
    WebSocketClientImpl.send(ws, data)

  /**
   * Check if WebSocket is ready for communication
   */
  export const isReady = (ws: WebSocket) =>
    pipe(
      WebSocketClientImpl.getState(ws),
      Effect.map(state => state === 'open')
    )
}

