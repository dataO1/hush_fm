/**
 * WebRTC Store
 * 
 * Pure WebRTC transport state management without domain knowledge.
 * Manages WebRTC connection status, errors, and timeout tracking using SolidJS signals.
 * 
 * This replaces the WebRTC-related parts of the monolithic room store
 * and provides clean separation between transport layer and business logic.
 */

import { createMemo } from 'solid-js'
import { createStore } from 'solid-js/store'
import { Option } from 'effect'
import { WebRTCConnectionState, type WebRTCError } from '../domain/schemas/room.schema'

/**
 * WebRTC state interface
 */
export interface WebRTCState {
  status: WebRTCConnectionState
  lastConnectedAt: Date | null
  error: WebRTCError | null
  activeTimeouts: Record<string, number>
}

/**
 * WebRTC actions interface
 */
export interface WebRTCActions {
  // Status management
  setStatus: (status: WebRTCConnectionState, error?: WebRTCError) => void
  clearStatus: () => void
  
  // Error management
  setError: (error: WebRTCError) => void
  clearError: () => void
  
  // Timeout management (for preventing duplicate timeouts)
  setActiveTimeout: (timeoutId: number, key?: string) => void
  clearActiveTimeout: (key?: string) => void
  clearAllTimeouts: () => void
  
  // Reset
  reset: () => void
}

/**
 * WebRTC store interface
 */
export interface WebRTCStoreInterface {
  // Reactive state (read-only)
  readonly state: WebRTCState
  
  // Actions
  readonly actions: WebRTCActions
  
  // Computed values (using createMemo for performance)
  readonly isConnected: () => boolean
  readonly isConnecting: () => boolean
  readonly isFailed: () => boolean
  readonly hasError: () => boolean
  readonly currentError: () => WebRTCError | null
  readonly hasActiveTimeouts: () => boolean
  readonly activeTimeoutIds: () => number[]
}

/**
 * Initial WebRTC state
 */
const createInitialWebRTCState = (): WebRTCState => ({
  status: WebRTCConnectionState.DISCONNECTED,
  lastConnectedAt: null,
  error: null,
  activeTimeouts: {}
})

/**
 * Create WebRTC Store
 * 
 * Creates a new WebRTC store with SolidJS signals and computed values.
 * Uses fine-grained reactivity for optimal performance.
 */
export const createWebRTCStore = (): WebRTCStore => {
  // Main reactive state using SolidJS store
  const [state, setState] = createStore(createInitialWebRTCState())
  
  // Actions implementation
  const actions: WebRTCActions = {
    setStatus: (status: WebRTCConnectionState, error?: WebRTCError) => {
      setState('status', status)
      
      // Update lastConnectedAt when connecting successfully
      if (status === WebRTCConnectionState.CONNECTED) {
        setState('lastConnectedAt', new Date())
      }
      
      // Set error if provided, or clear error if successful
      if (error) {
        setState('error', error)
      } else if (status === WebRTCConnectionState.CONNECTED) {
        setState('error', null)
      }
    },

    clearStatus: () => {
      setState({
        status: WebRTCConnectionState.DISCONNECTED,
        error: null
      })
    },

    setError: (error: WebRTCError) => {
      setState({
        error,
        status: WebRTCConnectionState.FAILED
      })
    },

    clearError: () => {
      setState('error', null)
      
      // If status was failed and we're clearing error, go to disconnected
      if (state.status === WebRTCConnectionState.FAILED) {
        setState('status', WebRTCConnectionState.DISCONNECTED)
      }
    },

    setActiveTimeout: (timeoutId: number, key: string = 'default') => {
      setState('activeTimeouts', key, timeoutId)
    },

    clearActiveTimeout: (key: string = 'default') => {
      if (state.activeTimeouts[key]) {
        // Clear the actual timeout
        clearTimeout(state.activeTimeouts[key])
        
        // Remove from state
        setState('activeTimeouts', (timeouts) => {
          const newTimeouts = { ...timeouts }
          delete newTimeouts[key]
          return newTimeouts
        })
      }
    },

    clearAllTimeouts: () => {
      // Clear all active timeouts
      Object.values(state.activeTimeouts).forEach(timeoutId => {
        clearTimeout(timeoutId)
      })
      
      // Reset timeouts state
      setState('activeTimeouts', {})
    },

    reset: () => {
      // Clear all timeouts first
      actions.clearAllTimeouts()
      
      // Reset state
      setState(createInitialWebRTCState())
    }
  }

  // Computed values using createMemo for performance
  const isConnected = createMemo(() => 
    state.status === WebRTCConnectionState.CONNECTED
  )

  const isConnecting = createMemo(() => 
    state.status === WebRTCConnectionState.CONNECTING
  )

  const isFailed = createMemo(() => 
    state.status === WebRTCConnectionState.FAILED
  )

  const hasError = createMemo(() => 
    !!state.error || state.status === WebRTCConnectionState.FAILED
  )

  const currentError = createMemo(() => state.error)

  const hasActiveTimeouts = createMemo(() => 
    Object.keys(state.activeTimeouts).length > 0
  )

  const activeTimeoutIds = createMemo(() => 
    Object.values(state.activeTimeouts)
  )

  return {
    // Reactive state (read-only access)
    state: state as Readonly<WebRTCState>,
    
    // Actions
    actions,
    
    // Computed values (memoized for performance)
    isConnected,
    isConnecting,
    isFailed,
    hasError,
    currentError,
    hasActiveTimeouts,
    activeTimeoutIds
  }
}

/**
 * WebRTC store type export
 */
export type WebRTCStore = ReturnType<typeof createWebRTCStore>

/**
 * Singleton WebRTC store instance
 * 
 * Global instance for application-wide WebRTC state management.
 * Components access this through Context providers.
 */
let webrtcStoreInstance: WebRTCStore | null = null

/**
 * Get or create the singleton WebRTC store instance
 */
export const getWebRTCStore = (): WebRTCStore => {
  if (!webrtcStoreInstance) {
    webrtcStoreInstance = createWebRTCStore()
  }
  return webrtcStoreInstance
}

/**
 * Reset the global WebRTC store (useful for testing)
 */
export const resetGlobalWebRTCStore = (): void => {
  // Clear timeouts before resetting
  if (webrtcStoreInstance) {
    webrtcStoreInstance.actions.clearAllTimeouts()
  }
  webrtcStoreInstance = null
}

/**
 * WebRTC Error Helper Functions
 * 
 * Utility functions for creating standardized WebRTC errors.
 */
export const WebRTCErrorHelpers = {
  /**
   * Create transport connection error
   */
  createTransportError: (message: string, originalError?: unknown): WebRTCError => ({
    type: 'transport_connection',
    message,
    originalError: originalError ? Option.some(originalError) : Option.none()
  }),

  /**
   * Create producer creation error
   */
  createProducerError: (message: string, originalError?: unknown): WebRTCError => ({
    type: 'producer_creation',
    message,
    originalError: originalError ? Option.some(originalError) : Option.none()
  }),

  /**
   * Create device initialization error
   */
  createDeviceError: (message: string, originalError?: unknown): WebRTCError => ({
    type: 'device_initialization',
    message,
    originalError: originalError ? Option.some(originalError) : Option.none()
  }),

  /**
   * Create unknown WebRTC error
   */
  createUnknownError: (message: string, originalError?: unknown): WebRTCError => ({
    type: 'unknown',
    message,
    originalError: originalError ? Option.some(originalError) : Option.none()
  })
}