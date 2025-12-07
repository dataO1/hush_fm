import { Effect, pipe } from 'effect'
import type { types } from 'mediasoup-client'
import type { ConsumerState } from '../providers/WebRTCProvider'

/**
 * Consumer-specific errors
 */
export class ConsumerError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message)
    this.name = 'ConsumerError'
  }
}

export class ConsumerNotFoundError extends ConsumerError {
  constructor(consumerId: string) {
    super(`Consumer not found: ${consumerId}`)
    this.name = 'ConsumerNotFoundError'
  }
}

/**
 * Consumer manager for audio reception
 */
export class ConsumerManager {
  private consumers = new Map<string, types.Consumer>()
  private audioElements = new Map<string, HTMLAudioElement>()

  /**
   * Register a new consumer
   */
  registerConsumer = (
    consumer: types.Consumer,
    producerId: string
  ): Effect.Effect<ConsumerState, ConsumerError> =>
    pipe(
      Effect.sync(() => {
        this.consumers.set(consumer.id, consumer)
        
        const consumerState: ConsumerState = {
          id: consumer.id,
          producerId,
          kind: consumer.kind as 'audio' | 'video',
          paused: consumer.paused,
          track: consumer.track,
          consumer,
        }

        // Add to reactive store
        // Consumer state is now managed by WebRTCProvider

        // Set up event handlers
        this.setupConsumerEvents(consumer)

        return consumerState
      }),
      Effect.tap(() => 
        Effect.logInfo(`Registered consumer: ${consumer.id} for producer ${producerId}`)
      )
    )

  /**
   * Get consumer by ID
   */
  getConsumer = (consumerId: string): Effect.Effect<types.Consumer, ConsumerNotFoundError> => {
    const consumer = this.consumers.get(consumerId)
    return consumer 
      ? Effect.succeed(consumer)
      : Effect.fail(new ConsumerNotFoundError(consumerId))
  }

  /**
   * Create audio element for consumer and start playback
   */
  createAudioElement = (
    consumerId: string,
    autoplay: boolean = true
  ): Effect.Effect<HTMLAudioElement, ConsumerError> =>
    pipe(
      this.getConsumer(consumerId),
      Effect.andThen(consumer => {
        if (!consumer.track) {
          return Effect.fail(new ConsumerError('Consumer has no track'))
        }

        return Effect.sync(() => {
          const audioElement = document.createElement('audio')
          audioElement.autoplay = autoplay
          audioElement.controls = false
          audioElement.volume = 1.0
          audioElement.muted = false

          // Create media stream from consumer track
          const stream = new MediaStream([consumer.track!])
          audioElement.srcObject = stream

          // Store reference for cleanup
          this.audioElements.set(consumerId, audioElement)

          return audioElement
        })
      }),
      Effect.tap(() => Effect.logInfo(`Created audio element for consumer: ${consumerId}`))
    )

  /**
   * Pause consumer
   */
  pauseConsumer = (consumerId: string): Effect.Effect<void, ConsumerError> =>
    pipe(
      this.getConsumer(consumerId),
      Effect.andThen(consumer =>
        Effect.tryPromise({
          try: async () => {
            await consumer.pause()
            // Paused state is now managed by WebRTCProvider

            // Also pause audio element if exists
            const audioElement = this.audioElements.get(consumerId)
            if (audioElement) {
              audioElement.pause()
            }
          },
          catch: (error) => new ConsumerError(
            `Failed to pause consumer ${consumerId}: ${error instanceof Error ? error.message : String(error)}`,
            error
          )
        })
      ),
      Effect.tap(() => Effect.logInfo(`Paused consumer: ${consumerId}`))
    )

  /**
   * Resume consumer
   */
  resumeConsumer = (consumerId: string): Effect.Effect<void, ConsumerError> =>
    pipe(
      this.getConsumer(consumerId),
      Effect.andThen(consumer =>
        Effect.tryPromise({
          try: async () => {
            await consumer.resume()
            // Paused state is now managed by WebRTCProvider

            // Also resume audio element if exists
            const audioElement = this.audioElements.get(consumerId)
            if (audioElement) {
              await audioElement.play()
            }
          },
          catch: (error) => new ConsumerError(
            `Failed to resume consumer ${consumerId}: ${error instanceof Error ? error.message : String(error)}`,
            error
          )
        })
      ),
      Effect.tap(() => Effect.logInfo(`Resumed consumer: ${consumerId}`))
    )

  /**
   * Close consumer and clean up
   */
  closeConsumer = (consumerId: string): Effect.Effect<void, ConsumerError> =>
    pipe(
      Effect.sync(() => {
        // Clean up audio element
        const audioElement = this.audioElements.get(consumerId)
        if (audioElement) {
          audioElement.pause()
          audioElement.srcObject = null
          audioElement.remove()
          this.audioElements.delete(consumerId)
        }

        // Close and remove consumer
        const consumer = this.consumers.get(consumerId)
        if (consumer) {
          consumer.close()
          this.consumers.delete(consumerId)
        }

        // Update store
        // Consumer removal is now managed by WebRTCProvider
      }),
      Effect.tap(() => Effect.logInfo(`Closed consumer: ${consumerId}`))
    )

  /**
   * Get consumer statistics
   */
  getConsumerStats = (consumerId: string): Effect.Effect<any, ConsumerError> =>
    pipe(
      this.getConsumer(consumerId),
      Effect.andThen(consumer =>
        Effect.tryPromise({
          try: () => consumer.getStats(),
          catch: (error) => new ConsumerError(
            `Failed to get stats for consumer ${consumerId}: ${error instanceof Error ? error.message : String(error)}`,
            error
          )
        })
      ),
      Effect.tap(() => Effect.logDebug(`Retrieved stats for consumer: ${consumerId}`))
    )

