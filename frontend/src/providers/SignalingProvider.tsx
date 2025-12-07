import { createContext, useContext, ParentComponent, createSignal, createEffect, onCleanup } from 'solid-js'
import { createStore } from 'solid-js/store'
import { Effect, pipe, Ref, Queue } from 'effect'
import { connectWebSocket, subscribeToMessages } from '../ws/client'
import type { DJMessage, ServerMessage, BroadcastMessage } from '../ws/client'
import type { Room } from '../generated/api.schemas'

// Re-export message types for external use
export type { DJMessage, ServerMessage, BroadcastMessage }

/**
 * WebSocket connection state
 */
export type WSConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error' | 'reconnecting'

/**
 * Signaling message types for different event channels (from signaling-manager.ts)
 */
export type SignalingMessage =
  | { channel: 'room'; roomId: string; data: DJMessage }
  | { channel: 'lobby'; data: BroadcastMessage }
  | { channel: 'system'; data: ServerMessage }

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
  serverMessages: ServerMessage[]
  broadcastMessages: BroadcastMessage[]

  // Error tracking
  connectionErrors: string[]
  lastReconnectAttempt: number | null
}

/**
 * Signaling event handlers
 */
export type SignalingEventHandlers = {
  onRoomUpdate?: (roomId: string, message: ServerMessage) => void
  onLobbyUpdate?: (message: BroadcastMessage) => void
  onSystemMessage?: (message: ServerMessage) => void
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
  sendDJMessage: (roomId: string, message: DJMessage) => Promise<void>
  sendLobbyMessage: (message: BroadcastMessage) => Promise<void>

  // Event handlers
  setEventHandlers: (handlers: SignalingEventHandlers) => void

  // State getters
  getConnectionState: () => WSConnectionState
  getConnectedRooms: () => string[]

  // Real-time subscriptions
  subscribeToRoomUpdates: (callback: (room: Room) => void) => () => void
  subscribeToServerMessages: (callback: (message: ServerMessage) => void) => () => void
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
    broadcastMessages: [],
    connectionErrors: [],
    lastReconnectAttempt: null
  })

  // Effect-based WebSocket references (migrated from SignalingManager)
  const [lobbyWSRef, setLobbyWSRef] = createSignal<WebSocket | null>(null)
  const [roomWSRef, setRoomWSRef] = createSignal<WebSocket | null>(null)
  const [messageQueue, setMessageQueue] = Queue.unbounded<SignalingMessage>()

  // Advanced state for reconnection and queueing
  const [connectedRooms, setConnectedRooms] = createSignal<Set<string>>(new Set())
  const [eventHandlers, setEventHandlersSignal] = createSignal<SignalingEventHandlers>({})
  const [reconnectAttempts, setReconnectAttempts] = createSignal(0)
  const maxReconnectAttempts = 5
  const baseReconnectDelay = 1000

  // Message subscribers
  const [roomUpdateSubscribers, setRoomUpdateSubscribers] = createSignal<((room: Room) => void)[]>([])
  const [serverMessageSubscribers, setServerMessageSubscribers] = createSignal<((message: ServerMessage) => void)[]>([])

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
      Effect.andThen((ws) =>
        pipe(
          Ref.set(isLobby ? lobbyWSRef : roomWSRef, ws),
          Effect.andThen(() => setupWebSocketHandlers(ws, isLobby)),
          Effect.andThen(() => {
            setState(isLobby ? 'lobbyConnectionState' : 'roomConnectionState', 'connected')
            setState(isLobby ? 'lobbyWS' : 'roomWS', ws)
            setReconnectAttempts(0)
            return processQueuedMessages()
          })
        )
      ),
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

    const program = connectWebSocketEffect('ws://localhost:3000/ws/lobby', true)
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
    const program = connectWebSocketEffect(`ws://localhost:3000/ws/room/${roomId}`, false)
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
            Effect.runSync(Ref.set(isLobby ? lobbyWSRef : roomWSRef, null))
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
        const broadcastMessage = message as BroadcastMessage
        setState('broadcastMessages', prev => [...prev, broadcastMessage])

        switch (broadcastMessage.type) {
          case 'RoomAdded':
            if (broadcastMessage.room) {
              setState('rooms', prev => [...prev, broadcastMessage.room!])
              roomUpdateSubscribers().forEach(callback => callback(broadcastMessage.room!))
            }
            break
          case 'RoomUpdated':
            if (broadcastMessage.room) {
              setState('rooms', prev => prev.map(r =>
                r.id === broadcastMessage.room!.id ? broadcastMessage.room! : r
              ))
              roomUpdateSubscribers().forEach(callback => callback(broadcastMessage.room!))
            }
            break
          case 'RoomRemoved':
            if (broadcastMessage.room_id) {
              setState('rooms', prev => prev.filter(r => r.id !== broadcastMessage.room_id))
            }
            break
        }
        eventHandlers().onLobbyUpdate?.(broadcastMessage)
      } else {
        // Handle room-specific messages
        const serverMessage = message as ServerMessage
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
  const sendMessage = (message: SignalingMessage): Effect.Effect<void, Error> =>
    pipe(
      Ref.get(message.channel === 'lobby' ? lobbyWSRef : roomWSRef),
      Effect.andThen((ws) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          return sendMessageDirect(ws, message)
        } else {
          // Queue message for later delivery
          return Queue.offer(messageQueue, message)
        }
      })
    )

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
   * Send DJ message to room WebSocket with queueing
   */
  const sendDJMessage = async (roomId: string, message: DJMessage): Promise<void> => {
    const signalingMessage: SignalingMessage = { channel: 'room', roomId, data: message }
    const program = sendMessage(signalingMessage)

    try {
      await Effect.runPromise(program)
    } catch (error) {
      console.error('Failed to send DJ message:', error)
      throw error
    }
  }

  /**
   * Send lobby broadcast message
   */
  const sendLobbyMessage = async (message: BroadcastMessage): Promise<void> => {
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
   * Process queued messages when connection is restored (migrated from SignalingManager)
   */
  const processQueuedMessages = (): Effect.Effect<void, never> =>
    pipe(
      Effect.logInfo('Processing queued messages'),
      Effect.andThen(() =>
        Effect.async<void, never>((resume) => {
          const processNext = () => {
            Queue.take(messageQueue).pipe(
              Effect.andThen((message) => {
                const wsRef = message.channel === 'lobby' ? lobbyWSRef : roomWSRef
                return Ref.get(wsRef).pipe(
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
                const queueSizeEffect = Queue.size(messageQueue)
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

          const queueSizeEffect = Queue.size(messageQueue)
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
  const subscribeToServerMessages = (callback: (message: ServerMessage) => void): (() => void) => {
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
    sendDJMessage,
    sendLobbyMessage,
    setEventHandlers,
    getConnectionState,
    getConnectedRooms,
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
