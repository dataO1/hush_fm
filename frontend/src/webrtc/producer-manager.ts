import { Effect, pipe } from 'effect'
import type { types } from 'mediasoup-client'
import type { ProducerState } from '../providers/WebRTCProvider'

/**
 * Producer-specific errors
 */
export class ProducerError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message)
    this.name = 'ProducerError'
  }
}

export class ProducerNotFoundError extends ProducerError {
  constructor(producerId: string) {
    super(`Producer not found: ${producerId}`)
    this.name = 'ProducerNotFoundError'
  }
}

/**
 * Producer manager for audio streaming
 */
export class ProducerManager {
  private producers = new Map<string, types.Producer>()

  /**
   * Register a new producer
   */
  registerProducer = (
    producer: types.Producer,
    track: MediaStreamTrack
  ): Effect.Effect<ProducerState, ProducerError> =>
    pipe(
      Effect.sync(() => {
        this.producers.set(producer.id, producer)
        
        const producerState: ProducerState = {
          id: producer.id,
          kind: producer.kind as 'audio' | 'video',
          paused: producer.paused,
          track,
          producer,
        }

        // Set up event handlers
        this.setupProducerEvents(producer)

        return producerState
      }),
      Effect.tap(() => 
        Effect.logInfo(`Registered producer: ${producer.id} (${producer.kind})`)
      )
    )

  /**
   * Get producer by ID
   */
  getProducer = (producerId: string): Effect.Effect<types.Producer, ProducerNotFoundError> => {
    const producer = this.producers.get(producerId)
    return producer 
      ? Effect.succeed(producer)
      : Effect.fail(new ProducerNotFoundError(producerId))
  }

  /**
   * Pause producer
   */
  pauseProducer = (producerId: string): Effect.Effect<void, ProducerError> =>
    pipe(
      this.getProducer(producerId),
      Effect.andThen(producer =>
        Effect.tryPromise({
          try: async () => {
            await producer.pause()
          },
          catch: (error) => new ProducerError(
            `Failed to pause producer ${producerId}: ${error instanceof Error ? error.message : String(error)}`,
            error
          )
        })
      ),
      Effect.tap(() => Effect.logInfo(`Paused producer: ${producerId}`))
    )

  /**
   * Resume producer
   */
  resumeProducer = (producerId: string): Effect.Effect<void, ProducerError> =>
    pipe(
      this.getProducer(producerId),
      Effect.andThen(producer =>
        Effect.tryPromise({
          try: async () => {
            await producer.resume()
          },
          catch: (error) => new ProducerError(
            `Failed to resume producer ${producerId}: ${error instanceof Error ? error.message : String(error)}`,
            error
          )
        })
      ),
      Effect.tap(() => Effect.logInfo(`Resumed producer: ${producerId}`))
    )

  /**
   * Close producer and clean up
   */
  closeProducer = (producerId: string): Effect.Effect<void, ProducerError> =>
    pipe(
      this.getProducer(producerId),
      Effect.andThen(producer =>
        Effect.sync(() => {
          producer.close()
          this.producers.delete(producerId)
        })
      ),
      Effect.catchAll(() => 
        // Even if producer not found, clean up store
        Effect.sync(() => {
          this.producers.delete(producerId)
        })
      ),
      Effect.tap(() => Effect.logInfo(`Closed producer: ${producerId}`))
    )

  /**
   * Get producer statistics
   */
  getProducerStats = (producerId: string): Effect.Effect<any, ProducerError> =>
    pipe(
      this.getProducer(producerId),
      Effect.andThen(producer =>
        Effect.tryPromise({
          try: () => producer.getStats(),
          catch: (error) => new ProducerError(
            `Failed to get stats for producer ${producerId}: ${error instanceof Error ? error.message : String(error)}`,
            error
          )
        })
      ),
      Effect.tap(() => Effect.logDebug(`Retrieved stats for producer: ${producerId}`))
    )

  /**
   * Replace track for producer
   */
  replaceProducerTrack = (
    producerId: string, 
    newTrack: MediaStreamTrack
  ): Effect.Effect<void, ProducerError> =>
    pipe(
      this.getProducer(producerId),
      Effect.andThen(producer =>
        Effect.tryPromise({
          try: async () => {
            await producer.replaceTrack({ track: newTrack })
          },
          catch: (error) => new ProducerError(
            `Failed to replace track for producer ${producerId}: ${error instanceof Error ? error.message : String(error)}`,
            error
          )
        })
      ),
      Effect.tap(() => Effect.logInfo(`Replaced track for producer: ${producerId}`))
    )

  /**
   * Set up event handlers for producer
   */
  private setupProducerEvents(producer: types.Producer): void {
    // Track ended
    producer.on('trackended', () => {
      Effect.runSync(
        Effect.all([
          Effect.logInfo(`Producer track ended: ${producer.id}`),
          this.closeProducer(producer.id)
        ])
      )
    })

    // Transport closed
    producer.on('transportclose', () => {
      Effect.runSync(
        Effect.all([
          Effect.logInfo(`Producer transport closed: ${producer.id}`),
          this.closeProducer(producer.id)
        ])
      )
    })
  }

  /**
   * List all active producers
   */
  listProducers = (): Effect.Effect<types.Producer[], never> =>
    Effect.sync(() => Array.from(this.producers.values()))

  /**
   * Close all producers
   */
  closeAllProducers = (): Effect.Effect<void, never> =>
    pipe(
      this.listProducers(),
      Effect.andThen(producers =>
        Effect.all(
          producers.map(producer => 
            pipe(
              this.closeProducer(producer.id),
              Effect.catchAll(() => Effect.void)
            )
          ),
          { concurrency: 'unbounded' }
        )
      ),
      Effect.andThen(() => Effect.void),
      Effect.tap(() => Effect.logInfo('Closed all producers'))
    )

  /**
   * Get audio level from producer track
   */
  getAudioLevel = (producerId: string): Effect.Effect<number, ProducerError> =>
    pipe(
      this.getProducer(producerId),
      Effect.andThen(producer => {
        if (producer.kind !== 'audio' || !producer.track) {
          return Effect.fail(new ProducerError('Producer is not audio or has no track'))
        }

        // This would require additional audio analysis
        // For now, return a placeholder
        return Effect.succeed(0)
      })
    )
}

/**
 * Global producer manager instance
 */
export const producerManager = new ProducerManager()

/**
 * Utility to check if producer is audio
 */
export const isAudioProducer = (producer: types.Producer): boolean => 
  producer.kind === 'audio'

/**
 * Utility to format producer info for debugging
 */
export const formatProducerInfo = (producer: types.Producer): string => 
  `Producer ${producer.id}: ${producer.kind}, paused=${producer.paused}, closed=${producer.closed}`