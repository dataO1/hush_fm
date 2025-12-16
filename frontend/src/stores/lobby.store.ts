/**
 * Lobby Store
 * 
 * Reactive store for lobby state management. Bridges between pure domain schemas
 * and the UI by integrating with lobby flow services via Effects.
 * 
 * Extracted from: SignalingProvider.tsx lobby-related functionality
 */

import { createSignal } from 'solid-js'
import { createStore } from 'solid-js/store'
import { Option } from 'effect'
import type { RoomInfo } from '../services/generated/hushFMAPI.schemas'
import {
  type LobbyState,
  createInitialLobbyState
} from '../domain/schemas/lobby.schema'

/**
 * Lobby store actions - Pure state setters only
 */
export interface LobbyStoreActions {
  // Connection state management
  setConnecting: (connecting: boolean) => void
  setConnected: (websocket: WebSocket | null) => void
  setDisconnected: () => void
  setConnectionError: (error: string) => void
  
  // Room discovery state management
  setRoomsLoading: (loading: boolean) => void
  setRooms: (rooms: RoomInfo[]) => void
  setRoomDiscoveryError: (error: string) => void
  
  // Room creation state management
  setRoomCreating: (creating: boolean) => void
  setRoomCreationError: (error: string) => void
  setLastCreatedRoom: (roomId: string) => void
  
  // Room management
  addRoom: (room: RoomInfo) => void
  updateRoom: (room: RoomInfo) => void
  removeRoom: (roomId: string) => void
  
  // General error management
  clearError: () => void
}

/**
 * Create lobby store
 */
export const createLobbyStore = () => {
  // Main reactive state
  const [state, setState] = createStore(createInitialLobbyState() as any)
  
  // Additional UI signals
  const [isConnecting, setIsConnecting] = createSignal(false)
  const [isRefreshing, setIsRefreshing] = createSignal(false)
  const [isCreating, setIsCreating] = createSignal(false)
  
  // Pure state actions - no Effects, no service calls
  const actions: LobbyStoreActions = {
    // Connection state management
    setConnecting: (connecting: boolean) => {
      setIsConnecting(connecting)
      setState('connection', 'state', connecting ? 'connecting' : 'disconnected')
    },
    
    setConnected: (websocket: WebSocket | null) => {
      setIsConnecting(false)
      setState('connection', {
        websocket: websocket ? Option.some(websocket) : Option.none(),
        state: 'connected',
        lastConnectedAt: Option.some(new Date()),
        connectionAttempts: 0,
        lastError: Option.none()
      })
    },
    
    setDisconnected: () => {
      setIsConnecting(false)
      setState('connection', {
        websocket: Option.none(),
        state: 'disconnected',
        connectionAttempts: 0,
        lastError: Option.none()
      })
    },
    
    setConnectionError: (error: string) => {
      setIsConnecting(false)
      setState('connection', {
        state: 'error',
        lastError: Option.some(error)
      })
    },
    
    // Room discovery state management
    setRoomsLoading: (loading: boolean) => {
      setIsRefreshing(loading)
      setState('discovery', 'loading', loading)
    },
    
    setRooms: (rooms: RoomInfo[]) => {
      setIsRefreshing(false)
      setState('discovery', {
        availableRooms: rooms,
        loading: false,
        lastRefreshAt: Option.some(new Date()),
        refreshError: Option.none()
      })
    },
    
    setRoomDiscoveryError: (error: string) => {
      setIsRefreshing(false)
      setState('discovery', {
        loading: false,
        refreshError: Option.some(error)
      })
    },
    
    // Room creation state management
    setRoomCreating: (creating: boolean) => {
      setIsCreating(creating)
      setState('creation', 'creating', creating)
    },
    
    setRoomCreationError: (error: string) => {
      setIsCreating(false)
      setState('creation', {
        creating: false,
        creationError: Option.some(error)
      })
    },
    
    setLastCreatedRoom: (roomId: string) => {
      setIsCreating(false)
      setState('creation', {
        creating: false,
        creationError: Option.none(),
        lastCreatedRoomId: Option.some(roomId)
      })
    },
    
    // Room management
    addRoom: (room: RoomInfo) => {
      setState('discovery', 'availableRooms', (rooms: RoomInfo[]) => [...rooms, room])
    },
    
    updateRoom: (updatedRoom: RoomInfo) => {
      setState('discovery', 'availableRooms', (rooms: RoomInfo[]) =>
        rooms.map((room: RoomInfo) => room.id === updatedRoom.id ? updatedRoom : room)
      )
    },
    
    removeRoom: (roomId: string) => {
      setState('discovery', 'availableRooms', (rooms: RoomInfo[]) =>
        rooms.filter((room: RoomInfo) => room.id !== roomId)
      )
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
    
    // UI signals
    isConnecting,
    isRefreshing,
    isCreating,
    
    // Actions
    actions,
    
    // Computed values
    get isConnected() {
      return state.connection.state === 'connected'
    },
    
    get availableRooms() {
      return state.discovery.availableRooms as RoomInfo[]
    },
    
    get connectionError() {
      return Option.getOrNull(state.connection.lastError)
    },
    
    get lastCreatedRoomId() {
      return Option.getOrNull(state.creation.lastCreatedRoomId)
    },
    
  }
}

/**
 * Lobby store type
 */
export type LobbyStore = ReturnType<typeof createLobbyStore>