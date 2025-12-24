/**
 * Lobby Store Adapter
 *
 * Effect-TS Context.Tag pattern for lobby state management and WebSocket access.
 * Services use this tag for dependency injection, never importing the implementation directly.
 */

import { Context, Layer } from 'effect'
import type { LobbyRoomInfoType } from '../../domain/schemas/lobby.schema'
import type { LobbyStore } from './lobby.store'
import { getLobbyStore } from './lobby.store'

/**
 * Lobby Adapter Interface
 *
 * Service layer contract for lobby state management and WebSocket access.
 */
interface LobbyAdapterImpl {
  // Room list management
  getRooms: () => LobbyRoomInfoType[]
  setRooms: (rooms: LobbyRoomInfoType[]) => void
  addRoom: (room: LobbyRoomInfoType) => void
  updateRoom: (room: LobbyRoomInfoType) => void
  removeRoom: (roomId: string) => void
  
  // State management
  setLoading: (loading: boolean) => void
  setCreating: (creating: boolean) => void
  setCreationError: (error: string | null) => void
  setLastCreatedRoomId: (roomId: string) => void
  
  // Getters
  isLoading: () => boolean
  isCreating: () => boolean
  getCreationError: () => string | null
  getLastCreatedRoomId: () => string | null
  getSortedRooms: () => LobbyRoomInfoType[]
  
  // Cleanup
  clearRooms: () => void
  clearError: () => void
}

/**
 * Lobby Adapter Context Tag
 *
 * Services import and use this tag for dependency injection.
 * Uses the same name as the interface for clean imports.
 */
export class LobbyAdapter extends Context.Tag("@app/adapters/LobbyAdapter")<
  LobbyAdapter,
  LobbyAdapterImpl
>() {}

/**
 * Lobby Adapter Implementation
 *
 * Creates a LobbyAdapter implementation using the LobbyStore.
 * This is used by the Layer, never imported directly by services.
 */
const createLobbyAdapterImpl = (
  store?: LobbyStore
): LobbyAdapterImpl => {
  const lobbyStore = store || getLobbyStore()

  return {
    // Room list management
    getRooms: () => [...lobbyStore.state.rooms],
    
    setRooms: (rooms: LobbyRoomInfoType[]) => {
      lobbyStore.actions.setRooms(rooms)
    },
    
    addRoom: (room: LobbyRoomInfoType) => {
      lobbyStore.actions.addRoom(room)
    },
    
    updateRoom: (room: LobbyRoomInfoType) => {
      lobbyStore.actions.updateRoom(room)
    },
    
    removeRoom: (roomId: string) => {
      lobbyStore.actions.removeRoom(roomId)
    },
    
    // State management
    setLoading: (loading: boolean) => {
      lobbyStore.actions.setRoomsLoading(loading)
    },
    
    setCreating: (creating: boolean) => {
      lobbyStore.actions.setRoomCreating(creating)
    },
    
    setCreationError: (error: string | null) => {
      if (error) {
        lobbyStore.actions.setRoomCreationError(error)
      } else {
        lobbyStore.actions.clearError()
      }
    },
    
    setLastCreatedRoomId: (roomId: string) => {
      lobbyStore.actions.setLastCreatedRoom(roomId)
    },
    
    // Getters
    isLoading: () => lobbyStore.isLoading(),
    isCreating: () => lobbyStore.isCreating(),
    getCreationError: () => lobbyStore.creationError(),
    getLastCreatedRoomId: () => lobbyStore.lastCreatedRoomId(),
    getSortedRooms: () => lobbyStore.sortedRoomsByListenerCount(),
    
    // Cleanup
    clearRooms: () => {
      lobbyStore.actions.clearRooms()
    },
    
    clearError: () => {
      lobbyStore.actions.clearError()
    }
  }
}

/**
 * Lobby Adapter Layer
 *
 * Live implementation layer that provides the LobbyAdapter using SolidJS stores.
 * Use this in your app's main Layer composition.
 */
export const LobbyAdapterLive = Layer.succeed(
  LobbyAdapter,
  createLobbyAdapterImpl()
)
