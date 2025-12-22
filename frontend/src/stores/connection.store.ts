/**
 * Connection Store
 * 
 * Pure connection state management without MediaSoup knowledge.
 * Manages room connection state, room ID, and connection type using SolidJS signals.
 * 
 * This replaces the connection-related parts of the monolithic room store
 * and provides a clean, reactive interface for connection status.
 */

import { createSignal, createMemo } from 'solid-js'
import { createStore } from 'solid-js/store'
import { ConnectionState } from '../domain/schemas/room.schema'

/**
 * Connection state interface
 */
export interface ConnectionState_Internal {
  state: ConnectionState
  roomId: string | null
  connectionType: 'dj' | 'listener' | null
  lastConnectedAt: Date | null
  connectionAttempts: number
  lastError: string | null
}

/**
 * Connection actions interface
 */
export interface ConnectionActions {
  // State transitions
  setConnectionState: (state: ConnectionState) => void
  setRoomId: (roomId: string | null) => void
  setConnectionType: (type: 'dj' | 'listener' | null) => void
  setConnectionError: (error: string | null) => void
  
  // Connection management
  connect: (roomId: string, type: 'dj' | 'listener') => void
  disconnect: () => void
  incrementConnectionAttempts: () => void
  resetConnectionAttempts: () => void
  
  // Error management
  clearError: () => void
  
  // Reset
  reset: () => void
}

/**
 * Connection store interface
 */
export interface ConnectionStore {
  // Reactive state (read-only)
  readonly state: ConnectionState_Internal
  
  // Actions
  readonly actions: ConnectionActions
  
  // Computed values (using createMemo for performance)
  readonly isConnected: () => boolean
  readonly isConnecting: () => boolean
  readonly isDisconnected: () => boolean
  readonly hasError: () => boolean
  readonly connectionError: () => string | null
  readonly currentRoomId: () => string | null
  readonly connectionType: () => 'dj' | 'listener' | null
}

/**
 * Initial connection state
 */
const createInitialConnectionState = (): ConnectionState_Internal => ({
  state: ConnectionState.DISCONNECTED,
  roomId: null,
  connectionType: null,
  lastConnectedAt: null,
  connectionAttempts: 0,
  lastError: null
})

/**
 * Create Connection Store
 * 
 * Creates a new connection store with SolidJS signals and computed values.
 * Uses fine-grained reactivity for optimal performance.
 */
export const createConnectionStore = (): ConnectionStore => {
  // Main reactive state using SolidJS store
  const [state, setState] = createStore(createInitialConnectionState())
  
  // Actions implementation
  const actions: ConnectionActions = {
    setConnectionState: (newState: ConnectionState) => {
      setState('state', newState)
      
      // Update lastConnectedAt when transitioning to connected states
      if (newState === ConnectionState.CONNECTED || newState === ConnectionState.STREAMING) {
        setState('lastConnectedAt', new Date())
      }
    },

    setRoomId: (roomId: string | null) => {
      setState('roomId', roomId)
    },

    setConnectionType: (type: 'dj' | 'listener' | null) => {
      setState('connectionType', type)
    },

    setConnectionError: (error: string | null) => {
      setState('lastError', error)
      
      // Set error state if error provided
      if (error) {
        setState('state', ConnectionState.ERROR)
      }
    },

    connect: (roomId: string, type: 'dj' | 'listener') => {
      setState({
        roomId,
        connectionType: type,
        state: ConnectionState.CONNECTING,
        lastError: null
      })
    },

    disconnect: () => {
      setState({
        state: ConnectionState.DISCONNECTED,
        roomId: null,
        connectionType: null,
        lastError: null
      })
    },

    incrementConnectionAttempts: () => {
      setState('connectionAttempts', (count) => count + 1)
    },

    resetConnectionAttempts: () => {
      setState('connectionAttempts', 0)
    },

    clearError: () => {
      setState('lastError', null)
      
      // If in error state and no other issues, go to disconnected
      if (state.state === ConnectionState.ERROR) {
        setState('state', ConnectionState.DISCONNECTED)
      }
    },

    reset: () => {
      setState(createInitialConnectionState())
    }
  }

  // Computed values using createMemo for performance
  const isConnected = createMemo(() => 
    state.state === ConnectionState.CONNECTED || 
    state.state === ConnectionState.STREAMING ||
    state.state === ConnectionState.PAUSED
  )

  const isConnecting = createMemo(() => 
    state.state === ConnectionState.CONNECTING ||
    state.state === ConnectionState.DISCONNECTING
  )

  const isDisconnected = createMemo(() => 
    state.state === ConnectionState.DISCONNECTED ||
    state.state === ConnectionState.IDLE
  )

  const hasError = createMemo(() => 
    state.state === ConnectionState.ERROR || !!state.lastError
  )

  const connectionError = createMemo(() => state.lastError)

  const currentRoomId = createMemo(() => state.roomId)

  const connectionType = createMemo(() => state.connectionType)

  return {
    // Reactive state (read-only access)
    state: state as Readonly<ConnectionState_Internal>,
    
    // Actions
    actions,
    
    // Computed values (memoized for performance)
    isConnected,
    isConnecting,
    isDisconnected,
    hasError,
    connectionError,
    currentRoomId,
    connectionType
  }
}

/**
 * Connection store type export
 */
export type ConnectionStore = ReturnType<typeof createConnectionStore>

/**
 * Singleton connection store instance
 * 
 * Global instance for application-wide connection state management.
 * Components access this through Context providers.
 */
let connectionStoreInstance: ConnectionStore | null = null

/**
 * Get or create the singleton connection store instance
 */
export const getConnectionStore = (): ConnectionStore => {
  if (!connectionStoreInstance) {
    connectionStoreInstance = createConnectionStore()
  }
  return connectionStoreInstance
}

/**
 * Reset the global connection store (useful for testing)
 */
export const resetGlobalConnectionStore = (): void => {
  connectionStoreInstance = null
}