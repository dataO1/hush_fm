/**
 * Audio Infrastructure Client
 * 
 * Pure technical layer for browser audio APIs.
 * No business logic - only handles audio hardware and browser APIs.
 * 
 * Responsibilities:
 * - getUserMedia operations
 * - AudioContext management  
 * - HTMLAudioElement control
 * - Audio stream manipulation
 * - Browser audio capabilities
 */

import { Effect, pipe, Context, Layer } from 'effect'

/**
 * Audio device information
 */
export interface AudioDevice {
  deviceId: string
  label: string
  kind: MediaDeviceKind
  groupId: string
}

/**
 * Audio constraints for getUserMedia
 */
export interface AudioConstraints {
  deviceId?: string
  sampleRate?: number
  channelCount?: number
  echoCancellation?: boolean
  noiseSuppression?: boolean
  autoGainControl?: boolean
}

/**
 * Audio playback configuration
 */
export interface AudioPlaybackConfig {
  volume?: number
  muted?: boolean
  autoplay?: boolean
  controls?: boolean
}

/**
 * Audio Infrastructure Error
 */
export class AudioInfrastructureError extends Error {
  constructor(
    message: string,
    public operation: string,
    public cause?: unknown
  ) {
    super(message)
    this.name = 'AudioInfrastructureError'
  }
}

/**
 * Audio Client Interface
 */
export interface AudioClient {
  /**
   * Get available audio input devices
   */
  readonly getInputDevices: () => Effect.Effect<AudioDevice[], AudioInfrastructureError>
  
  /**
   * Get user media stream
   */
  readonly getUserMedia: (constraints?: AudioConstraints) => Effect.Effect<MediaStream, AudioInfrastructureError>
  
  /**
   * Create audio element for playback
   */
  readonly createAudioElement: (config?: AudioPlaybackConfig) => Effect.Effect<HTMLAudioElement, AudioInfrastructureError>
  
  /**
   * Setup audio element with stream
   */
  readonly setupAudioPlayback: (element: HTMLAudioElement, stream: MediaStream) => Effect.Effect<void, AudioInfrastructureError>
  
  /**
   * Stop media stream
   */
  readonly stopMediaStream: (stream: MediaStream) => Effect.Effect<void, never>
  
  /**
   * Stop media track
   */
  readonly stopMediaTrack: (track: MediaStreamTrack) => Effect.Effect<void, never>
  
  /**
   * Check audio permissions
   */
  readonly checkAudioPermissions: () => Effect.Effect<PermissionState, AudioInfrastructureError>
  
  /**
   * Create audio context
   */
  readonly createAudioContext: () => Effect.Effect<AudioContext, AudioInfrastructureError>
  
  /**
   * Resume audio context (for autoplay policies)
   */
  readonly resumeAudioContext: (context: AudioContext) => Effect.Effect<void, AudioInfrastructureError>
  
  /**
   * Get audio stream info
   */
  readonly getStreamInfo: (stream: MediaStream) => Effect.Effect<{ tracks: MediaStreamTrack[], active: boolean }, never>
}

/**
 * Audio Client Implementation
 */
/**
 * Audio Client Context Tag
 * 
 * Services import and use this tag for dependency injection.
 * Uses the same name as the interface for clean imports.
 */
export class AudioClient extends Context.Tag("@app/infrastructure/AudioClient")<
  AudioClient,
  AudioClient
>() {}

/**
 * Audio Client Implementation
 */
