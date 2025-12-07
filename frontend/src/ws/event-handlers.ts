import { Effect } from 'effect'
import { createSignal, createRoot } from 'solid-js'
import { signalingManager, SignalingEventHandlers } from './signaling-manager'
import { setConnectionState, setIsStreaming } from '../webrtc/store'
// import { producerActions, consumerActions } from '../webrtc/store'
import type { ServerMessage, BroadcastMessage } from './client'

/**
 * Room state for reactive updates
 */
export type RoomState = {
  id: string
  name: string
  created_at: string
  listener_count: number
  is_live: boolean
}

/**
 * Global reactive state for rooms and events
 */
const [rooms, setRooms] = createSignal<Map<string, RoomState>>(new Map())
const [systemMessages, setSystemMessages] = createSignal<ServerMessage[]>([])
const [currentRoomId, setCurrentRoomId] = createSignal<string | null>(null)

/**
 * Event handlers for WebSocket signaling
 */
export class WebSocketEventHandlers {
  /**
   * Initialize event handlers with signaling manager
   */
  static initialize(): Effect.Effect<void, never> {
    return Effect.sync(() => {
      const handlers: SignalingEventHandlers = {
        onRoomUpdate: WebSocketEventHandlers.handleRoomUpdate,
        onLobbyUpdate: WebSocketEventHandlers.handleLobbyUpdate,
        onSystemMessage: WebSocketEventHandlers.handleSystemMessage,
        onConnectionChange: WebSocketEventHandlers.handleConnectionChange,
        onError: WebSocketEventHandlers.handleError,
      }

      signalingManager.setEventHandlers(handlers)
    })
  }

  /**
   * Handle room-specific updates (DJ events)
   */
  private static handleRoomUpdate = (roomId: string, message: ServerMessage): void => {
    console.log(`Room ${roomId} update:`, message)

    switch (message.type) {
      case 'ProducerCreated':
        if (message.producer_id) {
          Effect.runSync(
            Effect.logInfo(`Producer created in room ${roomId}: ${message.producer_id}`)
          )
          // Update producer state if we're tracking this room
          if (currentRoomId() === roomId) {
            setIsStreaming(true)
          }
        }
        break

      case 'ListenerJoined':
        if (message.count !== undefined) {
          WebSocketEventHandlers.updateRoomListenerCount(roomId, message.count)
        }
        break

      case 'ListenerLeft':
        if (message.count !== undefined) {
          WebSocketEventHandlers.updateRoomListenerCount(roomId, message.count)
        }
        break

      case 'RoomDeleted':
        WebSocketEventHandlers.removeRoom(roomId)
        if (currentRoomId() === roomId) {
          setCurrentRoomId(null)
          setIsStreaming(false)
        }
        break

      case 'Error':
        WebSocketEventHandlers.addSystemMessage(message)
        break
    }
  }

  /**
   * Handle lobby updates (room list changes)
   */
  private static handleLobbyUpdate = (message: BroadcastMessage): void => {
    console.log('Lobby update:', message)

    switch (message.type) {
      case 'RoomAdded':
        if (message.room) {
          WebSocketEventHandlers.addOrUpdateRoom(message.room)
        }
        break

      case 'RoomUpdated':
        if (message.room) {
          WebSocketEventHandlers.addOrUpdateRoom(message.room)
        }
        break

      case 'RoomRemoved':
        if (message.room_id) {
          WebSocketEventHandlers.removeRoom(message.room_id)
        }
        break
    }
  }

  /**
   * Handle system messages
   */
  private static handleSystemMessage = (message: ServerMessage): void => {
    console.log('System message:', message)
    
    WebSocketEventHandlers.addSystemMessage(message)

    // Handle specific system events
    switch (message.type) {
      case 'Error':
        // Show error notification
        break
    }
  }

  /**
   * Handle connection state changes
   */
  private static handleConnectionChange = (state: string): void => {
    console.log('Connection state changed:', state)
    setConnectionState(state as any)
    
    // Update WebRTC store based on connection state
    if (state === 'disconnected') {
      setIsStreaming(false)
    }
  }

  /**
   * Handle WebSocket errors
   */
  private static handleError = (error: Error): void => {
    console.error('WebSocket error:', error)
    
    WebSocketEventHandlers.addSystemMessage({
      type: 'Error',
      message: error.message,
    })
  }

