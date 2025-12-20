/**
 * MediaSoup Producer Service
 * 
 * Extracted service for managing MediaSoup Producer lifecycle:
 * - Producer creation from media tracks
 * - Producer pause/resume functionality
 * - Producer state management and monitoring
 * - Producer statistics and diagnostics
 * - Track replacement and management
 * 
 * Pure Effect-TS service with minimal WebSocket dependencies.
 */

import { Effect, pipe, Context, Layer } from 'effect'
import { types } from 'mediasoup-client'

/**
 * Producer Service Errors
 */
export class ProducerError extends Error {
  public readonly cause?: unknown
  
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'ProducerError'
    this.cause = cause
  }
}

export class ProducerCreationError extends ProducerError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'ProducerCreationError'
  }
}

export class ProducerNotFoundError extends ProducerError {
  constructor(producerId: string) {
    super(`Producer not found: ${producerId}`)
    this.name = 'ProducerNotFoundError'
  }
}

export class TrackError extends ProducerError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'TrackError'
  }
}

/**
 * Producer State Information
 */
export interface ProducerState {
  id: string
  kind: 'audio' | 'video'
  paused: boolean
  closed: boolean
  rtpParameters: any
  track: MediaStreamTrack | null
  appData: any
  stats?: ProducerStats
}

/**
 * Producer Statistics
 */
export interface ProducerStats {
  id: string
  kind: 'audio' | 'video'
  bytesSent: number
  packetsSent: number
  roundTripTime?: number
  timestamp: Date
}

/**
 * Producer Event Callbacks
 */
export interface ProducerCallbacks {
  onTrackEnded?: (producer: types.Producer) => void
  onTransportClose?: (producer: types.Producer) => void
  onPause?: (producer: types.Producer) => void
  onResume?: (producer: types.Producer) => void
}

/**
 * Producer Service Interface
 */
export interface MediaSoupProducerService {
  /**
   * Create producer from transport and track
   */
  readonly createProducer: (
    transport: types.Transport,
    track: MediaStreamTrack,
    appData?: any
  ) => Effect.Effect<types.Producer, ProducerCreationError>
  
  /**
   * Pause producer
   */
  readonly pauseProducer: (producer: types.Producer) => Effect.Effect<void, ProducerError>
  
  /**
   * Resume producer
   */
  readonly resumeProducer: (producer: types.Producer) => Effect.Effect<void, ProducerError>
  
  /**
   * Close producer
   */
  readonly closeProducer: (producer: types.Producer) => Effect.Effect<void, never>
  
  /**
   * Replace producer track
   */
  readonly replaceProducerTrack: (
    producer: types.Producer,
    track: MediaStreamTrack
  ) => Effect.Effect<void, ProducerError>
  
  /**
   * Get producer statistics
   */
  readonly getProducerStats: (producer: types.Producer) => Effect.Effect<any, ProducerError>
  
  /**
   * Get producer state
   */
  readonly getProducerState: (producer: types.Producer) => Effect.Effect<ProducerState, never>
  
  /**
   * Validate media track for production
   */
  readonly validateTrack: (track: MediaStreamTrack) => Effect.Effect<void, TrackError>
  
  /**
   * Setup producer event handlers
   */
  readonly setupProducerEvents: (
    producer: types.Producer,
    callbacks?: ProducerCallbacks
  ) => Effect.Effect<void, never>
  
  /**
   * Get audio level (for audio tracks)
   */
  readonly getAudioLevel: (producer: types.Producer) => Effect.Effect<number, ProducerError>
  
  /**
   * Check if producer can produce specific kind
   */
  readonly canProduceKind: (
    transport: types.Transport,
    kind: 'audio' | 'video'
  ) => Effect.Effect<boolean, ProducerError>
}

/**
 * Producer Service Implementation
 */
class MediaSoupProducerServiceImpl implements MediaSoupProducerService {
  
