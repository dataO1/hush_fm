/**
 * Connection Store Adapter
 *
 * Effect-TS Context.Tag pattern for connection state management.
 * Services use this tag for dependency injection, never importing the implementation directly.
 */

import { Context, Layer } from 'effect'
import type { ConnectionStore } from './connection.store'
import { getConnectionStore } from './connection.store'
import { WebrtcConnectionState, WsConnectionState, ConnectionError } from '../../domain/schemas/connection.schema'


/**
 * Connection Adapter Context Tag
 *
 * Uses modern 2025 Effect-TS class-based Tag syntax.
 * Acts as both type and value for clean dependency injection.
 */
export class ConnectionAdapter extends Context.Tag("@app/adapters/ConnectionAdapter")<
  ConnectionAdapter,
  {
    // WebRTC (room only)
    setWebRTCState: (state: WebrtcConnectionState) => void
    
    // WebSocket (dual)
    setLobbyWSState: (state: WsConnectionState) => void
    setRoomWSState: (state: WsConnectionState) => void
    
    // Connection status
    isLobbyConnected: () => boolean
    isRoomConnected: () => boolean
    isConnecting: () => boolean  // WebRTC connecting state
    
    // Error management
    hasError: () => boolean
    setConnectionError: (error: ConnectionError | null) => void
    clearError: () => void
  }
>() {}

/**
 * Connection Adapter Implementation
 *
 * Creates a ConnectionAdapter implementation using the ConnectionStore.
 * This is used by the Layer, never imported directly by services.
 */
const createConnectionAdapterImpl = () => {
  // Initialize the connection store here
  const connectionStore = getConnectionStore()

  return {
    // WebRTC state management (room only)
    setWebRTCState: (state: WebrtcConnectionState) => {
      connectionStore.actions.setWebRTCState(state)
    },

    // WebSocket state management (dual)
    setLobbyWSState: (state: WsConnectionState) => {
      connectionStore.actions.setLobbyWSState(state)
    },

    setRoomWSState: (state: WsConnectionState) => {
      connectionStore.actions.setRoomWSState(state)
    },

    // Connection status
    isLobbyConnected: () => {
      return connectionStore.isLobbyConnected()
    },

    isRoomConnected: () => {
      return connectionStore.isRoomConnected()
    },

    isConnecting: () => {
      return connectionStore.isConnecting()
    },

    // Error management
    hasError: () => {
      return connectionStore.hasError()
    },

    setConnectionError: (error: ConnectionError | null) => {
      connectionStore.actions.setConnectionError(error)
    },

    clearError: () => {
      connectionStore.actions.clearError()
    }
  }
}

/**
 * Connection Adapter Layer
 *
 * Live implementation layer that provides the ConnectionAdapter using SolidJS stores.
 * Use this in your app's main Layer composition.
 */
export const ConnectionAdapterLive = Layer.succeed(
  ConnectionAdapter,
  createConnectionAdapterImpl()
)
