/**
 * WebSocket Infrastructure Client
 *
 * Pure technical layer for WebSocket connections.
 * No business logic - only handles connection mechanics.
 *
 * Responsibilities:
 * - Raw WebSocket connection management
 * - Message sending/receiving with automatic encoding/decoding
 * - Connection state tracking
 * - Error handling (technical errors only)
 * - Reconnection logic
 */

import { Effect, pipe, Schema as S } from 'effect'
import {
  DJCommandSchema,
  DJEventSchema,
  ListenerCommandSchema,
  ListenerEventSchema,
  LobbyCommandSchema,
  LobbyEventSchema
} from '../../domain/schemas/shared/websocket.schema'

/**
 * WebSocket connection configuration
 */
export interface WebSocketConfig {
  url: string
  protocols?: string[]
  reconnectAttempts?: number
  reconnectDelay?: number
  connectionTimeout?: number
}

/**
 * WebSocket connection state
 */
export type WSConnectionState = 'connecting' | 'open' | 'closing' | 'closed'

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
 *
 * Simple interface with typed send/receive for each connection type.
 * All encoding/decoding is handled automatically by the union schemas.
 */
export interface WebSocketClientService {
  /**
   * Connect to WebSocket - pure connection establishment
   */
  readonly connect: (config: WebSocketConfig) => Effect.Effect<WebSocket, WSInfrastructureError>

  /**
   * Close connection
   */
  readonly close: (ws: WebSocket, code?: number, reason?: string) => Effect.Effect<void, never>

  /**
   * Get connection state
   */
  readonly getState: (ws: WebSocket) => Effect.Effect<WSConnectionState, never>

  // ===== DJ WebSocket Methods =====

  /**
   * Send DJ command - automatically encodes to wire format with type discriminator
   */
  readonly sendDJCommand: (
    ws: WebSocket,
    command: S.Schema.Type<typeof DJCommandSchema>
  ) => Effect.Effect<void, WSInfrastructureError>

  /**
   * Subscribe to DJ events - automatically decodes from wire format
   */
  readonly subscribeDJEvents: (
    ws: WebSocket
  ) => Effect.Effect<(handler: (event: S.Schema.Type<typeof DJEventSchema>) => void) => () => void, WSInfrastructureError>

  /**
   * Wait for specific DJ event - automatically decodes from wire format
   */
  readonly waitForDJEvent: <T extends string>(
    ws: WebSocket,
    eventType: T,
    timeoutMs?: number
  ) => Effect.Effect<S.Schema.Type<typeof DJEventSchema>, WSInfrastructureError>

  // ===== Listener WebSocket Methods =====

  /**
   * Send Listener command - automatically encodes to wire format with type discriminator
   */
  readonly sendListenerCommand: (
    ws: WebSocket,
    command: S.Schema.Type<typeof ListenerCommandSchema>
  ) => Effect.Effect<void, WSInfrastructureError>

  /**
   * Subscribe to Listener events - automatically decodes from wire format
   */
  readonly subscribeListenerEvents: (
    ws: WebSocket
  ) => Effect.Effect<(handler: (event: S.Schema.Type<typeof ListenerEventSchema>) => void) => () => void, WSInfrastructureError>

  /**
   * Wait for specific Listener event - automatically decodes from wire format
   */
  readonly waitForListenerEvent: <T extends string>(
    ws: WebSocket,
    eventType: T,
    timeoutMs?: number
  ) => Effect.Effect<S.Schema.Type<typeof ListenerEventSchema>, WSInfrastructureError>

  // ===== Lobby WebSocket Methods =====

  /**
   * Send Lobby command - automatically encodes to wire format with type discriminator
   */
  readonly sendLobbyCommand: (
    ws: WebSocket,
    command: S.Schema.Type<typeof LobbyCommandSchema>
  ) => Effect.Effect<void, WSInfrastructureError>

  /**
   * Subscribe to Lobby events - automatically decodes from wire format
   */
  readonly subscribeLobbyEvents: (
    ws: WebSocket
  ) => Effect.Effect<(handler: (event: S.Schema.Type<typeof LobbyEventSchema>) => void) => () => void, WSInfrastructureError>

