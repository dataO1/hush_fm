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
import { LobbyRoomInfoType, LobbyStateType, createInitialLobbyState } from '@/domain/schemas/lobby.schema'

/**
 * Lobby store actions - Pure state setters only (using schema-inferred types)
 */
export interface LobbyStoreActions {
  setRoomsLoading: (loading: boolean) => void
  setRooms: (rooms: LobbyRoomInfoType[]) => void

  // Room creation state management
  setRoomCreating: (creating: boolean) => void
  setRoomCreationError: (error: string) => void
  setLastCreatedRoom: (roomId: string) => void

  // Room management
  addRoom: (room: LobbyRoomInfoType) => void
  updateRoom: (room: LobbyRoomInfoType) => void
  removeRoom: (roomId: string) => void

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
  const [state, setState] = createStore<LobbyStateType>(createInitialLobbyState())

  // Pure state actions - no Effects, no service calls
  const actions: LobbyStoreActions = {
    setRoomsLoading: (loading: boolean) => {
      setState({ loading })
    },

    setRooms: (rooms: LobbyRoomInfoType[]) => {
      setState({ rooms })
    },

    setRoomCreating: (creating: boolean) => {
      setState({ creatingRoom: creating })
    },

    setRoomCreationError: (error: string) => {
      setState({ creationError: Option.some(error) })
    },

    setLastCreatedRoom: (roomId: string) => {
      setState({ lastCreatedRoomId: Option.some(roomId) })
    },

    addRoom: (room: LobbyRoomInfoType) => {
      setState({ rooms: [...state.rooms, room] })
    },

    updateRoom: (room: LobbyRoomInfoType) => {
      setState({ rooms: state.rooms.map(r => r.id === room.id ? room : r) })
    },

    removeRoom: (roomId: string) => {
      setState({ rooms: state.rooms.filter(r => r.id !== roomId) })
    },

    clearRooms: () => {
      setState({ rooms: [] })
    },

    clearError: () => {
      setState({ creationError: Option.none() })
    }
  }

  // Computed values - Using getter functions to avoid reactive computations outside render context
  const isLoading = () => state.loading
  const isCreating = () => state.creatingRoom
  const creationError = () => Option.getOrNull(state.creationError)
  const lastCreatedRoomId = () => Option.getOrNull(state.lastCreatedRoomId)
  const sortedRoomsByListenerCount = () => 
    state.rooms.slice().sort((a, b) => (b.listenerCount || 0) - (a.listenerCount || 0))

  return {
    // Reactive state (read-only)
    state: state as Readonly<LobbyStateType>,

    // Actions
    actions,

    // Computed values
    isLoading,
    isCreating,
    creationError,
    lastCreatedRoomId,
    sortedRoomsByListenerCount
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
