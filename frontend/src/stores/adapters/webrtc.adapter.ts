/**
 * WebRTC Store Adapter
 * 
 * Effect-TS Context.Tag pattern for WebRTC status management.
 * Services use this tag for dependency injection, never importing the implementation directly.
 */

import { Context, Layer } from 'effect'
import type { WebRTCStore } from '../webrtc.store'
import { getWebRTCStore } from '../webrtc.store'
import type { WebRTCConnectionState, WebRTCError } from '../../domain/schemas/room.schema'

/**
 * WebRTC Adapter Interface
 * 
 * Service layer contract for WebRTC status management.
 */
export interface WebRTCAdapter {
  // Status management
  setStatus: (status: WebRTCConnectionState, error?: WebRTCError) => void
  clearStatus: () => void
  
  // Error management
  setError: (error: WebRTCError) => void
  clearError: () => void
  
  // Timeout management
  setActiveTimeout: (timeoutId: number, key?: string) => void
  clearActiveTimeout: (key?: string) => void
  clearAllTimeouts: () => void
  
  // State access
  getStatus: () => WebRTCConnectionState
  isConnected: () => boolean
  isConnecting: () => boolean
  isFailed: () => boolean
  hasError: () => boolean
  getCurrentError: () => WebRTCError | null
  
  // Reset
  reset: () => void
}

/**
 * WebRTC Adapter Context Tag
 * 
 * Services import and use this tag for dependency injection.
 * Uses the same name as the interface for clean imports.
 */
export class WebRTCAdapter extends Context.Tag("@app/adapters/WebRTCAdapter")<
  WebRTCAdapter,
  WebRTCAdapter
>() {}

/**
 * WebRTC Adapter Implementation
 * 
 * Creates a WebRTCAdapter implementation using the WebRTCStore.
 * This is used by the Layer, never imported directly by services.
 */
const createWebRTCAdapterImpl = (
  store?: WebRTCStore
): WebRTCAdapter => {
  const webrtcStore = store || getWebRTCStore()

  return {
    // Status management
    setStatus: (status: WebRTCConnectionState, error?: WebRTCError) => {
      webrtcStore.actions.setStatus(status, error)
    },

    clearStatus: () => {
      webrtcStore.actions.clearStatus()
    },

    // Error management
    setError: (error: WebRTCError) => {
      webrtcStore.actions.setError(error)
    },

    clearError: () => {
      webrtcStore.actions.clearError()
    },

    // Timeout management
    setActiveTimeout: (timeoutId: number, key: string = 'default') => {
      webrtcStore.actions.setActiveTimeout(timeoutId, key)
    },

    clearActiveTimeout: (key: string = 'default') => {
      webrtcStore.actions.clearActiveTimeout(key)
    },

    clearAllTimeouts: () => {
      webrtcStore.actions.clearAllTimeouts()
    },

    // State access
    getStatus: () => {
      return webrtcStore.state.status
    },

    isConnected: () => {
      return webrtcStore.isConnected()
    },

    isConnecting: () => {
      return webrtcStore.isConnecting()
    },

    isFailed: () => {
      return webrtcStore.isFailed()
    },

    hasError: () => {
      return webrtcStore.hasError()
    },

    getCurrentError: () => {
      return webrtcStore.currentError()
    },

    // Reset
    reset: () => {
      webrtcStore.actions.reset()
    }
  }
}

/**
 * WebRTC Adapter Layer
 * 
 * Live implementation layer that provides the WebRTCAdapter using SolidJS stores.
 * Use this in your app's main Layer composition.
 */
export const WebRTCAdapterLive = Layer.succeed(
  WebRTCAdapter,
  createWebRTCAdapterImpl()
)