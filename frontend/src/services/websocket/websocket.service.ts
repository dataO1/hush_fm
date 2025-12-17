/**
 * Unified WebSocket Service
 * 
 * Single websocket service that provides role-specific communication:
 * - Lobby: Room announcements and discovery
 * - DJ: Room management and streaming controls
 * - Listener: Audio consumption and playback
 * 
 * Features:
 * - Connection management with automatic reconnection
 * - Role-specific message handling
 * - Type-safe command sending and event subscription
 * - No trace context (removed as per backend refactoring)
 */

import { Effect, pipe } from 'effect'
import type { 
  LobbyCommand,
  LobbyEvent,
  DjCommand,
  DjEvent,
  ListenerCommand,
  ListenerEvent
} from './schemas/websocket'
import { 
  isLobbyEvent,
  isDjEvent,
  isListenerEvent
} from './schemas/websocket'
import {
  WebSocketConnectionError,
  WebSocketMessageError
} from '../../domain/errors'

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
 * Connection state for WebSocket
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed'

/**
 * WebSocket connection interface
 */
export interface WebSocketConnection {
  ws: WebSocket
  state: ConnectionState
  url: string
  reconnectAttempts: number
  eventHandlers: Array<(event: any) => void>
}

/**
 * Default configuration
 */
const defaultConfig: Partial<WebSocketConfig> = {
  reconnectAttempts: 5,
  reconnectDelay: 1000,
  heartbeatInterval: 30000,
  connectionTimeout: 10000
}

/**
 * Message serialization/deserialization utilities
 */
const MessageCodec = {
  /**
   * Deserialize incoming lobby events
   */
  deserializeLobbyEvent: (data: any): LobbyEvent => {
    // Basic validation - backend sends clean JSON
    if (!data || typeof data.type !== 'string') {
      throw new Error('Invalid lobby event format')
    }
    return data as LobbyEvent
  },

  /**
   * Deserialize incoming DJ events  
   */
  deserializeDjEvent: (data: any): DjEvent => {
    if (!data || typeof data.type !== 'string') {
      throw new Error('Invalid DJ event format')
    }
    return data as DjEvent
  },

  /**
   * Deserialize incoming listener events
   */
  deserializeListenerEvent: (data: any): ListenerEvent => {
    if (!data || typeof data.type !== 'string') {
      throw new Error('Invalid listener event format')
    }
    return data as ListenerEvent
  },

  /**
   * Serialize outgoing commands (no trace context)
   */
  serializeCommand: (command: LobbyCommand | DjCommand | ListenerCommand): string => {
    return JSON.stringify(command)
  }
}

/**
 * Create WebSocket connection with proper lifecycle management
 */
export const connectWebSocket = (config: WebSocketConfig): Effect.Effect<WebSocket, WebSocketConnectionError> => 
  Effect.gen(function* (_) {
    const finalConfig = { ...defaultConfig, ...config }
    
    const ws = yield* _(Effect.async<WebSocket, WebSocketConnectionError>((resume) => {
      const websocket = new WebSocket(config.url, config.protocols)
      
      const timeoutId = setTimeout(() => {
        cleanup()
        resume(Effect.fail(new WebSocketConnectionError({
          cause: 'Connection timeout',
          url: config.url,
          connectionType: 'lobby',
          context: { timestamp: new Date(), operation: 'connect' }
        })))
      }, finalConfig.connectionTimeout)
      
      const onOpen = () => {
        cleanup()
        resume(Effect.succeed(websocket))
      }
      
      const onError = (_error: Event) => {
        cleanup()
        resume(Effect.fail(new WebSocketConnectionError({
          cause: 'Connection failed',
          url: config.url,
          connectionType: 'lobby',
          context: { timestamp: new Date(), operation: 'connect' }
        })))
      }
      
      const cleanup = () => {
        clearTimeout(timeoutId)
        websocket.removeEventListener('open', onOpen)
        websocket.removeEventListener('error', onError)
      }
      
      websocket.addEventListener('open', onOpen)
      websocket.addEventListener('error', onError)
      
      return Effect.sync(cleanup)
    }))
    
    return ws
  })

/**
 * Close WebSocket connection
 */
export const closeWebSocket = (ws: WebSocket): Effect.Effect<void, never> => 
  Effect.sync(() => {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close()
    }
  })

/**
 * Send lobby command
 */
