/**
 * MediaSoup Consumer Service
 * 
 * Extracted service for managing MediaSoup Consumer lifecycle:
 * - Consumer creation from transport and producer parameters
 * - Consumer pause/resume functionality
 * - Consumer state management and monitoring
 * - Consumer statistics and diagnostics
 * - Audio playback management
 * 
 * Pure Effect-TS service with minimal WebSocket dependencies.
 */

import { Effect, pipe, Context, Layer } from 'effect'
import { types } from 'mediasoup-client'
import type { ConsumerParameters as ApiConsumerParameters } from '../generated/hushFMAPI.schemas'
import { ConsumerOptionsFromApi, type ConsumerOptions as WSConsumerOptions } from '../websocket/schemas/websocket'

/**
 * Consumer Service Errors
 */
export class ConsumerError extends Error {
  public readonly cause?: unknown
  
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'ConsumerError'
    this.cause = cause
  }
}

export class ConsumerCreationError extends ConsumerError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'ConsumerCreationError'
  }
}

export class ConsumerNotFoundError extends ConsumerError {
  constructor(consumerId: string) {
    super(`Consumer not found: ${consumerId}`)
    this.name = 'ConsumerNotFoundError'
  }
}

/**
 * Audio Playback Options
 */
export interface AudioPlaybackOptions {
  autoplay?: boolean
  volume?: number
  muted?: boolean
  loop?: boolean
  onAutoplayBlocked?: () => void
  onAutoplaySuccess?: () => void
}

export class AudioPlaybackError extends ConsumerError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'AudioPlaybackError'
  }
}

/**
 * Consumer State Information
 */
export interface ConsumerState {
  id: string
  producerId: string
  kind: 'audio' | 'video'
  paused: boolean
  closed: boolean
  rtpParameters: any
  track: MediaStreamTrack | null
  appData: any
  stats?: ConsumerStats
}

/**
 * Consumer Statistics
 */
export interface ConsumerStats {
  id: string
  kind: 'audio' | 'video'
  bytesReceived: number
  packetsReceived: number
  packetsLost: number
  jitter: number
  timestamp: Date
}

/**
 * Consumer Event Callbacks
 */
export interface ConsumerCallbacks {
  onTrackEnded?: (consumer: types.Consumer) => void
  onTransportClose?: (consumer: types.Consumer) => void
  onPause?: (consumer: types.Consumer) => void
  onResume?: (consumer: types.Consumer) => void
}


/**
 * Consumer Service Interface
 */
export interface MediaSoupConsumerService {
  /**
   * Create consumer from transport and parameters
   */
  readonly createConsumer: (
    transport: types.Transport,
    options: ApiConsumerParameters,
    appData?: any
  ) => Effect.Effect<types.Consumer, ConsumerCreationError>
  
  /**
   * Pause consumer
   */
  readonly pauseConsumer: (consumer: types.Consumer) => Effect.Effect<void, ConsumerError>
  
  /**
   * Resume consumer
   */
  readonly resumeConsumer: (consumer: types.Consumer) => Effect.Effect<void, ConsumerError>
  
  /**
   * Close consumer
   */
  readonly closeConsumer: (consumer: types.Consumer) => Effect.Effect<void, never>
  
  /**
   * Get consumer statistics
   */
  readonly getConsumerStats: (consumer: types.Consumer) => Effect.Effect<any, ConsumerError>
  
  /**
   * Get consumer state
   */
  readonly getConsumerState: (consumer: types.Consumer) => Effect.Effect<ConsumerState, never>
  
  /**
   * Create MediaStream from consumer
   */
  readonly createMediaStream: (consumer: types.Consumer) => Effect.Effect<MediaStream, ConsumerError>
  
  /**
   * Create audio element for consumer
   */
  readonly createAudioElement: (
    consumer: types.Consumer,
    options?: AudioPlaybackOptions
  ) => Effect.Effect<HTMLAudioElement, AudioPlaybackError>
  
  /**
   * Setup consumer event handlers
   */
  readonly setupConsumerEvents: (
    consumer: types.Consumer,
    callbacks?: ConsumerCallbacks
  ) => Effect.Effect<void, never>
  
  /**
   * Validate consumer options
   */
  readonly validateConsumerOptions: (options: ApiConsumerParameters) => Effect.Effect<WSConsumerOptions, ConsumerError>
  
  /**
   * Check if consumer can consume from producer
   */
  readonly canConsume: (
    transport: types.Transport,
    rtpParameters: any
  ) => Effect.Effect<boolean, ConsumerError>
}

/**
 * Consumer Service Implementation
 */
class MediaSoupConsumerServiceImpl implements MediaSoupConsumerService {
  
