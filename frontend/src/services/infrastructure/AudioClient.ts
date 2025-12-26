/**
 * Audio Infrastructure Client
 *
 * Infrastructure service that manages MediaStream and audio devices.
 * State is managed via AudioAdapter/Store.
 */

import { Effect, Layer, Option as O, Context, pipe } from 'effect'
import { createSignal } from 'solid-js'
import { AudioAdapter } from '../../stores'
import {
  AudioDeviceError,
  AudioTrackError,
  AudioPlaybackError,
  type AudioServiceError
} from '../../domain/schemas/audio.schema'

/**
 * Audio Client Interface
 *
 * Infrastructure layer for audio device and stream management.
 * State is persisted in AudioAdapter/Store.
 */
interface AudioClientInterface {
  // Device Management
  readonly getAudioDevices: () => Effect.Effect<
    ReadonlyArray<MediaDeviceInfo>,
    AudioServiceError,
    AudioAdapter
  >

  // Device Selection (for DJ mic input)
  // Updates state in AudioAdapter
  readonly selectDevice: (deviceId: string) => Effect.Effect<
    MediaStream,
    AudioServiceError,
    AudioAdapter
  >

  // Remote Stream (for listener playback)
  // Updates state in AudioAdapter
  readonly connectRemoteStream: (stream: MediaStream) => Effect.Effect<
    void,
    AudioPlaybackError,
    AudioAdapter
  >

  // Stop any active stream
  // Updates state in AudioAdapter
  readonly stopStream: () => Effect.Effect<
    void,
    never,
    AudioAdapter
  >

  // Toggle playing state (pause/resume) without disconnecting
  // Updates state in AudioAdapter
  readonly toggleAudioStreamPlaying: (pause: boolean) => Effect.Effect<
    void,
    AudioServiceError,
    AudioAdapter
  >

  // Reactive stream signal (for UI components)
  readonly currentStream: () => O.Option<MediaStream>
}

/**
 * Audio Client Context Tag
 */
export class AudioClient extends Context.Tag("@app/infrastructure/AudioClient")<
  AudioClient,
  AudioClientInterface
>() {}

/**
 * Create Audio Client Implementation
 */
