/**
 * Connection Store Adapter
 * 
 * Effect-TS Context.Tag pattern for connection state management.
 * Services use this tag for dependency injection, never importing the implementation directly.
 */

import { Context, Layer } from 'effect'
import type { ConnectionStore } from '../connection.store'
import { getConnectionStore } from '../connection.store'
import type { ConnectionState } from '../../domain/schemas/room.schema'

/**
 * Connection Adapter Interface
 * 
 * Service layer contract for connection management.
 */
export interface ConnectionAdapter {
  setConnectionState: (state: ConnectionState) => void
  setRoomId: (roomId: string | null) => void
  setConnectionType: (type: 'dj' | 'listener' | null) => void
  setConnectionError: (error: string | null) => void
  connect: (roomId: string, type: 'dj' | 'listener') => void
  disconnect: () => void
  incrementConnectionAttempts: () => void
  resetConnectionAttempts: () => void
  getCurrentState: () => ConnectionState
  getCurrentRoomId: () => string | null
  getConnectionType: () => 'dj' | 'listener' | null
  isConnected: () => boolean
  isConnecting: () => boolean
  clearError: () => void
  reset: () => void
}

/**
 * Connection Adapter Context Tag
 * 
 * Uses modern 2025 Effect-TS class-based Tag syntax.
 * Acts as both type and value for clean dependency injection.
 */
export class ConnectionAdapter extends Context.Tag("@app/adapters/ConnectionAdapter")<
  ConnectionAdapter,
  ConnectionAdapter
>() {}

/**
 * Connection Adapter Implementation
 * 
 * Creates a ConnectionAdapter implementation using the ConnectionStore.
 * This is used by the Layer, never imported directly by services.
 */
const createConnectionAdapterImpl = (
  store?: ConnectionStore
): ConnectionAdapter => {
  const connectionStore = store || getConnectionStore()

  return {
    // State transitions
    setConnectionState: (state: ConnectionState) => {
      connectionStore.actions.setConnectionState(state)
    },

    setRoomId: (roomId: string | null) => {
      connectionStore.actions.setRoomId(roomId)
    },

    setConnectionType: (type: 'dj' | 'listener' | null) => {
      connectionStore.actions.setConnectionType(type)
    },

    setConnectionError: (error: string | null) => {
      connectionStore.actions.setConnectionError(error)
    },

    // Connection management
    connect: (roomId: string, type: 'dj' | 'listener') => {
      connectionStore.actions.connect(roomId, type)
    },

    disconnect: () => {
      connectionStore.actions.disconnect()
    },

    incrementConnectionAttempts: () => {
      connectionStore.actions.incrementConnectionAttempts()
    },

    resetConnectionAttempts: () => {
      connectionStore.actions.resetConnectionAttempts()
    },

    // State access
    getCurrentState: () => {
      return connectionStore.state.state
    },

    getCurrentRoomId: () => {
      return connectionStore.currentRoomId()
    },

    getConnectionType: () => {
      return connectionStore.connectionType()
    },

    isConnected: () => {
      return connectionStore.isConnected()
    },

    isConnecting: () => {
      return connectionStore.isConnecting()
    },

    // Error management
    clearError: () => {
      connectionStore.actions.clearError()
    },

    // Reset
    reset: () => {
      connectionStore.actions.reset()
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