export const sendLobbyCommand = (ws: WebSocket, command: LobbyCommand): Effect.Effect<void, WebSocketMessageError> =>
  Effect.gen(function* (_) {
    if (ws.readyState !== WebSocket.OPEN) {
      yield* _(Effect.fail(new WebSocketMessageError({
        cause: 'WebSocket not connected',
        direction: 'send',
        context: { timestamp: new Date(), operation: 'send_lobby_command' }
      })))
    }
    
    const serialized = MessageCodec.serializeCommand(command)
    yield* _(Effect.sync(() => ws.send(serialized)))
  })

/**
 * Send DJ command
 */
export const sendDjCommand = (ws: WebSocket, command: DjCommand): Effect.Effect<void, WebSocketMessageError> =>
  Effect.gen(function* (_) {
    if (ws.readyState !== WebSocket.OPEN) {
      yield* _(Effect.fail(new WebSocketMessageError({
        cause: 'WebSocket not connected',
        direction: 'send',
        context: { timestamp: new Date(), operation: 'send_lobby_command' }
      })))
    }
    
    const serialized = MessageCodec.serializeCommand(command)
    yield* _(Effect.sync(() => ws.send(serialized)))
  })

/**
 * Send listener command
 */
export const sendListenerCommand = (ws: WebSocket, command: ListenerCommand): Effect.Effect<void, WebSocketMessageError> =>
  Effect.gen(function* (_) {
    if (ws.readyState !== WebSocket.OPEN) {
      yield* _(Effect.fail(new WebSocketMessageError({
        cause: 'WebSocket not connected',
        direction: 'send',
        context: { timestamp: new Date(), operation: 'send_lobby_command' }
      })))
    }
    
    const serialized = MessageCodec.serializeCommand(command)
    yield* _(Effect.sync(() => ws.send(serialized)))
  })

/**
 * Request router RTP capabilities for device initialization
 */
export const requestRouterCapabilities = (ws: WebSocket, roomId: string): Effect.Effect<void, WebSocketMessageError> => {
  console.log('🔧 requestRouterCapabilities: Sending getRouterCapabilities command for room:', roomId)
  console.log('🔧 requestRouterCapabilities: WebSocket state:', ws.readyState)
  
  return pipe(
    sendListenerCommand(ws, { type: 'getRouterCapabilities', roomId }),
    Effect.tap(() => Effect.sync(() => {
      console.log('✅ requestRouterCapabilities: Command sent successfully')
    })),
    Effect.mapError(error => {
      console.error('❌ requestRouterCapabilities: Failed to send command:', error)
      return new WebSocketMessageError({
        cause: `Failed to request router capabilities: ${(error as any)?.cause || String(error)}`,
        direction: 'send',
        context: { timestamp: new Date(), operation: 'request_router_capabilities' }
      })
    })
  )
}

/**
 * Subscribe to router capabilities events
 */
export const subscribeToRouterCapabilities = (ws: WebSocket): Effect.Effect<any, WebSocketMessageError> =>
  pipe(
    Effect.async<any, WebSocketMessageError>((resume) => {
      console.log('🔧 subscribeToRouterCapabilities: Setting up message listener')
      
      const onMessage = (event: MessageEvent) => {
        console.log('🔧 subscribeToRouterCapabilities: Received raw message:', event.data)
        
        try {
          console.log('🔧 subscribeToRouterCapabilities: Attempting to parse JSON first...')
          const parsedData = JSON.parse(event.data)
          console.log('🔧 subscribeToRouterCapabilities: Parsed JSON data:', parsedData)
          
          console.log('🔧 subscribeToRouterCapabilities: Attempting to deserialize message...')
          const message = MessageCodec.deserializeListenerEvent(parsedData)
          console.log('🔧 subscribeToRouterCapabilities: Deserialized message:', message)
          console.log('🔧 subscribeToRouterCapabilities: Message type:', message.type)
          
          if (message.type === 'routerCapabilities') {
            console.log('✅ subscribeToRouterCapabilities: Found routerCapabilities message!')
            console.log('🔧 subscribeToRouterCapabilities: RTP capabilities:', message.rtpCapabilities)
            
            ws.removeEventListener('message', onMessage)
            console.log('✅ subscribeToRouterCapabilities: Successfully extracted RTP capabilities, resolving...')
            resume(Effect.succeed(message.rtpCapabilities))
          } else {
            console.log('🔧 subscribeToRouterCapabilities: Message type not routerCapabilities, ignoring:', message.type)
          }
        } catch (error) {
          console.error('❌ subscribeToRouterCapabilities: Error in onMessage handler:', error)
          console.error('❌ subscribeToRouterCapabilities: Raw message data that failed:', event.data)
          console.error('❌ subscribeToRouterCapabilities: Error details:', {
            name: error instanceof Error ? error.name : 'Unknown',
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          })
          
          ws.removeEventListener('message', onMessage)
          resume(Effect.fail(new WebSocketMessageError({
            cause: `Failed to parse router capabilities response: ${error instanceof Error ? error.message : String(error)}`,
            direction: 'receive',
            context: { 
              timestamp: new Date(), 
              operation: 'subscribe_router_capabilities'
            }
          })))
        }
      }
      
      ws.addEventListener('message', onMessage)
      console.log('🔧 subscribeToRouterCapabilities: Message listener added to WebSocket')
      
      return Effect.sync(() => {
        console.log('🔧 subscribeToRouterCapabilities: Cleanup called')
        ws.removeEventListener('message', onMessage)
      })
    })
  )

