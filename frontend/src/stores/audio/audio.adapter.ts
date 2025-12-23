/**
 * Audio Store Adapter
 *
 * Effect-TS Context.Tag pattern for audio state management.
 * Services use this tag for dependency injection, never importing the implementation directly.
 */

import { Context, Layer, Option } from 'effect'
import type { StreamStateType, WebAPITypes } from '../../domain/schemas/audio.schema'
import type { AudioStore } from './audio.store'
import { getAudioStore } from './audio.store'

/**
 * Audio Adapter Interface
 *
 * Service layer contract for audio state management.
 */
interface AudioAdapterImpl {
  // Stream state management
  setStreamState: (state: StreamStateType) => void
  updateStreamState: (updates: Partial<StreamStateType>) => void
  getStreamState: () => StreamStateType
  
  // Permission management
  setPermission: (permission: WebAPITypes.PermissionState) => void
  getPermission: () => Option.Option<WebAPITypes.PermissionState>
  
  // Device management
  setAvailableDevices: (devices: ReadonlyArray<WebAPITypes.MediaDeviceInfo>) => void
  getAvailableDevices: () => ReadonlyArray<WebAPITypes.MediaDeviceInfo>
  getCurrentDeviceId: () => string | null
  
  // Constraints management
  setMediaTrackConstraints: (constraints: WebAPITypes.MediaTrackConstraints) => void
  getMediaTrackConstraints: () => Option.Option<WebAPITypes.MediaTrackConstraints>
  clearMediaTrackConstraints: () => void
  
  // State checks
  isPlaying: () => boolean
  requiresUserGesture: () => boolean
  hasError: () => boolean
  getError: () => string | null
  
  // Cleanup
  reset: () => void
}

/**
 * Audio Adapter Context Tag
 *
 * Services import and use this tag for dependency injection.
 * Uses the same name as the interface for clean imports.
 */
export class AudioAdapter extends Context.Tag("@app/adapters/AudioAdapter")<
  AudioAdapter,
  AudioAdapterImpl
>() {}

/**
 * Audio Adapter Implementation
 *
 * Creates an AudioAdapter implementation using the AudioStore.
 * This is used by the Layer, never imported directly by services.
 */
const createAudioAdapterImpl = (
  store?: AudioStore
): AudioAdapterImpl => {
  const audioStore = store || getAudioStore()

  return {
    // Stream state management
    setStreamState: (state: StreamStateType) => {
      audioStore.actions.setStreamState(state)
    },

    updateStreamState: (updates: Partial<StreamStateType>) => {
      audioStore.actions.updateStreamState(updates)
    },

    getStreamState: () => audioStore.state.streamState,

    // Permission management
    setPermission: (permission: WebAPITypes.PermissionState) => {
      audioStore.actions.setPermission(permission)
    },

    getPermission: () => audioStore.state.streamState.permission,

    // Device management
    setAvailableDevices: (devices: ReadonlyArray<WebAPITypes.MediaDeviceInfo>) => {
      audioStore.actions.setAvailableDevices(devices)
    },

    getAvailableDevices: () => audioStore.state.availableDevices,

    getCurrentDeviceId: () => audioStore.currentDeviceId(),

    // Constraints management
    setMediaTrackConstraints: (constraints: WebAPITypes.MediaTrackConstraints) => {
      audioStore.actions.setMediaTrackConstraints(constraints)
    },

    getMediaTrackConstraints: () => audioStore.state.mediaTrackConstraints,

    clearMediaTrackConstraints: () => {
      audioStore.actions.clearMediaTrackConstraints()
    },

    // State checks
    isPlaying: () => audioStore.isPlaying(),
    requiresUserGesture: () => audioStore.requiresUserGesture(),
    hasError: () => audioStore.hasError(),
    getError: () => audioStore.errorMessage(),

    // Cleanup
    reset: () => {
      audioStore.actions.reset()
    }
  }
}

/**
 * Audio Adapter Layer
 *
 * Live implementation layer that provides the AudioAdapter using SolidJS stores.
 * Use this in your app's main Layer composition.
 */
export const AudioAdapterLive = Layer.succeed(
  AudioAdapter,
  createAudioAdapterImpl()
)