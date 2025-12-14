import { createContext, useContext, ParentComponent, createSignal, createEffect, onCleanup } from 'solid-js'
import { createStore } from 'solid-js/store'
import { Effect, pipe, Ref, Queue, Option } from 'effect'
import { connectWebSocket, subscribeToMessages } from '../ws/client'
import type { ClientCommand, ServerEvent, LobbyEvent } from '../models/websocket'
import type { Room } from '../models/websocket'
import { createWebSocketSpan } from '../telemetry'

// Re-export message types for external use
export type { ClientCommand, ServerEvent, LobbyEvent }

/**
 * WebSocket connection state
 */
export type WSConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error' | 'reconnecting'

/**
 * Signaling message types for different event channels
 */
export type SignalingMessage =
  | { channel: 'room'; roomId: string; data: ClientCommand }
  | { channel: 'lobby'; data: LobbyEvent }
  | { channel: 'system'; data: ServerEvent }

/**
 * Signaling store state
 */
export type SignalingStore = {
  // WebSocket connections
  lobbyWS: WebSocket | null
  roomWS: WebSocket | null

  // Connection states
  lobbyConnectionState: WSConnectionState
  roomConnectionState: WSConnectionState

  // Real-time data
  rooms: Room[]
  currentRoomId: string | null

  // Message history
  serverMessages: ServerEvent[]
  lobbyMessages: LobbyEvent[]

  // Error tracking
  connectionErrors: string[]
  lastReconnectAttempt: number | null
}

/**
 * Signaling event handlers
 */
export type SignalingEventHandlers = {
  onRoomUpdate?: (roomId: string, message: ServerEvent) => void
  onLobbyUpdate?: (message: LobbyEvent) => void
  onSystemMessage?: (message: ServerEvent) => void
  onConnectionChange?: (state: WSConnectionState) => void
  onError?: (error: Error) => void
}

/**
 * Signaling Context type
 */
export type SignalingContextType = {
  state: SignalingStore
  setState: (updates: Partial<SignalingStore> | ((prev: SignalingStore) => Partial<SignalingStore>)) => void

  // WebSocket management with reconnection
  connectToLobby: () => Promise<void>
  connectToRoom: (roomId: string) => Promise<void>
  disconnect: () => void

  // Advanced connection management
  subscribeToRoom: (roomId: string) => Promise<void>
  unsubscribeFromRoom: (roomId: string) => void

  // Message sending with queueing
  sendCommand: (roomId: string, message: ClientCommand) => Promise<void>
  sendLobbyMessage: (message: LobbyEvent) => Promise<void>

  // Event handlers
  setEventHandlers: (handlers: SignalingEventHandlers) => void

  // State getters
  getConnectionState: () => WSConnectionState
  getConnectedRooms: () => string[]
  getRoomWebSocket: () => Option.Option<WebSocket>

  // Real-time subscriptions
  subscribeToRoomUpdates: (callback: (room: Room) => void) => () => void
  subscribeToServerMessages: (callback: (message: ServerEvent) => void) => () => void
}

const SignalingContext = createContext<SignalingContextType>()

/**
 * Signaling Provider component
 * Manages WebSocket connections and real-time events
 */
