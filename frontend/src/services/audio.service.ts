/**
 * Audio Service
 * 
 * Service for managing audio playback, volume control, and audio element lifecycle.
 * Handles both DJ audio tracks (for monitoring) and listener audio consumption.
 * 
 * Pure Effect-TS service with Web Audio API integration.
 */

import { Effect, pipe, Context, Layer } from 'effect'

/**
 * Audio Service Errors
 */
export class AudioError extends Error {
  public readonly cause?: unknown
  
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'AudioError'
    this.cause = cause
  }
}

export class AudioPlaybackError extends AudioError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'AudioPlaybackError'
  }
}

export class AudioContextError extends AudioError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'AudioContextError'
  }
}

export class VolumeControlError extends AudioError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'VolumeControlError'
  }
}

/**
 * Audio Playback State
 */
export interface AudioPlaybackState {
  playing: boolean
  paused: boolean
  muted: boolean
  volume: number
  currentTime: number
  duration: number
  buffered: boolean
  autoplayBlocked: boolean
  hasError: boolean
  errorMessage?: string
}

/**
 * Audio Context Information
 */
export interface AudioContextInfo {
  state: AudioContextState
  sampleRate: number
  currentTime: number
  baseLatency?: number
  outputLatency?: number
}

/**
 * Audio Device Information
 */
export interface AudioDeviceInfo {
  deviceId: string
  label: string
  kind: 'audioinput' | 'audiooutput'
  groupId: string
}

/**
 * Audio Monitoring Options
 */
export interface AudioMonitoringOptions {
  enableLevelMonitoring?: boolean
  enableSpectrumAnalysis?: boolean
  updateInterval?: number
  fftSize?: number
}

/**
 * Audio Level Information
 */
export interface AudioLevel {
  peak: number
  rms: number
  timestamp: number
}

/**
 * Audio Service Interface
 */
export interface AudioService {
  /**
   * Create audio element from MediaStream
   */
  readonly createAudioElement: (
    stream: MediaStream,
    autoplay?: boolean
  ) => Effect.Effect<HTMLAudioElement, AudioPlaybackError>
  
  /**
   * Play audio element
   */
  readonly playAudio: (audioElement: HTMLAudioElement) => Effect.Effect<void, AudioPlaybackError>
  
  /**
   * Pause audio element
   */
  readonly pauseAudio: (audioElement: HTMLAudioElement) => Effect.Effect<void, AudioPlaybackError>
  
  /**
   * Set audio volume (0.0 - 1.0)
   */
  readonly setVolume: (audioElement: HTMLAudioElement, volume: number) => Effect.Effect<void, VolumeControlError>
  
  /**
   * Mute/unmute audio
   */
  readonly setMuted: (audioElement: HTMLAudioElement, muted: boolean) => Effect.Effect<void, VolumeControlError>
  
  /**
   * Get audio playback state
   */
  readonly getPlaybackState: (audioElement: HTMLAudioElement) => Effect.Effect<AudioPlaybackState, never>
  
  /**
   * Setup audio monitoring with Web Audio API
   */
  readonly setupAudioMonitoring: (
    stream: MediaStream,
    options?: AudioMonitoringOptions
  ) => Effect.Effect<AudioContext, AudioContextError>
  
  /**
   * Get audio level from stream
   */
  readonly getAudioLevel: (
    audioContext: AudioContext,
    stream: MediaStream
  ) => Effect.Effect<AudioLevel, AudioError>
  
  /**
   * Get audio context information
   */
  readonly getAudioContextInfo: (audioContext: AudioContext) => Effect.Effect<AudioContextInfo, never>
  
  /**
   * Enumerate audio devices
   */
  readonly enumerateAudioDevices: () => Effect.Effect<AudioDeviceInfo[], AudioError>
  
  /**
   * Check audio support
   */
  readonly checkAudioSupport: () => Effect.Effect<{
    webAudio: boolean
    audioElement: boolean
    mediaDevices: boolean
  }, never>
  
  /**
   * Create audio context
   */
  readonly createAudioContext: () => Effect.Effect<AudioContext, AudioContextError>
  
  /**
   * Close audio context
   */
  readonly closeAudioContext: (audioContext: AudioContext) => Effect.Effect<void, never>
  