  /**
   * Create producer from transport and track
   */
  createProducer = (
    transport: types.Transport,
    track: MediaStreamTrack,
    appData?: any
  ): Effect.Effect<types.Producer, ProducerCreationError> =>
    pipe(
      this.validateTrack(track),
      Effect.andThen(() =>
        Effect.tryPromise({
          try: async () => {
            console.info('🎵 Creating producer for track', {
              track_id: track.id,
              track_kind: track.kind,
              track_label: track.label,
              track_ready_state: track.readyState,
              track_enabled: track.enabled,
              transport_id: transport.id
            })

            // MediaSoup automatically handles RTP parameter negotiation
            const producer = await transport.produce({
              track,
              appData: appData || {}
            })

            console.info('✅ Producer created successfully', {
              producer_id: producer.id,
              producer_kind: producer.kind,
              producer_paused: producer.paused,
              rtp_parameters: producer.rtpParameters
            })

            return producer
          },
          catch: (error) => new ProducerCreationError(
            `Failed to create producer: ${error}`,
            error
          )
        })
      ),
      Effect.tap(producer => Effect.logInfo(`Created producer: ${producer.id}`))
    )

  /**
   * Pause producer
   */
  pauseProducer = (producer: types.Producer): Effect.Effect<void, ProducerError> =>
    pipe(
      Effect.tryPromise({
        try: async () => {
          console.info('⏸️ Pausing producer', {
            producer_id: producer.id,
            currently_paused: producer.paused
          })
          
          if (!producer.paused) {
            await producer.pause()
          }
          
          console.info('✅ Producer paused successfully', {
            producer_id: producer.id,
            paused: producer.paused
          })
        },
        catch: (error) => new ProducerError(
          `Failed to pause producer ${producer.id}: ${error}`,
          error
        )
      }),
      Effect.tap(() => Effect.logInfo(`Paused producer: ${producer.id}`))
    )

  /**
   * Resume producer
   */
  resumeProducer = (producer: types.Producer): Effect.Effect<void, ProducerError> =>
    pipe(
      Effect.tryPromise({
        try: async () => {
          console.info('▶️ Resuming producer', {
            producer_id: producer.id,
            currently_paused: producer.paused
          })
          
          if (producer.paused) {
            await producer.resume()
          }
          
          console.info('✅ Producer resumed successfully', {
            producer_id: producer.id,
            paused: producer.paused
          })
        },
        catch: (error) => new ProducerError(
          `Failed to resume producer ${producer.id}: ${error}`,
          error
        )
      }),
      Effect.tap(() => Effect.logInfo(`Resumed producer: ${producer.id}`))
    )

  /**
   * Close producer
   */
  closeProducer = (producer: types.Producer): Effect.Effect<void, never> =>
    pipe(
      Effect.sync(() => {
        console.info('🔒 Closing producer', {
          producer_id: producer.id,
          producer_kind: producer.kind,
          producer_closed: producer.closed
        })
        
        if (!producer.closed) {
          producer.close()
        }
      }),
      Effect.tap(() => Effect.logInfo(`Closed producer: ${producer.id}`))
    )

  /**
   * Replace producer track
   */
  replaceProducerTrack = (
    producer: types.Producer,
    track: MediaStreamTrack
  ): Effect.Effect<void, ProducerError> =>
    pipe(
      this.validateTrack(track),
      Effect.andThen(() =>
        Effect.tryPromise({
          try: async () => {
            console.info('🔄 Replacing producer track', {
              producer_id: producer.id,
              old_track_id: producer.track?.id,
              new_track_id: track.id,
              new_track_kind: track.kind,
              new_track_ready_state: track.readyState
            })
            
            await producer.replaceTrack({ track })
            
            console.info('✅ Producer track replaced successfully', {
              producer_id: producer.id,
              new_track_id: track.id
            })
          },
          catch: (error) => new ProducerError(
            `Failed to replace track for producer ${producer.id}: ${error}`,
            error
          )
        })
      ),
      Effect.tap(() => Effect.logInfo(`Replaced track for producer: ${producer.id}`))
    )

  /**
   * Get producer statistics
   */
  getProducerStats = (producer: types.Producer): Effect.Effect<any, ProducerError> =>
    pipe(
      Effect.tryPromise({
        try: () => producer.getStats(),
        catch: (error) => new ProducerError(
          `Failed to get stats for producer ${producer.id}: ${error}`,
          error
        )
      }),
      Effect.tap(() => Effect.logDebug(`Retrieved stats for producer: ${producer.id}`))
    )

