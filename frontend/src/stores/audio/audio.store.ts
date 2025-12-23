/**
 * Audio Store
 * 
 * Reactive store for audio state management.
 * Manages StreamState and MediaTrackConstraints.
 */

import { createMemo } from 'solid-js'
import { createStore } from 'solid-js/store'
import { Option } from 'effect'
import type { StreamStateType, WebAPITypes } from '@/domain/schemas/audio.schema'

/**
 * Audio Store State
 */
export interface AudioState {
  streamState: StreamStateType
  mediaTrackConstraints: Option.Option<WebAPITypes.MediaTrackConstraints>
  availableDevices: ReadonlyArray<WebAPITypes.MediaDeviceInfo>
}

/**
 * Audio Store Actions
 */
export interface AudioActions {
  // Stream state management
  setStreamState: (state: StreamStateType) => void
  updateStreamState: (updates: Partial<StreamStateType>) => void
  
  // Permission management
  setPermission: (permission: WebAPITypes.PermissionState) => void
  
  // Device management
  setAvailableDevices: (devices: ReadonlyArray<WebAPITypes.MediaDeviceInfo>) => void
  
  // Constraints management
  setMediaTrackConstraints: (constraints: WebAPITypes.MediaTrackConstraints) => void
  clearMediaTrackConstraints: () => void
  
  // Reset
  reset: () => void
}

/**
 * Initial audio state
 */
const createInitialAudioState = (): AudioState => ({
  streamState: {
    playing: false,
    deviceId: Option.none(),
    constraints: Option.none(),
    acquiredAt: Option.none(),
    error: Option.none(),
    requiresUserGesture: false,
    permission: Option.none()
  },
  mediaTrackConstraints: Option.none(),
  availableDevices: []
})

/**
 * Create audio store
 */
export const createAudioStore = () => {
  // Single source of truth - all state in store
  const [state, setState] = createStore(createInitialAudioState())

  // Pure state actions - no Effects, no service calls
  const actions: AudioActions = {
    setStreamState: (streamState: StreamStateType) => {
      setState('streamState', streamState)
    },

    updateStreamState: (updates: Partial<StreamStateType>) => {
      setState('streamState', (prev) => ({ ...prev, ...updates }))
    },

    setPermission: (permission: WebAPITypes.PermissionState) => {
      setState('streamState', 'permission', Option.some(permission))
    },

    setAvailableDevices: (devices: ReadonlyArray<WebAPITypes.MediaDeviceInfo>) => {
      setState('availableDevices', devices)
    },

    setMediaTrackConstraints: (constraints: WebAPITypes.MediaTrackConstraints) => {
      setState('mediaTrackConstraints', Option.some(constraints))
    },

    clearMediaTrackConstraints: () => {
      setState('mediaTrackConstraints', Option.none())
    },

    reset: () => {
      setState(createInitialAudioState())
    }
  }

  // Computed values
  const isPlaying = createMemo(() => state.streamState.playing)
  const requiresUserGesture = createMemo(() => state.streamState.requiresUserGesture)
  const currentDeviceId = createMemo(() => Option.getOrNull(state.streamState.deviceId))
  const hasError = createMemo(() => Option.isSome(state.streamState.error))
  const errorMessage = createMemo(() => Option.getOrNull(state.streamState.error))
  const permission = createMemo(() => Option.getOrNull(state.streamState.permission))

  return {
    // Reactive state (read-only)
    state: state as Readonly<AudioState>,

    // Actions
    actions,

    // Computed values
    isPlaying,
    requiresUserGesture,
    currentDeviceId,
    hasError,
    errorMessage,
    permission
  }
}

/**
 * Audio store type
 */
export type AudioStore = ReturnType<typeof createAudioStore>

/**
 * Singleton audio store instance
 */
let audioStoreInstance: AudioStore | null = null

/**
 * Get or create the singleton audio store instance
 */
export const getAudioStore = (): AudioStore => {
  if (!audioStoreInstance) {
    audioStoreInstance = createAudioStore()
  }
  return audioStoreInstance
}

/**
 * Reset the global audio store (useful for testing)
 */
export const resetGlobalAudioStore = (): void => {
  if (audioStoreInstance) {
    audioStoreInstance.actions.reset()
  }
  audioStoreInstance = null
}