  /**
   * Resume audio context (for autoplay policies)
   */
  readonly resumeAudioContext: (audioContext: AudioContext) => Effect.Effect<void, AudioContextError>
}

/**
 * Audio Service Implementation
 */
class AudioServiceImpl implements AudioService {
  
  /**
   * Create audio element from MediaStream
   */
  createAudioElement = (
    stream: MediaStream,
    autoplay: boolean = true
  ): Effect.Effect<HTMLAudioElement, AudioPlaybackError> =>
    pipe(
      Effect.tryPromise({
        try: async () => {
          const audioElement = document.createElement('audio')
          
          // Configure audio element
          audioElement.srcObject = stream
          audioElement.autoplay = autoplay
          audioElement.controls = false
          audioElement.volume = 0.8
          audioElement.muted = false
          
          console.info('🔊 Created audio element', {
            stream_id: stream.id,
            track_count: stream.getAudioTracks().length,
            autoplay
          })
          
          // Set up event handlers
          audioElement.addEventListener('loadedmetadata', () => {
            console.info('Audio element loaded metadata')
          })
          
          audioElement.addEventListener('canplay', () => {
            console.info('Audio element can play')
          })
          
          audioElement.addEventListener('playing', () => {
            console.info('Audio element playing')
          })
          
          audioElement.addEventListener('error', (event) => {
            console.error('Audio element error:', event)
          })
          
          // Try to play if autoplay is enabled
          if (autoplay) {
            try {
              await audioElement.play()
              console.info('Audio element autoplay successful')
            } catch (playError) {
              console.warn('Autoplay blocked:', playError)
              // Don't throw error - autoplay blocking is common
            }
          }
          
          return audioElement
        },
        catch: (error) => new AudioPlaybackError(
          `Failed to create audio element: ${error}`,
          error
        )
      }),
      Effect.tap(() => Effect.logInfo('Created audio element'))
    )

  /**
   * Play audio element
   */
  playAudio = (audioElement: HTMLAudioElement): Effect.Effect<void, AudioPlaybackError> =>
    pipe(
      Effect.tryPromise({
        try: async () => {
          console.info('▶️ Playing audio element')
          await audioElement.play()
        },
        catch: (error) => new AudioPlaybackError(
          `Failed to play audio: ${error}`,
          error
        )
      }),
      Effect.tap(() => Effect.logInfo('Audio element playing'))
    )

  /**
   * Pause audio element
   */
  pauseAudio = (audioElement: HTMLAudioElement): Effect.Effect<void, AudioPlaybackError> =>
    pipe(
      Effect.sync(() => {
        console.info('⏸️ Pausing audio element')
        audioElement.pause()
      }),
      Effect.tap(() => Effect.logInfo('Audio element paused'))
    )

  /**
   * Set audio volume (0.0 - 1.0)
   */
  setVolume = (audioElement: HTMLAudioElement, volume: number): Effect.Effect<void, VolumeControlError> =>
    pipe(
      Effect.sync(() => {
        if (volume < 0 || volume > 1) {
          throw new VolumeControlError(`Invalid volume value: ${volume}. Must be between 0 and 1.`)
        }
        
        console.info('🔊 Setting audio volume', { volume })
        audioElement.volume = volume
      }),
      Effect.tap(() => Effect.logDebug(`Set volume to ${volume}`))
    )

  /**
   * Mute/unmute audio
   */
  setMuted = (audioElement: HTMLAudioElement, muted: boolean): Effect.Effect<void, VolumeControlError> =>
    pipe(
      Effect.sync(() => {
        console.info(`${muted ? '🔇 Muting' : '🔊 Unmuting'} audio element`)
        audioElement.muted = muted
      }),
      Effect.tap(() => Effect.logDebug(`Audio ${muted ? 'muted' : 'unmuted'}`))
    )

  /**
   * Get audio playback state
   */
  getPlaybackState = (audioElement: HTMLAudioElement): Effect.Effect<AudioPlaybackState, never> =>
    Effect.sync(() => ({
      playing: !audioElement.paused && !audioElement.ended,
      paused: audioElement.paused,
      muted: audioElement.muted,
      volume: audioElement.volume,
      currentTime: audioElement.currentTime,
      duration: audioElement.duration || 0,
      buffered: audioElement.buffered.length > 0,
      autoplayBlocked: audioElement.paused && audioElement.readyState >= 3,
      hasError: !!audioElement.error,
      errorMessage: audioElement.error?.message
    }))