  /**
   * Get producer state
   */
  getProducerState = (producer: types.Producer): Effect.Effect<ProducerState, never> =>
    Effect.sync(() => ({
      id: producer.id,
      kind: producer.kind as 'audio' | 'video',
      paused: producer.paused,
      closed: producer.closed,
      rtpParameters: producer.rtpParameters,
      track: producer.track,
      appData: producer.appData
    }))

  /**
   * Validate media track for production
   */
  validateTrack = (track: MediaStreamTrack): Effect.Effect<void, TrackError> =>
    pipe(
      Effect.sync(() => {
        if (!track) {
          throw new TrackError('Track is null or undefined')
        }
        
        if (track.readyState !== 'live') {
          throw new TrackError(`Track is not live: readyState=${track.readyState}`)
        }
        
        if (!track.enabled) {
          throw new TrackError('Track is not enabled')
        }
        
        if (track.kind !== 'audio' && track.kind !== 'video') {
          throw new TrackError(`Invalid track kind: ${track.kind}`)
        }
        
        // Additional audio-specific validation
        if (track.kind === 'audio') {
          const audioSettings = track.getSettings()
          
          // Log audio settings for debugging
          console.debug('🎵 Audio track settings validation:', {
            sampleRate: audioSettings.sampleRate,
            channelCount: audioSettings.channelCount,
            echoCancellation: audioSettings.echoCancellation,
            noiseSuppression: audioSettings.noiseSuppression,
            autoGainControl: audioSettings.autoGainControl,
            trackId: track.id,
            trackLabel: track.label,
            trackReadyState: track.readyState
          })
          
          // Firefox may not populate sampleRate in getSettings() - this is a known limitation
          // Only validate if sampleRate is present and invalid
          if (audioSettings.sampleRate !== undefined) {
            if (audioSettings.sampleRate < 8000) {
              throw new TrackError(`Invalid audio sample rate: ${audioSettings.sampleRate}`)
            }
          } else {
            // Firefox case: sampleRate is undefined, but track is still valid
            // Warn but allow through since getUserMedia constraints should ensure proper rate
            console.warn('⚠️ Firefox: sampleRate undefined in getSettings() - this is expected behavior')
            console.info('✅ Proceeding with track validation despite undefined sampleRate (Firefox limitation)')
          }
        }
      })
    )

  /**
   * Setup producer event handlers
   */
  setupProducerEvents = (
    producer: types.Producer,
    callbacks?: ProducerCallbacks
  ): Effect.Effect<void, never> =>
    Effect.sync(() => {
      // Track ended event
      producer.on('trackended', () => {
        console.error(`❌ Producer track ENDED: ${producer.id}`)
        console.error('Audio source stopped - microphone may have been disconnected or permissions revoked')
        callbacks?.onTrackEnded?.(producer)
      })

      // Transport closed event
      producer.on('transportclose', () => {
        console.warn(`⚠️ Producer transport closed: ${producer.id}`)
        callbacks?.onTransportClose?.(producer)
      })

      // Pause event (if supported)
      if (callbacks?.onPause) {
        // Note: MediaSoup doesn't have native pause events, 
        // these would be triggered manually after pause operations
      }

      // Resume event (if supported)  
      if (callbacks?.onResume) {
        // Note: MediaSoup doesn't have native resume events,
        // these would be triggered manually after resume operations
      }

      // Monitor the actual MediaStreamTrack for additional events
      if (producer.track) {
        producer.track.addEventListener('ended', () => {
          console.error(`❌ MediaStreamTrack ended for producer: ${producer.id}`, {
            track_id: producer.track?.id,
            track_kind: producer.track?.kind,
            track_ready_state: producer.track?.readyState,
            track_enabled: producer.track?.enabled,
            track_muted: producer.track?.muted,
            track_label: producer.track?.label
          })
          callbacks?.onTrackEnded?.(producer)
        })
      }
    })

