import { Effect, pipe, Ref, Queue } from 'effect'
import { createSignal, createEffect } from 'solid-js'
import { connectWebSocket, subscribeToMessages, DJMessage, ServerMessage, BroadcastMessage } from './client'

/**
 * WebSocket connection states
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed'

/**
 * Signaling message types for different event channels
 */
export type SignalingMessage = 
  | { channel: 'room'; roomId: string; data: DJMessage }
  | { channel: 'lobby'; data: BroadcastMessage }
  | { channel: 'system'; data: ServerMessage }

/**
 * Signaling event callbacks
 */
export type SignalingEventHandlers = {
  onRoomUpdate?: (roomId: string, message: ServerMessage) => void
  onLobbyUpdate?: (message: BroadcastMessage) => void
  onSystemMessage?: (message: ServerMessage) => void
  onConnectionChange?: (state: ConnectionState) => void
  onError?: (error: Error) => void
}

/**
 * WebSocket Signaling Manager
 * Manages WebSocket connections with automatic reconnection and event-driven architecture
 */
export class SignalingManager {
  private wsRef: Ref.Ref<WebSocket | null> = Effect.runSync(Ref.make<WebSocket | null>(null))
  private messageQueue = Effect.runSync(Queue.unbounded<SignalingMessage>())
  private eventHandlers: SignalingEventHandlers = {}
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private baseReconnectDelay = 1000
  
  // Reactive signals for connection state
  private connectionStateSignal = createSignal<ConnectionState>('disconnected')
  private connectedRoomsSignal = createSignal<Set<string>>(new Set())
  
  private get connectionState() { return this.connectionStateSignal[0] }
  private get setConnectionState() { return this.connectionStateSignal[1] }
  private get connectedRooms() { return this.connectedRoomsSignal[0] }
  private get setConnectedRooms() { return this.connectedRoomsSignal[1] }
  
  constructor() {
    // Set up automatic reconnection effect
    createEffect(() => {
      const state = this.connectionState()
      this.eventHandlers.onConnectionChange?.(state)
    })
  }

  /**
   * Connect to WebSocket server
   */
  connect = (url: string): Effect.Effect<void, Error> =>
    pipe(
      Effect.logInfo(`Connecting to WebSocket: ${url}`),
      Effect.andThen(() => {
        this.setConnectionState('connecting')
        return connectWebSocket(url)
      }),
      Effect.andThen((ws) =>
        pipe(
          Ref.set(this.wsRef, ws),
          Effect.andThen(() => this.setupWebSocketHandlers(ws)),
          Effect.andThen(() => {
            this.setConnectionState('connected')
            this.reconnectAttempts = 0
            return this.processQueuedMessages()
          })
        )
      ),
      Effect.catchAll((error) =>
        pipe(
          Effect.logError(`WebSocket connection failed: ${error.message}`),
          Effect.andThen(() => {
            this.setConnectionState('failed')
            this.eventHandlers.onError?.(error)
            return this.scheduleReconnect(url)
          })
        )
      )
    )

  /**
   * Send message to specific room
   */
  sendToRoom = (roomId: string, message: DJMessage): Effect.Effect<void, Error> =>
    this.sendMessage({ channel: 'room', roomId, data: message })

  /**
   * Send lobby broadcast message
   */
  sendToLobby = (message: BroadcastMessage): Effect.Effect<void, Error> =>
    this.sendMessage({ channel: 'lobby', data: message })

  /**
   * Subscribe to room events
   */
  subscribeToRoom = (roomId: string): Effect.Effect<void, Error> =>
    pipe(
      Effect.sync(() => {
        const rooms = new Set(this.connectedRooms())
        rooms.add(roomId)
        this.setConnectedRooms(rooms)
      }),
      Effect.tap(() => Effect.logInfo(`Subscribed to room: ${roomId}`))
    )

  /**
   * Unsubscribe from room events
   */
  unsubscribeFromRoom = (roomId: string): Effect.Effect<void, Error> =>
    pipe(
      Effect.sync(() => {
        const rooms = new Set(this.connectedRooms())
        rooms.delete(roomId)
        this.setConnectedRooms(rooms)
      }),
      Effect.tap(() => Effect.logInfo(`Unsubscribed from room: ${roomId}`))
    )

  /**
   * Set event handlers
   */
  setEventHandlers = (handlers: SignalingEventHandlers): void => {
    this.eventHandlers = { ...this.eventHandlers, ...handlers }
  }

  /**
   * Get current connection state
   */
  getConnectionState = (): ConnectionState => this.connectionState()

  /**
   * Get connected rooms
   */
  getConnectedRooms = (): string[] => Array.from(this.connectedRooms())

  /**
   * Disconnect WebSocket
   */
  disconnect = (): Effect.Effect<void, never> =>
    pipe(
      Ref.get(this.wsRef),
      Effect.andThen((ws) => {
        if (ws) {
          ws.close()
          return Ref.set(this.wsRef, null)
        }
        return Effect.void
      }),
      Effect.andThen(() => {
        this.setConnectionState('disconnected')
        this.setConnectedRooms(new Set<string>())
        return Effect.void
      }),
      Effect.tap(() => Effect.logInfo('WebSocket disconnected'))
    )