const AudioClientImpl: AudioClient = {
  /**
   * Get available audio input devices
   */
  getInputDevices: (): Effect.Effect<AudioDevice[], AudioInfrastructureError> =>
    pipe(
      Effect.tryPromise({
        try: async () => {
          // Request permission to enumerate devices
          await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
            .then(stream => {
              // Stop the stream immediately, we just needed permission
              stream.getTracks().forEach(track => track.stop())
            })
            .catch(() => {
              // Continue even if permission denied, we'll get limited info
            })
          
          const devices = await navigator.mediaDevices.enumerateDevices()
          return devices
            .filter(device => device.kind === 'audioinput')
            .map(device => ({
              deviceId: device.deviceId,
              label: device.label || `Audio Input ${device.deviceId.slice(0, 8)}`,
              kind: device.kind,
              groupId: device.groupId
            }))
        },
        catch: error => new AudioInfrastructureError(
          'Failed to enumerate audio devices',
          'getInputDevices',
          error
        )
      })
    ),

  /**
   * Get user media stream
   */
  getUserMedia: (constraints?: AudioConstraints): Effect.Effect<MediaStream, AudioInfrastructureError> =>
    pipe(
      Effect.tryPromise({
        try: () => {
          const mediaConstraints: MediaStreamConstraints = {
            audio: constraints ? {
              deviceId: constraints.deviceId ? { exact: constraints.deviceId } : undefined,
              sampleRate: constraints.sampleRate,
              channelCount: constraints.channelCount,
              echoCancellation: constraints.echoCancellation ?? true,
              noiseSuppression: constraints.noiseSuppression ?? true,
              autoGainControl: constraints.autoGainControl ?? true
            } : true,
            video: false
          }
          
          return navigator.mediaDevices.getUserMedia(mediaConstraints)
        },
        catch: error => {
          // Provide more specific error messages based on error type
          if (error instanceof DOMException) {
            switch (error.name) {
              case 'NotFoundError':
                return new AudioInfrastructureError(
                  'No audio input device found',
                  'getUserMedia',
                  error
                )
              case 'NotAllowedError':
                return new AudioInfrastructureError(
                  'Microphone permission denied',
                  'getUserMedia',
                  error
                )
              case 'NotReadableError':
                return new AudioInfrastructureError(
                  'Audio device is already in use',
                  'getUserMedia',
                  error
                )
              case 'OverconstrainedError':
                return new AudioInfrastructureError(
                  'Audio constraints cannot be satisfied',
                  'getUserMedia',
                  error
                )
              default:
                return new AudioInfrastructureError(
                  `getUserMedia failed: ${error.message}`,
                  'getUserMedia',
                  error
                )
            }
          }
          
          return new AudioInfrastructureError(
            'Failed to get user media',
            'getUserMedia',
            error
          )
        }
      })
    ),

  /**
   * Create HTML audio element
   */
  createAudioElement: (config?: AudioPlaybackConfig): Effect.Effect<HTMLAudioElement, AudioInfrastructureError> =>
    pipe(
      Effect.sync(() => {
        const audio = new Audio()
        
        // Apply configuration
        if (config?.volume !== undefined) {
          audio.volume = Math.max(0, Math.min(1, config.volume))
        }
        if (config?.muted !== undefined) {
          audio.muted = config.muted
        }
        if (config?.autoplay !== undefined) {
          audio.autoplay = config.autoplay
        }
        if (config?.controls !== undefined) {
          audio.controls = config.controls
        }
        
        // Set additional properties for better compatibility
        audio.playsInline = true // Important for mobile
        
        return audio
      }),
      Effect.catchAll(error =>
        Effect.fail(new AudioInfrastructureError(
          'Failed to create audio element',
          'createAudioElement',
          error
        ))
      )
    ),

  /**
   * Setup audio playback with stream
   */
  setupAudioPlayback: (element: HTMLAudioElement, stream: MediaStream): Effect.Effect<void, AudioInfrastructureError> =>
    pipe(
      Effect.sync(() => {
        // Set the stream as source
        element.srcObject = stream
        
        // Handle loading and errors
        return new Promise<void>((resolve, reject) => {
          const handleCanPlay = () => {
            cleanup()
            resolve()
          }
          
          const handleError = () => {
            cleanup()
            reject(new AudioInfrastructureError(
              'Failed to setup audio playback',
              'setupAudioPlayback',
              element.error
            ))
          }
          
          const cleanup = () => {
            element.removeEventListener('canplay', handleCanPlay)
            element.removeEventListener('error', handleError)
          }
          
          element.addEventListener('canplay', handleCanPlay, { once: true })
          element.addEventListener('error', handleError, { once: true })
          
          // Start loading
          element.load()
        })
      }),
      Effect.andThen(promise => 
        Effect.tryPromise({
          try: () => promise,
          catch: error => error instanceof AudioInfrastructureError 
            ? error 
            : new AudioInfrastructureError(
                'Audio playback setup failed',
                'setupAudioPlayback',
                error
              )
        })
      )
    ),

  /**
   * Stop all tracks in media stream
   */
  stopMediaStream: (stream: MediaStream): Effect.Effect<void, never> =>
    Effect.sync(() => {
      stream.getTracks().forEach(track => {
        try {
          track.stop()
        } catch {
          // Ignore errors when stopping tracks
        }
      })
    }),

  /**
   * Stop individual media track
   */
  stopMediaTrack: (track: MediaStreamTrack): Effect.Effect<void, never> =>
    Effect.sync(() => {
      try {
        track.stop()
      } catch {
        // Ignore errors when stopping track
      }
    }),

  /**
   * Check audio permissions
   */
  checkAudioPermissions: (): Effect.Effect<PermissionState, AudioInfrastructureError> =>
    pipe(
      Effect.tryPromise({
        try: async () => {
          const permission = await navigator.permissions.query({ name: 'microphone' as PermissionName })
          return permission.state
        },
        catch: error => new AudioInfrastructureError(
          'Failed to check audio permissions',
          'checkAudioPermissions',
          error
        )
      })
    ),

  /**
   * Create audio context
   */
  createAudioContext: (): Effect.Effect<AudioContext, AudioInfrastructureError> =>
    pipe(
      Effect.sync(() => {
        if (!window.AudioContext && !(window as any).webkitAudioContext) {
          throw new AudioInfrastructureError(
            'AudioContext not supported',
            'createAudioContext'
          )
        }
        
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
        return new AudioContextClass()
      }),
      Effect.catchAll(error =>
        Effect.fail(error instanceof AudioInfrastructureError 
          ? error 
          : new AudioInfrastructureError(
              'Failed to create audio context',
              'createAudioContext',
              error
            )
        )
      )
    ),

  /**
   * Resume audio context (for autoplay policies)
   */
  resumeAudioContext: (context: AudioContext): Effect.Effect<void, AudioInfrastructureError> =>
    pipe(
      Effect.tryPromise({
        try: () => {
          if (context.state === 'suspended') {
            return context.resume()
          }
          return Promise.resolve()
        },
        catch: error => new AudioInfrastructureError(
          'Failed to resume audio context',
          'resumeAudioContext',
          error
        )
      })
    ),

  /**
   * Get media stream information
   */
  getStreamInfo: (stream: MediaStream): Effect.Effect<{ tracks: MediaStreamTrack[], active: boolean }, never> =>
    Effect.sync(() => ({
      tracks: stream.getTracks(),
      active: stream.active
    }))
}