  /**
   * Create consumer from transport and parameters
   */
  createConsumer = (
    transport: types.Transport,
    options: ApiConsumerParameters,
    appData?: any
  ): Effect.Effect<types.Consumer, ConsumerCreationError> =>
    pipe(
      this.validateConsumerOptions(options),
      Effect.andThen(nativeOptions =>
        Effect.tryPromise({
          try: async () => {
            console.info('🎧 Creating consumer', {
              transport_id: transport.id,
              producer_id: nativeOptions.producerId,
              kind: nativeOptions.kind,
              rtp_parameters: nativeOptions.rtpParameters
            })

            const consumer = await transport.consume({
              ...nativeOptions,
              appData: appData || {}
            })

            console.info('✅ Consumer created successfully', {
              consumer_id: consumer.id,
              producer_id: consumer.producerId,
              consumer_kind: consumer.kind,
              consumer_paused: consumer.paused,
              has_track: !!consumer.track
            })

            // Always resume consumer - MediaSoup handles producer pause state internally
            if (consumer.paused) {
              await consumer.resume()
            }

            return consumer
          },
          catch: (error) => new ConsumerCreationError(
            `Failed to create consumer: ${error}`,
            error
          )
        })
      ),
      Effect.tap(consumer => Effect.logInfo(`Created consumer: ${consumer.id}`))
    )

  /**
   * Pause consumer
   */
  pauseConsumer = (consumer: types.Consumer): Effect.Effect<void, ConsumerError> =>
    pipe(
      Effect.tryPromise({
        try: async () => {
          console.info('⏸️ Pausing consumer', {
            consumer_id: consumer.id,
            currently_paused: consumer.paused
          })
          
          if (!consumer.paused) {
            await consumer.pause()
          }
          
          console.info('✅ Consumer paused successfully', {
            consumer_id: consumer.id,
            paused: consumer.paused
          })
        },
        catch: (error) => new ConsumerError(
          `Failed to pause consumer ${consumer.id}: ${error}`,
          error
        )
      }),
      Effect.tap(() => Effect.logInfo(`Paused consumer: ${consumer.id}`))
    )

  /**
   * Resume consumer
   */
  resumeConsumer = (consumer: types.Consumer): Effect.Effect<void, ConsumerError> =>
    pipe(
      Effect.tryPromise({
        try: async () => {
          console.info('▶️ Resuming consumer', {
            consumer_id: consumer.id,
            currently_paused: consumer.paused
          })
          
          if (consumer.paused) {
            await consumer.resume()
          }
          
          console.info('✅ Consumer resumed successfully', {
            consumer_id: consumer.id,
            paused: consumer.paused
          })
        },
        catch: (error) => new ConsumerError(
          `Failed to resume consumer ${consumer.id}: ${error}`,
          error
        )
      }),
      Effect.tap(() => Effect.logInfo(`Resumed consumer: ${consumer.id}`))
    )

  /**
   * Close consumer
   */
  closeConsumer = (consumer: types.Consumer): Effect.Effect<void, never> =>
    pipe(
      Effect.sync(() => {
        console.info('🔒 Closing consumer', {
          consumer_id: consumer.id,
          consumer_kind: consumer.kind,
          consumer_closed: consumer.closed
        })
        
        if (!consumer.closed) {
          consumer.close()
        }
      }),
      Effect.tap(() => Effect.logInfo(`Closed consumer: ${consumer.id}`))
    )

  /**
   * Get consumer statistics
   */
  getConsumerStats = (consumer: types.Consumer): Effect.Effect<any, ConsumerError> =>
    pipe(
      Effect.tryPromise({
        try: () => consumer.getStats(),
        catch: (error) => new ConsumerError(
          `Failed to get stats for consumer ${consumer.id}: ${error}`,
          error
        )
      }),
      Effect.tap(() => Effect.logDebug(`Retrieved stats for consumer: ${consumer.id}`))
    )

  /**
   * Get consumer state
   */
  getConsumerState = (consumer: types.Consumer): Effect.Effect<ConsumerState, never> =>
    Effect.sync(() => ({
      id: consumer.id,
      producerId: consumer.producerId,
      kind: consumer.kind as 'audio' | 'video',
      paused: consumer.paused,
      closed: consumer.closed,
      rtpParameters: consumer.rtpParameters,
      track: consumer.track,
      appData: consumer.appData
    }))