  /**
   * Private: Send message with queueing for offline scenarios
   */
  private sendMessage = (message: SignalingMessage): Effect.Effect<void, Error> =>
    pipe(
      Ref.get(this.wsRef),
      Effect.andThen((ws) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          return this.sendMessageDirect(ws, message)
        } else {
          // Queue message for later delivery
          return Queue.offer(this.messageQueue, message)
        }
      })
    )

  /**
   * Private: Send message directly to WebSocket
   */
  private sendMessageDirect = (ws: WebSocket, message: SignalingMessage): Effect.Effect<void, Error> =>
    pipe(
      Effect.sync(() => {
        const payload = {
          channel: message.channel,
          room_id: message.channel === 'room' ? message.roomId : undefined,
          ...message.data
        }
        ws.send(JSON.stringify(payload))
      }),
      Effect.tap(() => Effect.logDebug(`Sent message to ${message.channel}`)),
      Effect.catchAll((error: Error) =>
        Effect.fail(new Error(`Failed to send message: ${error.message}`))
      )
    )

  /**
   * Private: Set up WebSocket event handlers
   */
  private setupWebSocketHandlers = (ws: WebSocket): Effect.Effect<void, never> =>
    pipe(
      subscribeToMessages(
        ws,
        (message: any) => this.handleIncomingMessage(message),
        (error: Error) => this.eventHandlers.onError?.(error)
      ),
      Effect.andThen(() =>
        Effect.sync(() => {
          ws.onclose = () => {
            this.setConnectionState('disconnected')
            Effect.runSync(Ref.set(this.wsRef, null))
          }
        })
      )
    )

  /**
   * Private: Handle incoming WebSocket messages
   */
  private handleIncomingMessage = (message: any): void => {
    try {
      // Route messages based on channel
      if (message.channel === 'room' && message.room_id) {
        this.eventHandlers.onRoomUpdate?.(message.room_id, message as ServerMessage)
      } else if (message.channel === 'lobby') {
        this.eventHandlers.onLobbyUpdate?.(message as BroadcastMessage)
      } else if (message.channel === 'system') {
        this.eventHandlers.onSystemMessage?.(message as ServerMessage)
      } else {
        // Legacy message handling for backwards compatibility
        this.handleLegacyMessage(message)
      }
    } catch (error) {
      console.error('Failed to handle incoming message:', error)
      this.eventHandlers.onError?.(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Private: Handle legacy message format
   */
  private handleLegacyMessage = (message: any): void => {
    switch (message.type) {
      case 'ProducerCreated':
      case 'RoomDeleted':
      case 'ListenerJoined':
      case 'ListenerLeft':
      case 'Error':
        this.eventHandlers.onSystemMessage?.(message as ServerMessage)
        break
      
      case 'RoomAdded':
      case 'RoomUpdated':
      case 'RoomRemoved':
        this.eventHandlers.onLobbyUpdate?.(message as BroadcastMessage)
        break
      
      default:
        console.warn('Unknown message type:', message.type)
    }
  }

  /**
   * Private: Process queued messages when connection is restored
   */
  private processQueuedMessages = (): Effect.Effect<void, never> =>
    pipe(
      Effect.logInfo('Processing queued messages'),
      Effect.andThen(() =>
        Effect.async<void, never>((resume) => {
          const processNext = () => {
            Queue.take(this.messageQueue).pipe(
              Effect.andThen((message) =>
                Ref.get(this.wsRef).pipe(
                  Effect.andThen((ws) => {
                    if (ws) {
                      return this.sendMessageDirect(ws, message)
                    }
                    return Effect.void
                  })
                )
              ),
              Effect.catchAll(() => Effect.void),
              Effect.andThen(() => {
                const queueSizeEffect = Queue.size(this.messageQueue)
                const queueSize = Effect.runSync(queueSizeEffect)
                if (queueSize > 0) {
                  processNext()
                } else {
                  resume(Effect.void)
                }
              }),
              Effect.runSync
            )
          }

          const queueSizeEffect = Queue.size(this.messageQueue)
          const queueSize = Effect.runSync(queueSizeEffect)
          if (queueSize > 0) {
            processNext()
          } else {
            resume(Effect.void)
          }
        })
      )
    )

  /**
   * Private: Schedule reconnection with exponential backoff
   */
  private scheduleReconnect = (url: string): Effect.Effect<void, never> => {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      return pipe(
        Effect.logError('Max reconnection attempts reached'),
        Effect.andThen(() => {
          this.setConnectionState('failed')
          return Effect.void
        })
      )
    }

    this.reconnectAttempts++
    const delay = this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts - 1)

    return pipe(
      Effect.logInfo(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`),
      Effect.andThen(() => {
        this.setConnectionState('reconnecting')
        return Effect.sleep(delay)
      }),
      Effect.andThen(() => this.connect(url)),
      Effect.catchAll(() => Effect.void)
    )
  }
}

/**
 * Global signaling manager instance
 */
export const signalingManager = new SignalingManager()

/**
 * Utility function to create WebSocket URL from backend config
 */
export const createWebSocketUrl = (baseUrl?: string, roomId?: string): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = baseUrl || window.location.host
  const path = roomId ? `/ws/dj/${roomId}` : '/ws/lobby'
  
  return `${protocol}//${host}${path}`
}

/**
 * Effect to initialize signaling for a DJ room
 */
export const initializeDJSignaling = (roomId: string, djToken: string): Effect.Effect<void, Error> =>
  pipe(
    Effect.logInfo(`Initializing DJ signaling for room: ${roomId}`),
    Effect.andThen(() => {
      const wsUrl = createWebSocketUrl(undefined, roomId)
      return signalingManager.connect(`${wsUrl}?token=${djToken}`)
    }),
    Effect.andThen(() => signalingManager.subscribeToRoom(roomId))
  )

/**
 * Effect to initialize signaling for lobby/listener
 */
export const initializeLobbySignaling = (): Effect.Effect<void, Error> =>
  pipe(
    Effect.logInfo('Initializing lobby signaling'),
    Effect.andThen(() => {
      const wsUrl = createWebSocketUrl()
      return signalingManager.connect(wsUrl)
    })
  )