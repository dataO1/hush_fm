/**
 * Audio Store
 *
 * Reactive store for audio state management.
 * Manages StreamState and MediaTrackConstraints.
 */

// Removed createMemo import - using getter functions instead
import { createStore } from 'solid-js/store'
import { Option } from 'effect'
import { StreamStateType } from '@/domain'

/**
 * Audio Store State
 */
export interface AudioState {
  streamState: StreamStateType
  mediaTrackConstraints: Option.Option<MediaTrackConstraints>
  availableDevices: ReadonlyArray<MediaDeviceInfo>
}

/**
 * Audio Store Actions
 */
export interface AudioActions {
  // Stream state management
  setStreamState: (state: StreamStateType) => void
  updateStreamState: (updates: Partial<StreamStateType>) => void

  // Permission management
  setPermission: (permission: PermissionState) => void

  // Device management
  setAvailableDevices: (devices: ReadonlyArray<MediaDeviceInfo>) => void

  // Constraints management
  setMediaTrackConstraints: (constraints: MediaTrackConstraints) => void
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

    setPermission: (permission: PermissionState) => {
      setState('streamState', { permission: Option.some(permission) })
    },

    setAvailableDevices: (devices: ReadonlyArray<MediaDeviceInfo>) => {
      setState('availableDevices', devices)
    },

    setMediaTrackConstraints: (constraints: MediaTrackConstraints) => {
      setState('mediaTrackConstraints', Option.some(constraints))
    },

    clearMediaTrackConstraints: () => {
      setState('mediaTrackConstraints', Option.none())
    },

    reset: () => {
      setState(createInitialAudioState())
    }
  }

  // Computed values - Using getter functions to avoid reactive computations outside render context
  const isPlaying = () => state.streamState.playing
  const requiresUserGesture = () => state.streamState.requiresUserGesture
  const currentDeviceId = () => Option.getOrNull(state.streamState.deviceId)
  const hasError = () => Option.isSome(state.streamState.error)
  const errorMessage = () => Option.getOrNull(state.streamState.error)
  const permission = () => Option.getOrNull(state.streamState.permission)

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