  /**
   * Create MediaStream from consumer
   */
  createMediaStream = (consumer: types.Consumer): Effect.Effect<MediaStream, ConsumerError> =>
    pipe(
      Effect.sync(() => {
        if (!consumer.track) {
          throw new ConsumerError(`Consumer has no track: ${consumer.id}`)
        }
        
        console.info('🔊 Creating MediaStream from consumer', {
          consumer_id: consumer.id,
          track_id: consumer.track.id,
          track_kind: consumer.track.kind,
          track_ready_state: consumer.track.readyState
        })
        
        return new MediaStream([consumer.track])
      }),
      Effect.tap(() => Effect.logDebug(`Created MediaStream for consumer: ${consumer.id}`))
    )

  /**
   * Create audio element for consumer
   */
  createAudioElement = (
    consumer: types.Consumer,
    options?: AudioPlaybackOptions
  ): Effect.Effect<HTMLAudioElement, AudioPlaybackError> =>
    pipe(
      this.createMediaStream(consumer),
      Effect.andThen(mediaStream =>
        Effect.tryPromise({
          try: async () => {
            const audioElement = document.createElement('audio')
            
            // Set default options
            const config = {
              autoplay: options?.autoplay ?? true,
              volume: options?.volume ?? 0.8,
              muted: options?.muted ?? false,
              loop: options?.loop ?? false
            }
            
            // Configure audio element for background streaming
            audioElement.srcObject = mediaStream
            audioElement.autoplay = config.autoplay
            audioElement.volume = config.volume
            audioElement.muted = config.muted
            audioElement.loop = config.loop
            audioElement.controls = false
            audioElement.playsInline = true // Prevents fullscreen on mobile
            audioElement.preload = 'auto'
            audioElement.crossOrigin = 'anonymous'
            
            console.info('🔊 Created audio element for consumer', {
              consumer_id: consumer.id,
              autoplay: config.autoplay,
              volume: config.volume,
              muted: config.muted
            })
            
            // Set up event handlers
            audioElement.addEventListener('loadeddata', () => {
              console.info(`🎵 Audio element loaded data for consumer: ${consumer.id}`)
            })
            
            audioElement.addEventListener('error', (event) => {
              console.error(`❌ Audio element error for consumer ${consumer.id}:`, event)
            })
            
            // Try to play if autoplay is enabled
            if (config.autoplay) {
              try {
                await audioElement.play()
                console.info(`🎉 Audio element playing for consumer: ${consumer.id}`)
                // Call success callback if provided
                if (options?.onAutoplaySuccess) {
                  options.onAutoplaySuccess()
                }
              } catch (playError) {
                console.warn(`⚠️ Autoplay blocked for consumer ${consumer.id}:`, playError)
                // Call blocked callback if provided
                if (options?.onAutoplayBlocked) {
                  options.onAutoplayBlocked()
                }
                // Don't throw error - autoplay blocking is common
              }
            }
            
            return audioElement
          },
          catch: (error) => new AudioPlaybackError(
            `Failed to create audio element for consumer ${consumer.id}: ${error}`,
            error
          )
        })
      ),
      Effect.tap(() => Effect.logInfo(`Created audio element for consumer: ${consumer.id}`))
    )

  /**
   * Setup consumer event handlers
   */
  setupConsumerEvents = (
    consumer: types.Consumer,
    callbacks?: ConsumerCallbacks
  ): Effect.Effect<void, never> =>
    Effect.sync(() => {
      // Track ended event
      consumer.on('trackended', () => {
        console.info(`🔇 Consumer track ended: ${consumer.id}`)
        callbacks?.onTrackEnded?.(consumer)
      })

      // Transport closed event
      consumer.on('transportclose', () => {
        console.info(`⚠️ Consumer transport closed: ${consumer.id}`)
        callbacks?.onTransportClose?.(consumer)
      })

      // Pause event (MediaSoup specific)
      consumer.on('@pause', () => {
        console.info(`⏸️ Consumer paused remotely: ${consumer.id}`)
        callbacks?.onPause?.(consumer)
      })

      // Resume event (MediaSoup specific)
      consumer.on('@resume', () => {
        console.info(`▶️ Consumer resumed remotely: ${consumer.id}`)
        callbacks?.onResume?.(consumer)
      })

      // Producer pause/resume events (remote producer state changes)
      // Note: These events may not be available in all mediasoup-client versions
      // consumer.on('@producerpause', () => {
      //   console.info(`🔇 Producer paused for consumer: ${consumer.id}`)
      //   // This is handled automatically by MediaSoup - no action needed
      // })

      // consumer.on('@producerresume', () => {
      //   console.info(`🔊 Producer resumed for consumer: ${consumer.id}`)
      //   // This is handled automatically by MediaSoup - no action needed
      // })

      // Monitor the actual MediaStreamTrack for additional events
      if (consumer.track) {
        consumer.track.addEventListener('ended', () => {
          console.error(`❌ MediaStreamTrack ended for consumer: ${consumer.id}`, {
            track_id: consumer.track?.id,
            track_kind: consumer.track?.kind,
            track_ready_state: consumer.track?.readyState,
            track_enabled: consumer.track?.enabled,
            track_muted: consumer.track?.muted
          })
          callbacks?.onTrackEnded?.(consumer)
        })
      }
    })