  /**
   * Add or update room in the reactive store
   */
  private static addOrUpdateRoom = (roomData: any): void => {
    const room: RoomState = {
      id: roomData.id,
      name: roomData.name,
      created_at: roomData.created_at,
      listener_count: roomData.listener_count || 0,
      is_live: roomData.is_live || false,
    }

    setRooms(currentRooms => {
      const newRooms = new Map(currentRooms)
      newRooms.set(room.id, room)
      return newRooms
    })
  }

  /**
   * Remove room from the reactive store
   */
  private static removeRoom = (roomId: string): void => {
    setRooms(currentRooms => {
      const newRooms = new Map(currentRooms)
      newRooms.delete(roomId)
      return newRooms
    })
  }

  /**
   * Update room listener count
   */
  private static updateRoomListenerCount = (roomId: string, count: number): void => {
    setRooms(currentRooms => {
      const newRooms = new Map(currentRooms)
      const room = newRooms.get(roomId)
      if (room) {
        newRooms.set(roomId, { ...room, listener_count: count })
      }
      return newRooms
    })
  }

  /**
   * Add system message to the reactive store
   */
  private static addSystemMessage = (message: ServerMessage): void => {
    setSystemMessages(currentMessages => {
      const newMessages = [...currentMessages, message]
      // Keep only last 50 messages
      return newMessages.slice(-50)
    })
  }
}

/**
 * Reactive getters for component access
 */
export const getRooms = (): Map<string, RoomState> => rooms()
export const getRoomsArray = (): RoomState[] => Array.from(rooms().values())
export const getLiveRooms = (): RoomState[] => getRoomsArray().filter(room => room.is_live)
export const getSystemMessages = (): ServerMessage[] => systemMessages()
export const getCurrentRoomId = (): string | null => currentRoomId()

/**
 * Actions for updating current room context
 */
export const setCurrentRoom = (roomId: string | null): void => {
  setCurrentRoomId(roomId)
}

/**
 * Get room by ID
 */
export const getRoomById = (roomId: string): RoomState | undefined => rooms().get(roomId)

/**
 * Initialize WebSocket event handling system
 */
export const initializeWebSocketEvents = (): Effect.Effect<void, never> =>
  createRoot(() => WebSocketEventHandlers.initialize())

/**
 * Utility to format system messages for display
 */
export const formatSystemMessage = (message: ServerMessage): string => {
  switch (message.type) {
    case 'ProducerCreated':
      return `Producer created: ${message.producer_id}`
    case 'RoomDeleted':
      return 'Room has been deleted'
    case 'ListenerJoined':
      return `Listener joined (${message.count} total)`
    case 'ListenerLeft':
      return `Listener left (${message.count} total)`
    case 'Error':
      return `Error: ${message.message || 'Unknown error'}`
    default:
      return `System: ${message.type}`
  }
}

/**
 * Subscribe to room events (for components)
 */
export const subscribeToRoom = (roomId: string): Effect.Effect<void, Error> =>
  Effect.all([
    signalingManager.subscribeToRoom(roomId),
    Effect.sync(() => setCurrentRoom(roomId))
  ]).pipe(Effect.map(() => void 0))

/**
 * Unsubscribe from room events
 */
export const unsubscribeFromRoom = (roomId: string): Effect.Effect<void, Error> =>
  Effect.all([
    signalingManager.unsubscribeFromRoom(roomId),
    Effect.sync(() => {
      if (currentRoomId() === roomId) {
        setCurrentRoom(null)
      }
    })
  ]).pipe(Effect.map(() => void 0))

/**
 * Clear all rooms (for logout/cleanup)
 */
export const clearAllRooms = (): void => {
  setRooms(new Map())
  setSystemMessages([])
  setCurrentRoom(null)
}

/**
 * Get connection statistics for debugging
 */
export const getConnectionStats = () => ({
  connectionState: signalingManager.getConnectionState(),
  connectedRooms: signalingManager.getConnectedRooms(),
  totalRooms: rooms().size,
  liveRooms: getLiveRooms().length,
  systemMessages: systemMessages().length,
  currentRoom: currentRoomId(),
})

/**
 * Re-export signaling functions for convenience
 */
export { initializeLobbySignaling } from './signaling-manager'