const createAudioClientImpl = (): AudioClientInterface => {
  // Internal MediaStream reference - now reactive with SolidJS signal
  const [currentStream, setCurrentStream] = createSignal<O.Option<MediaStream>>(O.none())

  // Internal audio element for playback (listener mode)
  let audioElement: O.Option<HTMLAudioElement> = O.none()

  // Helper function to stop current stream
  const stopCurrentStream = (): Effect.Effect<void, never, never> =>
    Effect.sync(() => {
      pipe(
        currentStream(),
        O.match({
          onNone: () => {},
          onSome: (stream) => {
            stream.getTracks().forEach(track => track.stop())
          }
        })
      )

      pipe(
        audioElement,
        O.match({
          onNone: () => {},
          onSome: (elem) => {
            elem.pause()
            elem.srcObject = null
          }
        })
      )

      setCurrentStream(O.none())
    })

  // Helper to update permissions if available
  const updatePermissions = (): Effect.Effect<void, never, AudioAdapter> =>
    Effect.gen(function* () {
      const audioAdapter = yield* AudioAdapter

      const state: PermissionState = yield* Effect.promise(async () => {
        try {
          const permission = await navigator.permissions.query({ name: 'microphone' as PermissionName })
          return permission.state as PermissionState
        } catch {
          return 'prompt' as PermissionState // Permissions API not supported, default to prompt
        }
      })

      audioAdapter.setPermission(state)
    })

  // Helper to request microphone permission for device enumeration
  const requestMicrophonePermission = (): Effect.Effect<boolean, AudioDeviceError, never> =>
    Effect.tryPromise({
      try: async () => {
        try {
          // Request minimal audio stream to get permission
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false
            }
          })

          // Immediately stop the temporary stream
          stream.getTracks().forEach(track => track.stop())

          console.info('🎧 AudioClient: Microphone permission granted for device enumeration')
          return true
        } catch (error) {
          console.warn('🎧 AudioClient: Microphone permission denied:', error)
          return false
        }
      },
      catch: (error) => new AudioDeviceError({
        cause: String(error),
        operation: 'requestPermission',
        timestamp: new Date()
      })
    })

  return {
    getAudioDevices: () =>
      Effect.gen(function* () {
        const audioAdapter = yield* AudioAdapter

        // Update permissions if available (don't fail if not supported)
        yield* updatePermissions()

        // First attempt: try to enumerate devices
        console.info('🎧 AudioClient: Attempting device enumeration...')
        const initialDevices = yield* Effect.tryPromise({
          try: async () => {
            const devices = await navigator.mediaDevices.enumerateDevices()
            return devices.filter(device => device.kind === 'audioinput')
          },
          catch: (error) => new AudioDeviceError({
            cause: String(error),
            operation: 'enumerate',
            timestamp: new Date()
          })
        })

        // Check if device labels are available (indicates permission granted)
        const hasLabels = initialDevices.some(device => device.label && device.label.trim() !== '')

        if (hasLabels) {
          // We already have permission, return devices with labels
          console.info('🎧 AudioClient: Device labels available, permission already granted')
          audioAdapter.setAvailableDevices(initialDevices)
          return initialDevices
        }

        // No labels means no permission - request it
        console.info('🎧 AudioClient: No device labels found, requesting microphone permission...')
        const permissionGranted = yield* requestMicrophonePermission()

        if (!permissionGranted) {
          // Permission denied - return devices without labels (best we can do)
          console.warn('🎧 AudioClient: Permission denied, returning devices without labels')
          audioAdapter.setAvailableDevices(initialDevices)
          return initialDevices
        }

        // Permission granted - enumerate again to get labels
        console.info('🎧 AudioClient: Permission granted, re-enumerating devices...')
        const devicesWithLabels = yield* Effect.tryPromise({
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

        return devicesWithLabels
      }),

    selectDevice: (deviceId: string) =>
      Effect.gen(function* () {
        const audioAdapter = yield* AudioAdapter

        // Stop any existing stream
        yield* stopCurrentStream()

        // Update permissions if available
        yield* updatePermissions()

        // Check stored constraints from adapter
        const storedConstraints = audioAdapter.getMediaTrackConstraints()

        // Build constraints, preferring stored ones
        const audioConstraints = pipe(
          storedConstraints,
          O.getOrElse(() => ({
            deviceId: { exact: deviceId },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            // Advanced 2025 optimizations:
            latency: 0,
            sampleRate: 48000,
            channelCount: 2,
          }))
        )

        const constraints: MediaStreamConstraints = {
          audio: audioConstraints,
          video: false
        }

        const newStream = yield* Effect.tryPromise({
          try: async () => {
            const stream = await navigator.mediaDevices.getUserMedia(constraints)

            // Update internal reference
            setCurrentStream(O.some(stream))

            // Update state in adapter
            audioAdapter.setStreamState({
              playing: true,
              deviceId: O.some(deviceId),
              constraints: O.some(audioConstraints as any),
              acquiredAt: O.some(new Date()),
              error: O.none(),
              requiresUserGesture: false,
              permission: audioAdapter.getPermission()
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
        audioElement = pipe(
          audioElement,
          O.orElse(() => {
            const elem = new Audio()
            elem.autoplay = true
            return O.some(elem)
          })
        )

        const elem = O.getOrThrow(audioElement)
        elem.srcObject = remoteStream

        // Try to play with proper error handling
        yield* Effect.gen(function* () {
          try {
            yield* Effect.promise(() => elem.play())

            // Update internal reference and state - successful playback
            setCurrentStream(O.some(remoteStream))
            audioAdapter.setStreamState({
              playing: true,
              deviceId: O.none(),
              constraints: O.none(),
              acquiredAt: O.some(new Date()),
              error: O.none(),
              requiresUserGesture: false,
              permission: audioAdapter.getPermission()
            })

            return
          } catch (error) {
            const errorStr = String(error)
            const isAutoplayBlocked = errorStr.includes('play()') ||
                                     errorStr.includes('user gesture') ||
                                     errorStr.includes('Autoplay')

            // Update internal reference and state
            setCurrentStream(O.some(remoteStream))
            audioAdapter.setStreamState({
              playing: false,
              deviceId: O.none(),
              constraints: O.none(),
              acquiredAt: O.some(new Date()),
              error: O.some(errorStr),
              requiresUserGesture: isAutoplayBlocked,
              permission: audioAdapter.getPermission()
            })

            // Only fail on non-autoplay errors
            if (!isAutoplayBlocked) {
              return yield* Effect.fail(new AudioPlaybackError({
                cause: errorStr,
                operation: 'play',
                autoplayBlocked: false,
                timestamp: new Date()
              }))
            }
          }
        })
      }),

    toggleAudioStreamPlaying: (pause: boolean) =>
      Effect.gen(function* () {
        const audioAdapter = yield* AudioAdapter

        // Only for DJ mode - pause/resume MediaStream tracks
        yield* pipe(
          currentStream(),
          O.match({
            onNone: () =>
              Effect.fail(new AudioPlaybackError({
                cause: 'No active audio stream to toggle',
                operation: pause ? 'pause' : 'play',
                autoplayBlocked: false,
                timestamp: new Date()
              })),
            onSome: (stream) =>
              Effect.sync(() => {
                // Enable/disable audio tracks
                stream.getAudioTracks().forEach(track => {
                  track.enabled = !pause
                })

                // Update state in adapter
                audioAdapter.updateStreamState({
                  playing: !pause
                })
              })
          })
        )
      }),

    stopStream: () =>
      Effect.gen(function* () {
        const audioAdapter = yield* AudioAdapter

        // Stop MediaStream tracks
        pipe(
          currentStream(),
          O.match({
            onNone: () => {},
            onSome: (stream) => {
              stream.getTracks().forEach(track => track.stop())
            }
          })
        )
        setCurrentStream(O.none())

        // Cleanup audio element
        pipe(
          audioElement,
          O.match({
            onNone: () => {},
            onSome: (elem) => {
              elem.pause()
              elem.srcObject = null
            }
          })
        )

        // Update state in adapter
        audioAdapter.setStreamState({
          playing: false,
          deviceId: O.none(),
          constraints: O.none(),
          acquiredAt: O.none(),
          error: O.none(),
          requiresUserGesture: false,
          permission: audioAdapter.getPermission()
        })
      }),

    currentStream: currentStream
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