  /**
   * Setup audio monitoring with Web Audio API
   */
  setupAudioMonitoring = (
    stream: MediaStream,
    options?: AudioMonitoringOptions
  ): Effect.Effect<AudioContext, AudioContextError> =>
    pipe(
      this.createAudioContext(),
      Effect.andThen(audioContext =>
        Effect.tryPromise({
          try: async () => {
            const config = {
              enableLevelMonitoring: options?.enableLevelMonitoring ?? true,
              enableSpectrumAnalysis: options?.enableSpectrumAnalysis ?? false,
              updateInterval: options?.updateInterval ?? 100,
              fftSize: options?.fftSize ?? 256
            }
            
            console.info('🎵 Setting up audio monitoring', {
              stream_id: stream.id,
              config
            })
            
            // Create audio source from stream
            const source = audioContext.createMediaStreamSource(stream)
            
            if (config.enableLevelMonitoring) {
              // Create analyser for level monitoring
              const analyser = audioContext.createAnalyser()
              analyser.fftSize = config.fftSize
              analyser.smoothingTimeConstant = 0.3
              
              // Connect source to analyser
              source.connect(analyser)
              
              console.info('✅ Audio monitoring setup complete')
            }
            
            return audioContext
          },
          catch: (error) => new AudioContextError(
            `Failed to setup audio monitoring: ${error}`,
            error
          )
        })
      )
    )

  /**
   * Get audio level from stream
   */
  getAudioLevel = (
    audioContext: AudioContext,
    stream: MediaStream
  ): Effect.Effect<AudioLevel, AudioError> =>
    pipe(
      Effect.tryPromise({
        try: async () => {
          // Create temporary analyser
          const source = audioContext.createMediaStreamSource(stream)
          const analyser = audioContext.createAnalyser()
          analyser.fftSize = 256
          analyser.smoothingTimeConstant = 0.3
          
          source.connect(analyser)
          
          // Get current audio data
          const dataArray = new Uint8Array(analyser.frequencyBinCount)
          analyser.getByteFrequencyData(dataArray)
          
          // Calculate RMS and peak
          let sum = 0
          let peak = 0
          
          for (let i = 0; i < dataArray.length; i++) {
            const value = dataArray[i] / 255.0
            sum += value * value
            peak = Math.max(peak, value)
          }
          
          const rms = Math.sqrt(sum / dataArray.length)
          
          // Clean up
          source.disconnect()
          
          return {
            peak,
            rms,
            timestamp: Date.now()
          }
        },
        catch: (error) => new AudioError(
          `Failed to get audio level: ${error}`,
          error
        )
      })
    )

  /**
   * Get audio context information
   */
  getAudioContextInfo = (audioContext: AudioContext): Effect.Effect<AudioContextInfo, never> =>
    Effect.sync(() => ({
      state: audioContext.state,
      sampleRate: audioContext.sampleRate,
      currentTime: audioContext.currentTime,
      baseLatency: audioContext.baseLatency,
      outputLatency: audioContext.outputLatency
    }))