/**
 * Audio Client Service Layer
 */
/**
 * Audio Client Layer
 * 
 * Live implementation layer that provides the AudioClient.
 * Use this in your app's main Layer composition.
 */
export const AudioClientLive = Layer.succeed(
  AudioClient,
  AudioClientImpl
)

/**
 * Convenience functions for common audio operations
 */
export namespace AudioAPI {
  /**
   * Get default audio input device
   */
  export const getDefaultInputDevice = () =>
    pipe(
      AudioClientLive.getInputDevices(),
      Effect.map(devices => devices.find(d => d.deviceId === 'default') || devices[0])
    )

  /**
   * Check if browser supports getUserMedia
   */
  export const isGetUserMediaSupported = () =>
    Effect.sync(() => 
      !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
    )

  /**
   * Get simple audio stream with default settings
   */
  export const getSimpleAudioStream = () =>
    AudioClientLive.getUserMedia({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    })

  /**
   * Setup simple audio playback
   */
  export const setupSimplePlayback = (stream: MediaStream) =>
    pipe(
      AudioClientLive.createAudioElement({ 
        autoplay: true, 
        controls: false,
        volume: 1.0
      }),
      Effect.andThen(audio => 
        pipe(
          AudioClientLive.setupAudioPlayback(audio, stream),
          Effect.map(() => audio)
        )
      )
    )
}