  /**
   * Validate consumer options
   */
  validateConsumerOptions = (options: ApiConsumerParameters): Effect.Effect<WSConsumerOptions, ConsumerError> =>
    pipe(
      Effect.try({
        try: () => ConsumerOptionsFromApi.decode(options),
        catch: (error) => new ConsumerError(
          `Invalid consumer options: ${error}`,
          error
        )
      })
    )

  /**
   * Check if consumer can consume from producer
   */
  canConsume = (
    _transport: types.Transport,
    rtpParameters: any
  ): Effect.Effect<boolean, ConsumerError> =>
    pipe(
      Effect.sync(() => {
        // Access the device through the transport's connection
        // Note: This would typically check device capabilities
        try {
          // MediaSoup transport has a canConsume method in newer versions
          // For now, assume compatibility based on kind
          return rtpParameters && rtpParameters.codecs && rtpParameters.codecs.length > 0
        } catch (error) {
          throw new ConsumerError(`Cannot check consume capability: ${error}`, error)
        }
      })
    )
}

/**
 * Service Context and Layer
 */
export const MediaSoupConsumerService = Context.GenericTag<MediaSoupConsumerService>('MediaSoupConsumerService')

export const MediaSoupConsumerServiceLive = Layer.succeed(
  MediaSoupConsumerService,
  new MediaSoupConsumerServiceImpl()
)

/**
 * Helper functions for working with consumer service
 */


/**
 * Pause consumer with validation
 */
export const pauseConsumerSafely = (consumer: types.Consumer): Effect.Effect<void, ConsumerError, never> =>
  pipe(
    MediaSoupConsumerService,
    Effect.andThen(service =>
      pipe(
        service.getConsumerState(consumer),
        Effect.andThen(state => 
          state.closed 
            ? Effect.fail(new ConsumerError('Cannot pause closed consumer'))
            : service.pauseConsumer(consumer)
        )
      )
    ),
    Effect.provide(MediaSoupConsumerServiceLive)
  )

/**
 * Resume consumer with validation
 */
export const resumeConsumerSafely = (consumer: types.Consumer): Effect.Effect<void, ConsumerError, never> =>
  pipe(
    MediaSoupConsumerService,
    Effect.andThen(service =>
      pipe(
        service.getConsumerState(consumer),
        Effect.andThen(state => 
          state.closed 
            ? Effect.fail(new ConsumerError('Cannot resume closed consumer'))
            : service.resumeConsumer(consumer)
        )
      )
    ),
    Effect.provide(MediaSoupConsumerServiceLive)
  )

/**
 * Get consumer stats with error handling
 */
export const getConsumerStatsWithRetry = (
  consumer: types.Consumer,
  maxRetries: number = 3
): Effect.Effect<any, ConsumerError, never> =>
  pipe(
    MediaSoupConsumerService,
    Effect.andThen(service => 
      pipe(
        service.getConsumerStats(consumer),
        Effect.retry({ times: maxRetries })
      )
    ),
    Effect.provide(MediaSoupConsumerServiceLive)
  )

/**
 * Create audio consumer with HTMLAudioElement (single source of truth)
 */
export const createAudioConsumer = (
  transport: types.Transport,
  options: ApiConsumerParameters,
  callbacks?: ConsumerCallbacks,
  audioOptions?: AudioPlaybackOptions
): Effect.Effect<{ consumer: types.Consumer; audioElement: HTMLAudioElement }, ConsumerCreationError | AudioPlaybackError, never> =>
  pipe(
    MediaSoupConsumerService,
    Effect.andThen(service => 
      pipe(
        // Validate it's an audio consumer
        Effect.sync(() => {
          if (options.kind !== 'audio') {
            throw new ConsumerError('Expected audio consumer')
          }
        }),
        Effect.andThen(() => service.createConsumer(transport, options)),
        Effect.tap(consumer => service.setupConsumerEvents(consumer, callbacks)),
        Effect.andThen(consumer =>
          pipe(
            service.createAudioElement(consumer, audioOptions),
            Effect.map(audioElement => ({ consumer, audioElement }))
          )
        )
      )
    ),
    Effect.provide(MediaSoupConsumerServiceLive)
  )