  /**
   * Enumerate audio devices
   */
  enumerateAudioDevices = (): Effect.Effect<AudioDeviceInfo[], AudioError> =>
    pipe(
      Effect.tryPromise({
        try: async () => {
          if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
            throw new Error('MediaDevices API not supported')
          }
          
          const devices = await navigator.mediaDevices.enumerateDevices()
          
          return devices
            .filter(device => device.kind === 'audioinput' || device.kind === 'audiooutput')
            .map(device => ({
              deviceId: device.deviceId,
              label: device.label || `${device.kind} ${device.deviceId.slice(0, 8)}`,
              kind: device.kind as 'audioinput' | 'audiooutput',
              groupId: device.groupId
            }))
        },
        catch: (error) => new AudioError(
          `Failed to enumerate audio devices: ${error}`,
          error
        )
      }),
      Effect.tap(devices => Effect.logInfo(`Found ${devices.length} audio devices`))
    )

  /**
   * Check audio support
   */
  checkAudioSupport = (): Effect.Effect<{
    webAudio: boolean
    audioElement: boolean
    mediaDevices: boolean
  }, never> =>
    Effect.sync(() => ({
      webAudio: !!(window.AudioContext || (window as any).webkitAudioContext),
      audioElement: !!window.HTMLAudioElement,
      mediaDevices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
    }))

  /**
   * Create audio context
   */
  createAudioContext = (): Effect.Effect<AudioContext, AudioContextError> =>
    pipe(
      Effect.tryPromise({
        try: async () => {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
          
          if (!AudioContextClass) {
            throw new Error('Web Audio API not supported')
          }
          
          const audioContext = new AudioContextClass()
          
          console.info('🎵 Created audio context', {
            state: audioContext.state,
            sample_rate: audioContext.sampleRate,
            base_latency: audioContext.baseLatency
          })
          
          return audioContext
        },
        catch: (error) => new AudioContextError(
          `Failed to create audio context: ${error}`,
          error
        )
      }),
      Effect.tap(() => Effect.logInfo('Created audio context'))
    )

  /**
   * Close audio context
   */
  closeAudioContext = (audioContext: AudioContext): Effect.Effect<void, never> =>
    pipe(
      Effect.sync(() => {
        if (audioContext.state !== 'closed') {
          console.info('🔒 Closing audio context')
          audioContext.close()
        }
      }),
      Effect.tap(() => Effect.logInfo('Closed audio context'))
    )

  /**
   * Resume audio context (for autoplay policies)
   */
  resumeAudioContext = (audioContext: AudioContext): Effect.Effect<void, AudioContextError> =>
    pipe(
      Effect.tryPromise({
        try: async () => {
          if (audioContext.state === 'suspended') {
            console.info('▶️ Resuming audio context')
            await audioContext.resume()
          }
        },
        catch: (error) => new AudioContextError(
          `Failed to resume audio context: ${error}`,
          error
        )
      }),
      Effect.tap(() => Effect.logInfo('Audio context resumed'))
    )
}

/**
 * Service Context and Layer
 */
export const AudioService = Context.GenericTag<AudioService>('AudioService')

export const AudioServiceLive = Layer.succeed(
  AudioService,
  new AudioServiceImpl()
)

/**
 * Helper functions for working with audio service
 */

/**
 * Create audio element with monitoring
 */
export const createAudioElementWithMonitoring = (
  stream: MediaStream,
  autoplay?: boolean,
  monitoringOptions?: AudioMonitoringOptions
): Effect.Effect<{ audioElement: HTMLAudioElement; audioContext: AudioContext }, AudioPlaybackError | AudioContextError, never> =>
  pipe(
    AudioService,
    Effect.andThen(service => 
      pipe(
        Effect.all({
          audioElement: service.createAudioElement(stream, autoplay),
          audioContext: service.setupAudioMonitoring(stream, monitoringOptions)
        })
      )
    ),
    Effect.provide(AudioServiceLive)
  )

/**
 * Play audio with context resume
 */
export const playAudioWithContextResume = (
  audioElement: HTMLAudioElement,
  audioContext?: AudioContext
): Effect.Effect<void, AudioPlaybackError | AudioContextError, never> =>
  pipe(
    AudioService,
    Effect.andThen(service =>
      pipe(
        audioContext 
          ? service.resumeAudioContext(audioContext)
          : Effect.void,
        Effect.andThen(() => service.playAudio(audioElement))
      )
    ),
    Effect.provide(AudioServiceLive)
  )

/**
 * Set volume with validation
 */
export const setVolumeWithValidation = (
  audioElement: HTMLAudioElement,
  volume: number
): Effect.Effect<void, VolumeControlError, never> =>
  pipe(
    AudioService,
    Effect.andThen(service => 
      pipe(
        Effect.sync(() => {
          const clampedVolume = Math.max(0, Math.min(1, volume))
          if (clampedVolume !== volume) {
            console.warn(`Volume ${volume} clamped to ${clampedVolume}`)
          }
          return clampedVolume
        }),
        Effect.andThen(clampedVolume => service.setVolume(audioElement, clampedVolume))
      )
    ),
    Effect.provide(AudioServiceLive)
  )