  /**
   * Wait for specific Lobby event - automatically decodes from wire format
   */
  readonly waitForLobbyEvent: <T extends string>(
    ws: WebSocket,
    eventType: T,
    timeoutMs?: number
  ) => Effect.Effect<S.Schema.Type<typeof LobbyEventSchema>, WSInfrastructureError>
}

/**
 * Create WebSocket Client Service Implementation
 */
export const createWebSocketClient = (): WebSocketClientService => {
  // Helper to send raw message
  const sendRaw = (ws: WebSocket, data: string) =>
    Effect.try({
      try: () => {
        if (ws.readyState !== WebSocket.OPEN) {
          throw new WSInfrastructureError(
            'WebSocket is not open',
            'send',
            ws.readyState
          )
        }
        ws.send(data)
      },
      catch: (error) => new WSInfrastructureError(
        'Failed to send message',
        'send',
        ws.readyState,
        error
      )
    })

  return {
    connect: (config) =>
      Effect.async<WebSocket, WSInfrastructureError>((resume) => {
        try {
          const ws = new WebSocket(config.url, config.protocols)

          const timeout = setTimeout(() => {
            ws.close()
            resume(Effect.fail(new WSInfrastructureError(
              'Connection timeout',
              'connect',
              ws.readyState
            )))
          }, config.connectionTimeout ?? 30000)

          ws.onopen = () => {
            clearTimeout(timeout)
            resume(Effect.succeed(ws))
          }

          ws.onerror = (event) => {
            clearTimeout(timeout)
            resume(Effect.fail(new WSInfrastructureError(
              'Connection error',
              'connect',
              ws.readyState,
              event
            )))
          }
        } catch (error) {
          resume(Effect.fail(new WSInfrastructureError(
            'Failed to create WebSocket',
            'connect',
            undefined,
            error
          )))
        }
      }),

    close: (ws, code, reason) =>
      Effect.sync(() => {
        ws.close(code, reason)
      }),

    getState: (ws) =>
      Effect.sync(() => {
        switch (ws.readyState) {
          case WebSocket.CONNECTING: return 'connecting' as const
          case WebSocket.OPEN: return 'open' as const
          case WebSocket.CLOSING: return 'closing' as const
          case WebSocket.CLOSED: return 'closed' as const
          default: return 'closed' as const
        }
      }),

    // ===== DJ Methods =====

    sendDJCommand: (ws, command) =>
      pipe(
        Effect.try({
          try: () => S.encodeSync(DJCommandSchema)(command),
          catch: (error) => new WSInfrastructureError(
            'Failed to encode DJ command',
            'encode',
            ws.readyState,
            error
          )
        }),
        Effect.flatMap(encoded => sendRaw(ws, JSON.stringify(encoded)))
      ),

    subscribeDJEvents: (ws) =>
      Effect.sync(() => {
        const handlers = new Set<(event: S.Schema.Type<typeof DJEventSchema>) => void>()

        ws.onmessage = (message) => {
          try {
            const data = JSON.parse(message.data)
            const event = S.decodeUnknownSync(DJEventSchema)(data)
            handlers.forEach(handler => handler(event))
          } catch (error) {
            console.error('Failed to decode DJ event:', error, message.data)
          }
        }

        return (handler: (event: S.Schema.Type<typeof DJEventSchema>) => void) => {
          handlers.add(handler)
          return () => { handlers.delete(handler) }
        }
      }),

    waitForDJEvent: (ws, eventType, timeoutMs = 30000) =>
      Effect.async((resume) => {
        const timeout = setTimeout(() => {
          ws.removeEventListener('message', messageHandler)
          resume(Effect.fail(new WSInfrastructureError(
            `Timeout waiting for DJ event: ${eventType}`,
            'waitForEvent',
            ws.readyState
          )))
        }, timeoutMs)

        const messageHandler = (message: MessageEvent) => {
          try {
            const data = JSON.parse(message.data)
            // Check if this is the event type we're waiting for before decoding
            if (data.type === eventType) {
              const event = S.decodeUnknownSync(DJEventSchema)(data)
              clearTimeout(timeout)
              ws.removeEventListener('message', messageHandler)
              resume(Effect.succeed(event))
            }
          } catch (error) {
            // Ignore decode errors for events we're not waiting for
          }
        }

        ws.addEventListener('message', messageHandler)
      }),

    // ===== Listener Methods =====

    sendListenerCommand: (ws, command) =>
      pipe(
        Effect.try({
          try: () => S.encodeSync(ListenerCommandSchema)(command),
          catch: (error) => new WSInfrastructureError(
            'Failed to encode Listener command',
            'encode',
            ws.readyState,
            error
          )
        }),
        Effect.flatMap(encoded => sendRaw(ws, JSON.stringify(encoded)))
      ),

    subscribeListenerEvents: (ws) =>
      Effect.sync(() => {
        const handlers = new Set<(event: S.Schema.Type<typeof ListenerEventSchema>) => void>()

        ws.onmessage = (message) => {
          try {
            const data = JSON.parse(message.data)
            const event = S.decodeUnknownSync(ListenerEventSchema)(data)
            handlers.forEach(handler => handler(event))
          } catch (error) {
            console.error('Failed to decode Listener event:', error, message.data)
          }
        }

        return (handler: (event: S.Schema.Type<typeof ListenerEventSchema>) => void) => {
          handlers.add(handler)
          return () => { handlers.delete(handler) }
        }
      }),

    waitForListenerEvent: (ws, eventType, timeoutMs = 30000) =>
      Effect.async((resume) => {
        const timeout = setTimeout(() => {
          ws.removeEventListener('message', messageHandler)
          resume(Effect.fail(new WSInfrastructureError(
            `Timeout waiting for Listener event: ${eventType}`,
            'waitForEvent',
            ws.readyState
          )))
        }, timeoutMs)

        const messageHandler = (message: MessageEvent) => {
          try {
            const data = JSON.parse(message.data)
            // Check if this is the event type we're waiting for before decoding
            if (data.type === eventType) {
              const event = S.decodeUnknownSync(ListenerEventSchema)(data)
              clearTimeout(timeout)
              ws.removeEventListener('message', messageHandler)
              resume(Effect.succeed(event))
            }
          } catch (error) {
            // Ignore decode errors for events we're not waiting for
          }
        }

        ws.addEventListener('message', messageHandler)
      }),

    // ===== Lobby Methods =====

    sendLobbyCommand: (ws, command) =>
      pipe(
        Effect.try({
          try: () => S.encodeSync(LobbyCommandSchema)(command),
          catch: (error) => new WSInfrastructureError(
            'Failed to encode Lobby command',
            'encode',
            ws.readyState,
            error
          )
        }),
        Effect.flatMap(encoded => sendRaw(ws, JSON.stringify(encoded)))
      ),

    subscribeLobbyEvents: (ws) =>
      Effect.sync(() => {
        const handlers = new Set<(event: S.Schema.Type<typeof LobbyEventSchema>) => void>()

        ws.onmessage = (message) => {
          try {
            const data = JSON.parse(message.data)
            const event = S.decodeUnknownSync(LobbyEventSchema)(data)
            handlers.forEach(handler => handler(event))
          } catch (error) {
            console.error('Failed to decode Lobby event:', error, message.data)
          }
        }

        return (handler: (event: S.Schema.Type<typeof LobbyEventSchema>) => void) => {
          handlers.add(handler)
          return () => { handlers.delete(handler) }
        }
      }),

    waitForLobbyEvent: (ws, eventType, timeoutMs = 30000) =>
      Effect.async((resume) => {
        const timeout = setTimeout(() => {
          ws.removeEventListener('message', messageHandler)
          resume(Effect.fail(new WSInfrastructureError(
            `Timeout waiting for Lobby event: ${eventType}`,
            'waitForEvent',
            ws.readyState
          )))
        }, timeoutMs)

        const messageHandler = (message: MessageEvent) => {
          try {
            const data = JSON.parse(message.data)
            // Check if this is the event type we're waiting for before decoding
            if (data.type === eventType) {
              const event = S.decodeUnknownSync(LobbyEventSchema)(data)
              clearTimeout(timeout)
              ws.removeEventListener('message', messageHandler)
              resume(Effect.succeed(event))
            }
          } catch (error) {
            // Ignore decode errors for events we're not waiting for
          }
        }

        ws.addEventListener('message', messageHandler)
      })
  }
}

// Export singleton instance
export const WebSocketClient = createWebSocketClient()