export const SignalingProvider: ParentComponent = (props) => {
  // Main signaling store
  const [state, setState] = createStore<SignalingStore>({
    lobbyWS: null,
    roomWS: null,
    lobbyConnectionState: 'disconnected',
    roomConnectionState: 'disconnected',
    rooms: [],
    currentRoomId: null,
    serverMessages: [],
    lobbyMessages: [],
    connectionErrors: [],
    lastReconnectAttempt: null
  })

  // Effect-based WebSocket references (migrated from SignalingManager)
  const [_lobbyWSRef] = createSignal<WebSocket | null>(null)
  const [_roomWSRef] = createSignal<WebSocket | null>(null)

  // Effect Refs for WebSocket connections
  const [lobbyWSEffectRef, setLobbyWSEffectRef] = createSignal<Ref.Ref<WebSocket | null> | null>(null)
  const [roomWSEffectRef, setRoomWSEffectRef] = createSignal<Ref.Ref<WebSocket | null> | null>(null)
  const [messageQueue, setMessageQueue] = createSignal<Queue.Queue<SignalingMessage> | null>(null)

  // Advanced state for reconnection and queueing
  const [connectedRooms, setConnectedRooms] = createSignal<Set<string>>(new Set())
  const [eventHandlers, setEventHandlersSignal] = createSignal<SignalingEventHandlers>({})
  const [reconnectAttempts, setReconnectAttempts] = createSignal(0)
  const maxReconnectAttempts = 5
  const baseReconnectDelay = 1000

  // Message subscribers
  const [roomUpdateSubscribers, setRoomUpdateSubscribers] = createSignal<((room: Room) => void)[]>([])
  const [serverMessageSubscribers, setServerMessageSubscribers] = createSignal<((message: ServerEvent) => void)[]>([])

  // Initialize Effect Refs and message queue asynchronously
  createEffect(() => {
    if (!lobbyWSEffectRef()) {
      Effect.runPromise(Ref.make<WebSocket | null>(null))
        .then(ref => setLobbyWSEffectRef(ref))
        .catch(err => console.error('Failed to create lobby WebSocket ref:', err))
    }
    if (!roomWSEffectRef()) {
      Effect.runPromise(Ref.make<WebSocket | null>(null))
        .then(ref => setRoomWSEffectRef(ref))
        .catch(err => console.error('Failed to create room WebSocket ref:', err))
    }
    if (!messageQueue()) {
      Effect.runPromise(Queue.unbounded<SignalingMessage>())
        .then(queue => setMessageQueue(queue))
        .catch(err => console.error('Failed to create message queue:', err))
    }
  })

  // Connection state change effect
  createEffect(() => {
    const lobbyState = state.lobbyConnectionState
    eventHandlers().onConnectionChange?.(lobbyState)
  })

  /**
   * Effect-based WebSocket connection (migrated from SignalingManager)
   */
  const connectWebSocketEffect = (url: string, isLobby: boolean): Effect.Effect<void, Error> =>
    pipe(
      Effect.logInfo(`Connecting to WebSocket: ${url}`),
      Effect.andThen(() => {
        setState(isLobby ? 'lobbyConnectionState' : 'roomConnectionState', 'connecting')
        return connectWebSocket(url)
      }),
      Effect.andThen((ws) => {
        const wsRef = isLobby ? lobbyWSEffectRef() : roomWSEffectRef()
        if (!wsRef) return Effect.fail(new Error('WebSocket ref not initialized'))

        return pipe(
          Ref.set(wsRef, ws),
          Effect.andThen(() => setupWebSocketHandlers(ws, isLobby)),
          Effect.andThen(() => {
            setState(isLobby ? 'lobbyConnectionState' : 'roomConnectionState', 'connected')
            setState(isLobby ? 'lobbyWS' : 'roomWS', ws)
            setReconnectAttempts(0)
            return processQueuedMessages()
          })
        )
      }),
      Effect.catchAll((error) =>
        pipe(
          Effect.logError(`WebSocket connection failed: ${error.message}`),
          Effect.andThen(() => {
            setState(isLobby ? 'lobbyConnectionState' : 'roomConnectionState', 'error')
            setState('connectionErrors', prev => [...prev, String(error)])
            eventHandlers().onError?.(error)
            return scheduleReconnect(url, isLobby)
          })
        )
      )
    )

  /**
   * Connect to lobby WebSocket with Effect
   */
  const connectToLobby = async (): Promise<void> => {
    if (state.lobbyConnectionState === 'connecting' || state.lobbyConnectionState === 'connected') {
      return
    }

    const program = connectWebSocketEffect('/ws/lobby', true)
    try {
      await Effect.runPromise(program)
    } catch (error) {
      console.error('Failed to connect to lobby:', error)
    }
  }

  /**
   * Connect to room-specific WebSocket
   */
  const connectToRoom = async (roomId: string): Promise<void> => {
    if (state.roomConnectionState === 'connecting' || state.roomConnectionState === 'connected') {
      return
    }

    setState('currentRoomId', roomId)
    const program = connectWebSocketEffect(`/ws/room/${roomId}`, false)
    try {
      await Effect.runPromise(program)
    } catch (error) {
      console.error('Failed to connect to room:', error)
    }
  }

  /**
   * Setup WebSocket handlers (migrated from SignalingManager)
   */
  const setupWebSocketHandlers = (ws: WebSocket, isLobby: boolean): Effect.Effect<void, never> =>
    pipe(
      subscribeToMessages(
        ws,
        (message: any) => handleIncomingMessage(message, isLobby),
        (error: Error) => eventHandlers().onError?.(error)
      ),
      Effect.andThen(() =>
        Effect.sync(() => {
          ws.onclose = () => {
            setState(isLobby ? 'lobbyConnectionState' : 'roomConnectionState', 'disconnected')
            setState(isLobby ? 'lobbyWS' : 'roomWS', null)
            if (!isLobby) setState('currentRoomId', null)

            // Clear the Effect ref asynchronously
            const wsRef = isLobby ? lobbyWSEffectRef() : roomWSEffectRef()
            if (wsRef) {
              Effect.runPromise(Ref.set(wsRef, null)).catch(console.error)
            }
          }
        })
      )
    )

  /**
   * Handle incoming WebSocket messages (migrated from SignalingManager)
   */
  const handleIncomingMessage = (message: any, isLobby: boolean): void => {
    try {
      if (isLobby) {
        // Handle lobby broadcast messages
        const lobbyMessage = message as LobbyEvent
        setState('lobbyMessages', prev => [...prev, lobbyMessage])

        switch (lobbyMessage.type) {
          case 'roomAdded':
            if (lobbyMessage.room) {
              // Only add room if it doesn't already exist
              setState('rooms', prev => {
                const existingIndex = prev.findIndex(r => r.id === lobbyMessage.room!.id)
                if (existingIndex >= 0) {
                  // Room already exists, update it instead
                  const updated = [...prev]
                  updated[existingIndex] = lobbyMessage.room!
                  return updated
                } else {
                  // New room, add it
                  return [...prev, lobbyMessage.room!]
                }
              })
              roomUpdateSubscribers().forEach(callback => callback(lobbyMessage.room!))
            }
            break
          case 'roomUpdated':
            if (lobbyMessage.room) {
              setState('rooms', prev => prev.map(r =>
                r.id === lobbyMessage.room!.id ? lobbyMessage.room! : r
              ))
              roomUpdateSubscribers().forEach(callback => callback(lobbyMessage.room!))
            }
            break
          case 'roomRemoved':
            if (lobbyMessage.roomId) {
              setState('rooms', prev => prev.filter(r => r.id !== lobbyMessage.roomId))
            }
            break
        }
        eventHandlers().onLobbyUpdate?.(lobbyMessage)
      } else {
        // Handle room-specific messages
        const serverMessage = message as ServerEvent
        setState('serverMessages', prev => [...prev, serverMessage])
        serverMessageSubscribers().forEach(callback => callback(serverMessage))

        if (state.currentRoomId) {
          eventHandlers().onRoomUpdate?.(state.currentRoomId, serverMessage)
        }
      }
    } catch (error) {
      console.error('Failed to handle incoming message:', error)
      eventHandlers().onError?.(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Disconnect from all WebSockets
   */
  const disconnect = (): void => {
    if (state.lobbyWS) {
      state.lobbyWS.close()
      setState({ lobbyWS: null, lobbyConnectionState: 'disconnected' })
    }

    if (state.roomWS) {
      state.roomWS.close()
      setState({
        roomWS: null,
        roomConnectionState: 'disconnected',
        currentRoomId: null
      })
    }
  }

  /**
   * Subscribe to specific room events
   */
  const subscribeToRoom = async (roomId: string): Promise<void> => {
    const rooms = new Set(connectedRooms())
    rooms.add(roomId)
    setConnectedRooms(rooms)

    // If not already connected to this room, connect
    if (state.currentRoomId !== roomId) {
      await connectToRoom(roomId)
    }
  }

  /**
   * Unsubscribe from room events
   */
  const unsubscribeFromRoom = (roomId: string): void => {
    const rooms = new Set(connectedRooms())
    rooms.delete(roomId)
    setConnectedRooms(rooms)

    // If this was the current room, disconnect
    if (state.currentRoomId === roomId) {
      if (state.roomWS) {
        state.roomWS.close()
        setState({
          roomWS: null,
          roomConnectionState: 'disconnected',
          currentRoomId: null
        })
      }
    }
  }

  /**
   * Effect-based message sending (migrated from SignalingManager)
   */
  const sendMessage = (message: SignalingMessage): Effect.Effect<void, Error> => {
    const wsRef = message.channel === 'lobby' ? lobbyWSEffectRef() : roomWSEffectRef()
    if (!wsRef) return Effect.fail(new Error('WebSocket ref not initialized'))

    return pipe(
      Ref.get(wsRef),
      Effect.andThen((ws) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          return sendMessageDirect(ws, message)
        } else {
          // Queue message for later delivery
          const queue = messageQueue()
          return queue ? Queue.offer(queue, message) : Effect.void
        }
      })
    )
  }

  /**
   * Send message directly to WebSocket (migrated from SignalingManager)
   */
  const sendMessageDirect = (ws: WebSocket, message: SignalingMessage): Effect.Effect<void, Error> =>
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
   * Send client command to room WebSocket with queueing
   */
  const sendCommand = async (roomId: string, message: ClientCommand): Promise<void> => {
    const span = createWebSocketSpan('send_command', {
      messageType: message.type,
      roomId,
      operation: 'send'
    })

    try {
      // ClientCommand already has trace context from getWebSocketTraceContext()
      // No need for additional injection since it uses SerializedTraceContext format
      const signalingMessage: SignalingMessage = { channel: 'room', roomId, data: message }
      const program = sendMessage(signalingMessage)

      await Effect.runPromise(program)
      span.setStatus()
    } catch (error) {
      console.error('Failed to send client command:', error)
      span.recordException()
      span.setStatus()
      throw error
    } finally {
      span.end()
    }
  }

  /**
   * Send lobby broadcast message
   */
  const sendLobbyMessage = async (message: LobbyEvent): Promise<void> => {
    const signalingMessage: SignalingMessage = { channel: 'lobby', data: message }
    const program = sendMessage(signalingMessage)

    try {
      await Effect.runPromise(program)
    } catch (error) {
      console.error('Failed to send lobby message:', error)
      throw error
    }
  }

  /**
   * Set event handlers for callbacks
   */
  const setEventHandlers = (handlers: SignalingEventHandlers): void => {
    setEventHandlersSignal(prev => ({ ...prev, ...handlers }))
  }

  /**
   * Get current connection state
   */
  const getConnectionState = (): WSConnectionState => state.lobbyConnectionState

  /**
   * Get list of connected rooms
   */
  const getConnectedRooms = (): string[] => Array.from(connectedRooms())

  /**
   * Get the current room WebSocket connection
   */
  const getRoomWebSocket = (): Option.Option<WebSocket> => Option.fromNullable(state.roomWS)

  /**
   * Process queued messages when connection is restored (migrated from SignalingManager)
   */
  const processQueuedMessages = (): Effect.Effect<void, never> =>
    pipe(
      Effect.logInfo('Processing queued messages'),
      Effect.andThen(() => {
        const queue = messageQueue()
        if (!queue) return Effect.void

        return Effect.async<void, never>((resume) => {
          const processNext = () => {
            Queue.take(queue).pipe(
              Effect.andThen((message) => {
                const effectRef = message.channel === 'lobby' ? lobbyWSEffectRef() : roomWSEffectRef()
                if (!effectRef) return Effect.void

                return Ref.get(effectRef).pipe(
                  Effect.andThen((ws) => {
                    if (ws) {
                      return sendMessageDirect(ws, message)
                    }
                    return Effect.void
                  })
                )
              }),
              Effect.catchAll(() => Effect.void),
              Effect.andThen(() => {
                Queue.size(queue).pipe(
                  Effect.andThen((queueSize) => {
                    if (queueSize > 0) {
                      processNext()
                    } else {
                      resume(Effect.void)
                    }
                    return Effect.void
                  }),
                  Effect.runPromise
                )
              }),
              Effect.runPromise
            ).catch(() => {
              resume(Effect.void)
            })
          }

          Queue.size(queue).pipe(
            Effect.andThen((queueSize) => {
              if (queueSize > 0) {
                processNext()
              } else {
                resume(Effect.void)
              }
              return Effect.void
            }),
            Effect.runPromise
          ).catch(() => {
            resume(Effect.void)
          })
        })
      })
    )

  /**
   * Schedule reconnection with exponential backoff (migrated from SignalingManager)
   */
  const scheduleReconnect = (url: string, isRoom: boolean): Effect.Effect<void, never> => {
    const attempts = reconnectAttempts()
    if (attempts >= maxReconnectAttempts) {
      return pipe(
        Effect.logError('Max reconnection attempts reached'),
        Effect.andThen(() => {
          setState(isRoom ? 'roomConnectionState' : 'lobbyConnectionState', 'error')
          const errorMsg = `Max reconnection attempts (${maxReconnectAttempts}) reached`
          setState('connectionErrors', prev => [...prev, errorMsg])
          eventHandlers().onError?.(new Error(errorMsg))
          return Effect.void
        })
      )
    }

    const delay = baseReconnectDelay * Math.pow(2, attempts)
    setReconnectAttempts(attempts + 1)
    setState('lastReconnectAttempt', Date.now())

    return pipe(
      Effect.logInfo(`Scheduling reconnect attempt ${attempts + 1} in ${delay}ms`),
      Effect.andThen(() => {
        setState(isRoom ? 'roomConnectionState' : 'lobbyConnectionState', 'reconnecting')
        return Effect.sleep(delay)
      }),
      Effect.andThen(() => connectWebSocketEffect(url, !isRoom)),
      Effect.catchAll(() => Effect.void)
    )
  }


  /**
   * Subscribe to room updates
   */
  const subscribeToRoomUpdates = (callback: (room: Room) => void): (() => void) => {
    setRoomUpdateSubscribers(prev => [...prev, callback])

    // Return unsubscribe function
    return () => {
      setRoomUpdateSubscribers(prev => prev.filter(cb => cb !== callback))
    }
  }

  /**
   * Subscribe to server messages
   */
  const subscribeToServerMessages = (callback: (message: ServerEvent) => void): (() => void) => {
    setServerMessageSubscribers(prev => [...prev, callback])

    // Return unsubscribe function
    return () => {
      setServerMessageSubscribers(prev => prev.filter(cb => cb !== callback))
    }
  }

  // Cleanup on unmount
  onCleanup(() => {
    disconnect()
  })

  const contextValue: SignalingContextType = {
    state,
    setState,
    connectToLobby,
    connectToRoom,
    disconnect,
    subscribeToRoom,
    unsubscribeFromRoom,
    sendCommand,
    sendLobbyMessage,
    setEventHandlers,
    getConnectionState,
    getConnectedRooms,
    getRoomWebSocket,
    subscribeToRoomUpdates,
    subscribeToServerMessages
  }

  return (
    <SignalingContext.Provider value={contextValue}>
      {props.children}
    </SignalingContext.Provider>
  )
}

/**
 * Hook to access Signaling context
 */
export const useSignaling = (): SignalingContextType => {
  const context = useContext(SignalingContext)
  if (!context) {
    throw new Error('useSignaling must be used within SignalingProvider')
  }
  return context
}

/**
 * Helper hooks for specific signaling functionality
 */

// Get lobby connection state
export const useLobbyConnection = () => {
  const { state } = useSignaling()
  return () => state.lobbyConnectionState
}

// Get room connection state
export const useRoomConnection = () => {
  const { state } = useSignaling()
  return () => state.roomConnectionState
}

// Get current rooms
export const useRooms = () => {
  const { state } = useSignaling()
  return () => state.rooms
}

// Get current room ID
export const useCurrentRoom = () => {
  const { state } = useSignaling()
  return () => state.currentRoomId
}
