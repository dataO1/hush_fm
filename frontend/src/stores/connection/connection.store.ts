/**
 * Connection Store
 *
 * Pure connection state management without MediaSoup knowledge.
 * Manages room connection state, room ID, and connection type using SolidJS signals.
 *
 * This replaces the connection-related parts of the monolithic room store
 * and provides a clean, reactive interface for connection status.
 */

import { WebrtcConnectionState, WsConnectionState, ConnectionError } from '../../domain/schemas/connection.schema'
import { createMemo } from 'solid-js'
import { createStore } from 'solid-js/store'
import { Option } from "effect"


/**
 * Connection actions interface
 */
export interface ConnectionActions {
  // WebRTC state transitions (room only)
  setWebRTCState: (state: WebrtcConnectionState) => void
  initializeWebRTC: () => void
  cleanupWebRTC: () => void

  // WebSocket state transitions (dual)
  setLobbyWSState: (state: WsConnectionState) => void
  setRoomWSState: (state: WsConnectionState) => void

  // Error management
  setConnectionError: (error: ConnectionError | null) => void
  clearError: () => void

  // Reset
  reset: () => void
  resetLobby: () => void
  resetRoom: () => void
}

/**
 * Connection store interface
 */
export interface ConnectionStore {
  // Reactive state (read-only)
  readonly state: DualConnectionState

  // Actions
  readonly actions: ConnectionActions

  // Computed values (using createMemo for performance)
  readonly isLobbyConnected: () => boolean
  readonly isRoomConnected: () => boolean
  readonly isConnecting: () => boolean  // WebRTC connecting state
  readonly isConnected: () => boolean  // WebRTC connecting state
  readonly hasError: () => boolean
  readonly connectionError: () => Option.Option<ConnectionError>
}

/**
 * Connection state with dual WebSocket support
 */
export interface DualConnectionState {
  webrtcConnectionState: WebrtcConnectionState  // Single, for room only
  lobbyWsState: WsConnectionState              // Lobby WebSocket
  roomWsState: WsConnectionState               // Room WebSocket
  lastError: Option.Option<ConnectionError>
}

/**
 * Initial connection state
 */
const createInitialConnectionState = (): DualConnectionState => ({
  webrtcConnectionState: WebrtcConnectionState.DISCONNECTED,
  lobbyWsState: WsConnectionState.DISCONNECTED,
  roomWsState: WsConnectionState.DISCONNECTED,
  lastError: Option.none()
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
    setWebRTCState: (newState: WebrtcConnectionState) => {
      setState('webrtcConnectionState', newState)
    },

    initializeWebRTC: () => {
      setState('webrtcConnectionState', WebrtcConnectionState.CONNECTING)
      setState('lastError', Option.none())
    },

    cleanupWebRTC: () => {
      setState('webrtcConnectionState', WebrtcConnectionState.DISCONNECTED)
    },

    setLobbyWSState: (newState: WsConnectionState) => {
      setState('lobbyWsState', newState)
    },

    setRoomWSState: (newState: WsConnectionState) => {
      setState('roomWsState', newState)
    },

    setConnectionError: (error: ConnectionError | null) => {
      setState('lastError', error ? Option.some(error) : Option.none())
      if (error) {
        setState('webrtcConnectionState', WebrtcConnectionState.ERROR)
      }
    },

    clearError: () => {
      setState('lastError', Option.none())
      // If in error state, reset to disconnected
      if (state.webrtcConnectionState === WebrtcConnectionState.ERROR) {
        setState('webrtcConnectionState', WebrtcConnectionState.DISCONNECTED)
      }
    },

    reset: () => {
      setState(createInitialConnectionState())
    },

    resetLobby: () => {
      setState('lobbyWsState', WsConnectionState.DISCONNECTED)
    },

    resetRoom: () => {
      setState('roomWsState', WsConnectionState.DISCONNECTED)
      setState('webrtcConnectionState', WebrtcConnectionState.DISCONNECTED)
      setState('lastError', Option.none())
    }
  }

  // Computed values using createMemo for performance
  const isLobbyConnected = createMemo(() =>
    state.lobbyWsState === WsConnectionState.CONNECTED
  )

  const isRoomConnected = createMemo(() =>
    state.roomWsState === WsConnectionState.CONNECTED &&
    (state.webrtcConnectionState === WebrtcConnectionState.CONNECTED ||
     state.webrtcConnectionState === WebrtcConnectionState.STREAMING)
  )

  const isConnecting = createMemo(() =>
    state.webrtcConnectionState === WebrtcConnectionState.CONNECTING ||
    state.webrtcConnectionState === WebrtcConnectionState.DISCONNECTING
  )


  const isConnected = createMemo(() =>
    state.webrtcConnectionState === WebrtcConnectionState.CONNECTED
  )

  const hasError = createMemo(() =>
    state.webrtcConnectionState === WebrtcConnectionState.ERROR ||
    Option.isSome(state.lastError)
  )

  const connectionError = createMemo(() => state.lastError)

  return {
    // Reactive state (read-only access)
    state: state as Readonly<DualConnectionState>,

    // Actions
    actions,

    // Computed values (memoized for performance)
    isLobbyConnected,
    isRoomConnected,
    isConnecting,
    isConnected,
    hasError,
    connectionError
  }
}

/**
 * Connection store type export
 */
export type ConnectionStoreType = ReturnType<typeof createConnectionStore>

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
