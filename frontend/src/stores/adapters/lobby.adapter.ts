/**
 * Lobby Store Adapter
 * 
 * Effect-TS Context.Tag pattern for lobby state management and WebSocket access.
 * Services use this tag for dependency injection, never importing the implementation directly.
 */

import { Context, Layer, Option as O } from 'effect'
import type { LobbyStore } from '../lobby.store'
import { getLobbyStore } from '../lobby.store'
import type { LobbyRoomInfoType } from '../../domain/schemas/lobby.schema'

/**
 * Lobby Adapter Interface
 * 
 * Service layer contract for lobby state management and WebSocket access.
 */
export interface LobbyAdapter {
  // Connection management
  setConnecting: (connecting: boolean) => void
  setConnected: (websocket: WebSocket) => void
  setDisconnected: () => void
  setConnectionError: (error: string) => void
  
  // WebSocket access
  getLobbyWebSocket: () => WebSocket | null
  
  // Room management
  setRooms: (rooms: LobbyRoomInfoType[]) => void
  addRoom: (room: LobbyRoomInfoType) => void
  updateRoom: (room: LobbyRoomInfoType) => void
  removeRoom: (roomId: string) => void
  
  // State access
  isConnected: () => boolean
  getConnectionError: () => string | null
  
  // Reset
  reset: () => void
}

/**
 * Lobby Adapter Context Tag
 * 
 * Services import and use this tag for dependency injection.
 * Uses the same name as the interface for clean imports.
 */
export class LobbyAdapter extends Context.Tag("@app/adapters/LobbyAdapter")<
  LobbyAdapter,
  LobbyAdapter
>() {}

/**
 * Lobby Adapter Implementation
 * 
 * Creates a LobbyAdapter implementation using the LobbyStore.
 * This is used by the Layer, never imported directly by services.
 */
const createLobbyAdapterImpl = (
  store?: LobbyStore
): LobbyAdapter => {
  const lobbyStore = store || getLobbyStore()

  return {
    // Connection management
    setConnecting: (connecting: boolean) => {
      lobbyStore.actions.setConnecting(connecting)
    },

    setConnected: (websocket: WebSocket) => {
      lobbyStore.actions.setConnected(websocket)
    },

    setDisconnected: () => {
      lobbyStore.actions.setDisconnected()
    },

    setConnectionError: (error: string) => {
      lobbyStore.actions.setConnectionError(error)
    },

    // WebSocket access
    getLobbyWebSocket: () => {
      return O.getOrNull(lobbyStore.state.connection.websocket)
    },

    // Room management
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

    // State access
    isConnected: () => {
      return lobbyStore.state.connection.status === 'connected'
    },

    getConnectionError: () => {
      return lobbyStore.connectionError()
    },

    // Reset
    reset: () => {
      lobbyStore.actions.reset()
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