  /**
   * Get audio level (for audio tracks)
   */
  getAudioLevel = (producer: types.Producer): Effect.Effect<number, ProducerError> =>
    pipe(
      Effect.sync(() => {
        if (producer.kind !== 'audio' || !producer.track) {
          throw new ProducerError('Producer is not audio or has no track')
        }
        
        // Placeholder - real implementation would require audio analysis
        // This would typically involve Web Audio API integration
        return 0
      })
    )

  /**
   * Check if producer can produce specific kind
   */
  canProduceKind = (
    _transport: types.Transport,
    kind: 'audio' | 'video'
  ): Effect.Effect<boolean, ProducerError> =>
    pipe(
      Effect.sync(() => {
        // Access the device through the transport's connection
        // Note: This is a simplified check - real implementation might need device reference
        return kind === 'audio' || kind === 'video'
      })
    )
}

/**
 * Service Context and Layer
 */
export const MediaSoupProducerService = Context.GenericTag<MediaSoupProducerService>('MediaSoupProducerService')

export const MediaSoupProducerServiceLive = Layer.succeed(
  MediaSoupProducerService,
  new MediaSoupProducerServiceImpl()
)

/**
 * Helper functions for working with producer service
 */

/**
 * Create producer with event setup
 */
export const createProducerWithEvents = (
  transport: types.Transport,
  track: MediaStreamTrack,
  callbacks: ProducerCallbacks,
  appData?: any
): Effect.Effect<types.Producer, ProducerCreationError, never> =>
  pipe(
    MediaSoupProducerService,
    Effect.andThen(service => 
      pipe(
        service.createProducer(transport, track, appData),
        Effect.tap(producer => service.setupProducerEvents(producer, callbacks))
      )
    ),
    Effect.provide(MediaSoupProducerServiceLive)
  )

/**
 * Pause producer with validation
 */
export const pauseProducerSafely = (producer: types.Producer): Effect.Effect<void, ProducerError, never> =>
  pipe(
    MediaSoupProducerService,
    Effect.andThen(service =>
      pipe(
        service.getProducerState(producer),
        Effect.andThen(state => 
          state.closed 
            ? Effect.fail(new ProducerError('Cannot pause closed producer'))
            : service.pauseProducer(producer)
        )
      )
    ),
    Effect.provide(MediaSoupProducerServiceLive)
  )

/**
 * Resume producer with validation
 */
export const resumeProducerSafely = (producer: types.Producer): Effect.Effect<void, ProducerError, never> =>
  pipe(
    MediaSoupProducerService,
    Effect.andThen(service =>
      pipe(
        service.getProducerState(producer),
        Effect.andThen(state => 
          state.closed 
            ? Effect.fail(new ProducerError('Cannot resume closed producer'))
            : service.resumeProducer(producer)
        )
      )
    ),
    Effect.provide(MediaSoupProducerServiceLive)
  )

/**
 * Get producer stats with error handling
 */
export const getProducerStatsWithRetry = (
  producer: types.Producer,
  maxRetries: number = 3
): Effect.Effect<any, ProducerError, never> =>
  pipe(
    MediaSoupProducerService,
    Effect.andThen(service => 
      pipe(
        service.getProducerStats(producer),
        Effect.retry({ times: maxRetries })
      )
    ),
    Effect.provide(MediaSoupProducerServiceLive)
  )

/**
 * Create audio producer with validation
 */
export const createAudioProducer = (
  transport: types.Transport,
  audioTrack: MediaStreamTrack,
  callbacks?: ProducerCallbacks
): Effect.Effect<types.Producer, ProducerCreationError | TrackError, never> =>
  pipe(
    MediaSoupProducerService,
    Effect.andThen(service => 
      pipe(
        Effect.sync(() => {
          if (audioTrack.kind !== 'audio') {
            throw new TrackError('Track must be audio kind')
          }
        }),
        Effect.andThen(() => service.validateTrack(audioTrack)),
        Effect.andThen(() => service.createProducer(transport, audioTrack)),
        Effect.tap(producer => 
          callbacks ? service.setupProducerEvents(producer, callbacks) : Effect.void
        )
      )
    ),
    Effect.provide(MediaSoupProducerServiceLive)
  )