  /**
   * Set volume for consumer audio element
   */
  setVolume = (
    consumerId: string, 
    volume: number
  ): Effect.Effect<void, ConsumerError> =>
    pipe(
      Effect.sync(() => {
        const audioElement = this.audioElements.get(consumerId)
        if (!audioElement) {
          throw new ConsumerError('No audio element found for consumer')
        }

        audioElement.volume = Math.max(0, Math.min(1, volume))
      }),
      Effect.tap(() => Effect.logDebug(`Set volume ${volume} for consumer: ${consumerId}`))
    )

  /**
   * Mute/unmute consumer audio element
   */
  setMuted = (
    consumerId: string, 
    muted: boolean
  ): Effect.Effect<void, ConsumerError> =>
    pipe(
      Effect.sync(() => {
        const audioElement = this.audioElements.get(consumerId)
        if (!audioElement) {
          throw new ConsumerError('No audio element found for consumer')
        }

        audioElement.muted = muted
      }),
      Effect.tap(() => Effect.logDebug(`${muted ? 'Muted' : 'Unmuted'} consumer: ${consumerId}`))
    )

  /**
   * Get audio element for consumer
   */
  getAudioElement = (consumerId: string): Effect.Effect<HTMLAudioElement, ConsumerError> => {
    const audioElement = this.audioElements.get(consumerId)
    return audioElement 
      ? Effect.succeed(audioElement)
      : Effect.fail(new ConsumerError('No audio element found for consumer'))
  }

  /**
   * Set up event handlers for consumer
   */
  private setupConsumerEvents(consumer: types.Consumer): void {
    // Track ended
    consumer.on('trackended', () => {
      Effect.runSync(
        Effect.all([
          Effect.logInfo(`Consumer track ended: ${consumer.id}`),
          this.closeConsumer(consumer.id)
        ])
      )
    })

    // Transport closed
    consumer.on('transportclose', () => {
      Effect.runSync(
        Effect.all([
          Effect.logInfo(`Consumer transport closed: ${consumer.id}`),
          this.closeConsumer(consumer.id)
        ])
      )
    })

    // Pause/resume events (using @ prefix for internal events)
    consumer.on('@pause', () => {
      Effect.runSync(
        Effect.all([
          Effect.logInfo(`Consumer paused: ${consumer.id}`),
          Effect.sync(() => {/* Paused state is now managed by WebRTCProvider */})
        ])
      )
    })

    consumer.on('@resume', () => {
      Effect.runSync(
        Effect.all([
          Effect.logInfo(`Consumer resumed: ${consumer.id}`),
          Effect.sync(() => {/* Paused state is now managed by WebRTCProvider */})
        ])
      )
    })
  }

  /**
   * List all active consumers
   */
  listConsumers = (): Effect.Effect<types.Consumer[], never> =>
    Effect.sync(() => Array.from(this.consumers.values()))

  /**
   * Close all consumers
   */
  closeAllConsumers = (): Effect.Effect<void, never> =>
    pipe(
      this.listConsumers(),
      Effect.andThen(consumers =>
        Effect.all(
          consumers.map(consumer => 
            pipe(
              this.closeConsumer(consumer.id),
              Effect.catchAll(() => Effect.void)
            )
          ),
          { concurrency: 'unbounded' }
        )
      ),
      Effect.andThen(() => Effect.void),
      Effect.tap(() => Effect.logInfo('Closed all consumers'))
    )

  /**
   * Find consumer by producer ID
   */
  findConsumerByProducerId = (producerId: string): Effect.Effect<types.Consumer | null, never> =>
    pipe(
      this.listConsumers(),
      Effect.map(consumers => 
        consumers.find(consumer => 
          // This would need to be tracked from the consumer state
          // For now, we'll use the consumer ID pattern
          consumer.id.includes(producerId)
        ) || null
      )
    )

  /**
   * Get playback status for consumer
   */
  getPlaybackStatus = (consumerId: string): Effect.Effect<{
    playing: boolean
    volume: number
    muted: boolean
    currentTime: number
  }, ConsumerError> =>
    pipe(
      this.getAudioElement(consumerId),
      Effect.map(audioElement => ({
        playing: !audioElement.paused,
        volume: audioElement.volume,
        muted: audioElement.muted,
        currentTime: audioElement.currentTime,
      }))
    )
}

/**
 * Global consumer manager instance
 */
export const consumerManager = new ConsumerManager()

/**
 * Utility to check if consumer is audio
 */
export const isAudioConsumer = (consumer: types.Consumer): boolean => 
  consumer.kind === 'audio'

/**
 * Utility to format consumer info for debugging
 */
export const formatConsumerInfo = (consumer: types.Consumer): string => 
  `Consumer ${consumer.id}: ${consumer.kind}, paused=${consumer.paused}, closed=${consumer.closed}`

/**
 * Utility to create audio visualization data
 */
export const createAudioAnalyzer = (
  consumerId: string
): Effect.Effect<AnalyserNode | null, ConsumerError> =>
  pipe(
    consumerManager.getConsumer(consumerId),
    Effect.map(consumer => {
      if (consumer.kind !== 'audio' || !consumer.track) {
        return null
      }

      try {
        const audioContext = new AudioContext()
        const source = audioContext.createMediaStreamSource(
          new MediaStream([consumer.track])
        )
        const analyser = audioContext.createAnalyser()
        
        analyser.fftSize = 256
        source.connect(analyser)
        
        return analyser
      } catch (error) {
        return null
      }
    })
  )