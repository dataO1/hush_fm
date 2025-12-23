/**
 * Lobby Store
 * 
 * Reactive store for lobby state management. Bridges between pure domain schemas
 * and the UI by integrating with lobby flow services via Effects.
 * 
 * Extracted from: SignalingProvider.tsx lobby-related functionality
 */

import { createStore } from 'solid-js/store'
import { Option } from 'effect'
import type {
  LobbyStateType,
  LobbyRoomInfoType
} from '../domain/schemas/lobby.schema'
import type { RoomInfo } from '../domain/schemas/room.schema'
import { createInitialLobbyState } from '../domain/schemas/lobby.schema'

/**
 * Lobby store actions - Pure state setters only (using schema-inferred types)
 */
export interface LobbyStoreActions {
  // Connection state management
  setConnecting: (connecting: boolean) => void
  setConnected: (websocket: WebSocket | null) => void
  setDisconnected: () => void
  setConnectionError: (error: string) => void
  
  // Room discovery state management
  setRoomsLoading: (loading: boolean) => void
  setRooms: (rooms: LobbyRoomInfoType[]) => void
  setRoomDiscoveryError: (error: string) => void
  
  // Room creation state management
  setRoomCreating: (creating: boolean) => void
  setRoomCreationError: (error: string) => void
  setLastCreatedRoom: (roomId: string) => void
  
  // Room management
  addRoom: (room: LobbyRoomInfoType) => void
  updateRoom: (room: LobbyRoomInfoType) => void
  removeRoom: (roomId: string) => void
  
  // Search and filtering
  setSearchTerm: (term: string | null) => void
  setTagFilter: (tags: string[]) => void
  setShowOnlyStreaming: (showOnly: boolean) => void
  
  // Page lifecycle reset actions (pure state only - called by services)
  clearRooms: () => void
  
  // General error management
  clearError: () => void
}

/**
 * Create lobby store
 */
export const createLobbyStore = () => {
  // SolidJS 2025: Single source of truth - all state in store (no duplicate signals)
  const [state, setState] = createStore(createInitialLobbyState() as any)
  
  // Pure state actions - no Effects, no service calls
  const actions: LobbyStoreActions = {
    // Connection state management
    setConnecting: (connecting: boolean) => {
      setState('connection', 'state', connecting ? 'connecting' : 'disconnected')
    },
    
    setConnected: (websocket: WebSocket | null) => {
      setState('connection', {
        websocket: websocket ? Option.some(websocket) : Option.none(),
        state: 'connected',
        lastConnectedAt: Option.some(new Date()),
        connectionAttempts: 0,
        lastError: Option.none()
      })
    },
    
    setDisconnected: () => {
      setState('connection', {
        websocket: Option.none(),
        state: 'disconnected',
        connectionAttempts: 0,
        lastError: Option.none()
      })
    },
    
    setConnectionError: (error: string) => {
      setState('connection', {
        state: 'error',
        lastError: Option.some(error)
      })
    },
    
    // Room discovery state management
    setRoomsLoading: (loading: boolean) => {
      setState('discovery', 'loading', loading)
    },
    
    setRooms: (rooms: RoomInfo[]) => {
      // Convert array to Map for efficient lookups and inherent uniqueness
      const roomsMap = rooms.reduce((map: Record<string, RoomInfo>, room: RoomInfo) => {
        map[room.id] = room
        return map
      }, {})
      setState('discovery', {
        availableRooms: roomsMap,
        loading: false,
        lastRefreshAt: Option.some(new Date()),
        refreshError: Option.none()
      })
    },
    
    setRoomDiscoveryError: (error: string) => {
      setState('discovery', {
        loading: false,
        refreshError: Option.some(error)
      })
    },
    
    // Room creation state management
    setRoomCreating: (creating: boolean) => {
      setState('creation', 'creating', creating)
    },
    
    setRoomCreationError: (error: string) => {
      setState('creation', {
        creating: false,
        creationError: Option.some(error)
      })
    },
    
    setLastCreatedRoom: (roomId: string) => {
      setState('creation', {
        creating: false,
        creationError: Option.none(),
        lastCreatedRoomId: Option.some(roomId)
      })
    },
    
    // Room management - efficient Set-like operations with Map structure
    addRoom: (room: RoomInfo) => {
      setState('discovery', 'availableRooms', (roomsMap: Record<string, RoomInfo>) => ({
        ...roomsMap,
        [room.id]: room  // Automatically overwrites if exists, adds if new - O(1) operation
      }))
    },
    
    updateRoom: (updatedRoom: RoomInfo) => {
      setState('discovery', 'availableRooms', (roomsMap: Record<string, RoomInfo>) => ({
        ...roomsMap,
        [updatedRoom.id]: updatedRoom  // O(1) update operation
      }))
    },
    
    removeRoom: (roomId: string) => {
      setState('discovery', 'availableRooms', (roomsMap: Record<string, RoomInfo>) => {
        const newMap = { ...roomsMap }
        delete newMap[roomId]  // O(1) deletion
        return newMap
      })
    },
    
    // Page lifecycle reset actions (pure state only - called by services)
    clearRooms: () => {
      console.info('🧹 Lobby store: Clearing all rooms')
      setState('discovery', {
        availableRooms: {},
        loading: false,
        lastRefreshAt: Option.none(),
        refreshError: Option.none()
      })
    },
    
    // General error management
    clearError: () => {
      setState('connection', 'lastError', Option.none())
      setState('discovery', 'refreshError', Option.none())
      setState('creation', 'creationError', Option.none())
    }
  }

  return {
    // Reactive state (read-only)
    state: state as Readonly<LobbyState>,
    
    // Actions
    actions,
    
    // Computed values
    get isConnected() {
      return state.connection.state === 'connected'
    },
    
    get isConnecting() {
      return state.connection.state === 'connecting'
    },
    
    get isLoading() {
      return state.discovery.loading
    },
    
    get isCreating() {
      return state.creation.creating
    },
    
    get availableRooms() {
      return Object.values(state.discovery.availableRooms as Record<string, RoomInfo>) as RoomInfo[]
    },
    
    get connectionError() {
      return Option.getOrNull(state.connection.lastError)
    },
    
    get lastCreatedRoomId() {
      return Option.getOrNull(state.creation.lastCreatedRoomId)
    },
    
    get creationError() {
      return Option.getOrNull(state.creation.creationError)
    },

    // SolidJS 2025: Simple getter for rooms (domain logic moved to application service)
    // The complex sorting logic stays in LobbyApplicationService.sortRoomsForUser()
    // Store provides basic sorted rooms by listener count
    get sortedRoomsByListenerCount() {
      const rooms = Object.values(state.discovery.availableRooms as Record<string, RoomInfo>) as RoomInfo[]
      return rooms.slice().sort((a, b) => (b.listenerCount || 0) - (a.listenerCount || 0))
    },
    
  }
}

/**
 * Lobby store type
 */
export type LobbyStore = ReturnType<typeof createLobbyStore>

/**
 * Singleton lobby store instance
 */
let lobbyStoreInstance: LobbyStore | null = null

/**
 * Get or create the singleton lobby store instance
 */
export const getLobbyStore = (): LobbyStore => {
  if (!lobbyStoreInstance) {
    lobbyStoreInstance = createLobbyStore()
  }
  return lobbyStoreInstance
}

/**
 * Reset the global lobby store (useful for testing)
 */
export const resetGlobalLobbyStore = (): void => {
  if (lobbyStoreInstance) {
    lobbyStoreInstance.actions.clearRooms()
  }
  lobbyStoreInstance = null
}