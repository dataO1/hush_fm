/**
 * Audio Infrastructure Client Implementation
 * 
 * Concrete implementation of the AudioClient interface.
 * Uses AudioAdapter for state management and tracks permissions.
 */

import { Effect, Layer, Option } from 'effect'
import { AudioClient, type AudioClient as AudioClientInterface } from './interface'
import { AudioAdapter } from '../../../stores'
import { 
  AudioDeviceError,
  AudioTrackError,
  AudioPlaybackError,
  type WebAPITypes 
} from '../../../domain/schemas/audio.schema'

/**
 * Create Audio Client Implementation
 */
const createAudioClientImpl = (): AudioClientInterface => {
  // Internal MediaStream reference
  let currentStream: Option.Option<MediaStream> = Option.none()
  
  // Internal audio element for playback (listener mode)
  let audioElement: Option.Option<HTMLAudioElement> = Option.none()

  return {
    getAudioDevices: () =>
      Effect.gen(function* () {
        const audioAdapter = yield* AudioAdapter
        
        // Check and update permissions
        try {
          const permission = await navigator.permissions.query({ name: 'microphone' as PermissionName })
          audioAdapter.setPermission(permission.state as WebAPITypes.PermissionState)
        } catch {
          // Permissions API not supported, continue without it
        }
        
        const devices = yield* Effect.tryPromise({
          try: async () => {
            const devices = await navigator.mediaDevices.enumerateDevices()
            const audioInputs = devices.filter(device => device.kind === 'audioinput')
            audioAdapter.setAvailableDevices(audioInputs)
            return audioInputs
          },
          catch: (error) => new AudioDeviceError({
            cause: String(error),
            operation: 'enumerate',
            timestamp: new Date()
          })
        })
        
        return devices
      }),

    selectDevice: (deviceId: string) =>
      Effect.gen(function* () {
        const audioAdapter = yield* AudioAdapter
        
        // Stop any existing stream
        yield* stopCurrentStream()
        
        // Check and update permissions before getUserMedia
        try {
          const permission = await navigator.permissions.query({ name: 'microphone' as PermissionName })
          audioAdapter.setPermission(permission.state as WebAPITypes.PermissionState)
        } catch {
          // Permissions API not supported
        }
        
        // Check stored constraints from adapter
        const storedConstraints = audioAdapter.getMediaTrackConstraints()
        
        // Build constraints, preferring stored ones
        const constraints: MediaStreamConstraints = {
          audio: Option.isSome(storedConstraints) 
            ? storedConstraints.value 
            : {
                deviceId: { exact: deviceId },
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
              },
          video: false
        }
        
        const newStream = yield* Effect.tryPromise({
          try: async () => {
            const stream = await navigator.mediaDevices.getUserMedia(constraints)
            
            // Update internal reference
            currentStream = Option.some(stream)
            
            // Update state in adapter
            audioAdapter.setStreamState({
              playing: true,
              deviceId: Option.some(deviceId),
              constraints: Option.some(constraints.audio as any),
              acquiredAt: Option.some(new Date()),
              error: Option.none(),
              requiresUserGesture: false
            })
            
            return stream
          },
          catch: (error) => new AudioTrackError({
            cause: String(error),
            operation: 'getUserMedia',
            timestamp: new Date()
          })
        })
        
        return newStream
      }),

    connectRemoteStream: (remoteStream: MediaStream) =>
      Effect.gen(function* () {
        const audioAdapter = yield* AudioAdapter
        
        // Stop any existing stream
        yield* stopCurrentStream()
        
        // Create audio element for playback if not exists
        if (Option.isNone(audioElement)) {
          const elem = new Audio()
          elem.autoplay = true
          audioElement = Option.some(elem)
        }
        
        const elem = Option.getOrThrow(audioElement)
        elem.srcObject = remoteStream
        
        // Try to play
        const playResult = yield* Effect.tryPromise({
          try: async () => {
            await elem.play()
            
            // Update internal reference
            currentStream = Option.some(remoteStream)
            
            // Update state in adapter - successful playback
            audioAdapter.setStreamState({
              playing: true,
              deviceId: Option.none(),
              constraints: Option.none(),
              acquiredAt: Option.some(new Date()),
              error: Option.none(),
              requiresUserGesture: false
            })
          },
          catch: (error) => {
            // Check if it's an autoplay block
            const errorStr = String(error)
            const isAutoplayBlocked = errorStr.includes('play()') || 
                                     errorStr.includes('user gesture') ||
                                     errorStr.includes('Autoplay')
            
            // Update internal reference even on error
            currentStream = Option.some(remoteStream)
            
            // Update state in adapter - requires user gesture
            audioAdapter.setStreamState({
              playing: false,
              deviceId: Option.none(),
              constraints: Option.none(),
              acquiredAt: Option.some(new Date()),
              error: Option.some(errorStr),
              requiresUserGesture: isAutoplayBlocked
            })
            
            // Don't throw if it's just autoplay block - that's expected
            if (isAutoplayBlocked) {
              return
            }
            
            return new AudioPlaybackError({
              cause: errorStr,
              operation: 'autoplay',
              autoplayBlocked: isAutoplayBlocked,
              timestamp: new Date()
            })
          }
        })
        
        // Handle manual play if needed
        if (Option.isNone(playResult)) {
          // Autoplay was blocked, wait for user gesture
          // The UI will need to call play manually
        }
      }),

    stopStream: () =>
      Effect.gen(function* () {
        const audioAdapter = yield* AudioAdapter
        
        // Stop MediaStream tracks
        if (Option.isSome(currentStream)) {
          currentStream.value.getTracks().forEach(track => track.stop())
          currentStream = Option.none()
        }
        
        // Cleanup audio element
        if (Option.isSome(audioElement)) {
          const elem = audioElement.value
          elem.pause()
          elem.srcObject = null
        }
        
        // Update state in adapter
        audioAdapter.setStreamState({
          playing: false,
          deviceId: Option.none(),
          constraints: Option.none(),
          acquiredAt: Option.none(),
          error: Option.none(),
          requiresUserGesture: false,
          permission: audioAdapter.getPermission()
        })
      }),

    getCurrentStream: () => currentStream
  }

  // Helper function to stop current stream
  function stopCurrentStream(): Effect.Effect<void, never, never> {
    return Effect.sync(() => {
      if (Option.isSome(currentStream)) {
        currentStream.value.getTracks().forEach(track => track.stop())
      }
      
      if (Option.isSome(audioElement)) {
        const elem = audioElement.value
        elem.pause()
        elem.srcObject = null
      }
    })
  }
}

/**
 * Audio Client Layer
 * 
 * Live implementation that creates the client.
 */
export const AudioClientLive = Layer.succeed(
  AudioClient,
  createAudioClientImpl()
)