/**
 * Subscribe to lobby events
 */
export const subscribeToLobbyEvents = (ws: WebSocket): Effect.Effect<(handler: (event: LobbyEvent) => void) => void, never> =>
  Effect.succeed((handler: (event: LobbyEvent) => void) => {
    const messageHandler = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data)
        if (isLobbyEvent(data)) {
          const lobbyEvent = MessageCodec.deserializeLobbyEvent(data)
          handler(lobbyEvent)
        }
      } catch (error) {
        console.error('Failed to handle lobby event:', error)
      }
    }
    
    ws.addEventListener('message', messageHandler)
    
    // Return cleanup function
    return () => ws.removeEventListener('message', messageHandler)
  })

/**
 * Subscribe to DJ events
 */
export const subscribeToDjEvents = (ws: WebSocket): Effect.Effect<(handler: (event: DjEvent) => void) => void, never> =>
  Effect.succeed((handler: (event: DjEvent) => void) => {
    const messageHandler = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data)
        if (isDjEvent(data)) {
          const djEvent = MessageCodec.deserializeDjEvent(data)
          handler(djEvent)
        }
      } catch (error) {
        console.error('Failed to handle DJ event:', error)
      }
    }
    
    ws.addEventListener('message', messageHandler)
    
    // Return cleanup function
    return () => ws.removeEventListener('message', messageHandler)
  })

/**
 * Subscribe to listener events
 */
export const subscribeToListenerEvents = (ws: WebSocket): Effect.Effect<(handler: (event: ListenerEvent) => void) => void, never> =>
  Effect.succeed((handler: (event: ListenerEvent) => void) => {
    const messageHandler = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data)
        if (isListenerEvent(data)) {
          const listenerEvent = MessageCodec.deserializeListenerEvent(data)
          handler(listenerEvent)
        }
      } catch (error) {
        console.error('Failed to handle listener event:', error)
      }
    }
    
    ws.addEventListener('message', messageHandler)
    
    // Return cleanup function
    return () => ws.removeEventListener('message', messageHandler)
  })

/**
 * Generic message subscription (for backward compatibility during migration)
 * Will be removed once all services are migrated to role-specific subscriptions
 */
export const subscribeToMessages = <T extends LobbyEvent | DjEvent | ListenerEvent>(
  ws: WebSocket,
  messageType: 'lobby' | 'dj' | 'listener'
): Effect.Effect<(handler: (message: T) => void) => void, never> => {
  switch (messageType) {
    case 'lobby':
      return subscribeToLobbyEvents(ws) as any
    case 'dj':
      return subscribeToDjEvents(ws) as any
    case 'listener':
      return subscribeToListenerEvents(ws) as any
    default:
      return Effect.succeed(() => () => {})
  }
}

/**
 * WebSocket connection helper for different roles
 */
export const connectToLobby = (): Effect.Effect<WebSocket, WebSocketConnectionError> =>
  connectWebSocket({ url: `wss://${window.location.hostname}:3443/ws/lobby` })

export const connectToDjRoom = (roomId: string): Effect.Effect<WebSocket, WebSocketConnectionError> =>
  connectWebSocket({ url: `wss://${window.location.hostname}:3443/ws/room/${roomId}` })

export const connectToListener = (roomId: string, sessionId: string): Effect.Effect<WebSocket, WebSocketConnectionError> =>
  connectWebSocket({ url: `wss://${window.location.hostname}:3443/ws/listener/${roomId}/${sessionId}` })

// Managed connection removed for simplicity - use individual connection functions above