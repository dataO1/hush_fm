/**
 * MediaSoup Infrastructure Client
 *
 * Pure technical layer for MediaSoup operations.
 * No business logic - only handles MediaSoup API interactions.
 *
 * Responsibilities:
 * - Device creation and management
 * - Transport creation and connection
 * - Producer/Consumer creation
 * - Raw MediaSoup API calls
 * - Technical error handling
 */

import { Effect, pipe, Context, Layer, Data, Option as O } from 'effect'
import { Device, types } from 'mediasoup-client'

// Import schema types only for our domain types
import type {
  TransportOptionsType,
  ConsumerOptionsType
} from '../../domain/schemas/shared/mediasoup.schema'

/**
 * MediaSoup Infrastructure Error
 * Uses Effect Data.TaggedError for proper error handling
 */
export class MediaSoupError extends Data.TaggedError('MediaSoupError')<{
  readonly cause: string
  readonly operation: string
  readonly deviceState?: 'not-loaded' | 'loading' | 'loaded'
  readonly transportState?: string
  readonly timestamp: Date
}> {}

/**
 * MediaSoup Client Interface
 * Manages MediaSoup resources internally as single source of truth
 */
export interface MediaSoupClientInterface {
  /**
   * Initialize device with RTP capabilities
   */
  readonly initDevice: (rtpCapabilities: types.RtpCapabilities) => Effect.Effect<void, MediaSoupError>

  /**
   * Create send transport for DJ
   */
  readonly createSendTransport: (options: TransportOptionsType) => Effect.Effect<types.Transport, MediaSoupError>

  /**
   * Create receive transport for listener
   */
  readonly createReceiveTransport: (options: TransportOptionsType) => Effect.Effect<types.Transport, MediaSoupError>

  /**
   * Connect the active transport
   */
  readonly connectActiveTransport: (dtlsParameters: types.DtlsParameters) => Effect.Effect<void, MediaSoupError>

  /**
   * Create producer from audio track
   */
  readonly createProducer: (
    track: MediaStreamTrack,
    options?: {
      encodings?: types.RtpEncodingParameters[]
      codecOptions?: types.ProducerCodecOptions
      codec?: types.RtpCodecCapability
    }
  ) => Effect.Effect<types.Producer, MediaSoupError>

  /**
   * Create consumer for listening
   */
  readonly createConsumer: (options: ConsumerOptionsType) => Effect.Effect<types.Consumer, MediaSoupError>

  /**
   * Pause/resume producer
   */
  readonly pauseProducer: () => Effect.Effect<void, MediaSoupError>
  readonly resumeProducer: () => Effect.Effect<void, MediaSoupError>

  /**
   * Get current device RTP capabilities
   */
  readonly getDeviceCapabilities: () => Effect.Effect<types.RtpCapabilities, MediaSoupError>

  /**
   * Check if device can produce media kind
   */
  readonly canProduce: (kind: types.MediaKind) => Effect.Effect<boolean, MediaSoupError>

  /**
   * Get current resources
   */
  readonly getCurrentDevice: () => O.Option<Device>
  readonly getCurrentTransport: () => O.Option<types.Transport>
  readonly getCurrentProducer: () => O.Option<types.Producer>
  readonly getCurrentConsumer: () => O.Option<types.Consumer>

  /**
   * Clean up all resources
   */
  readonly cleanup: () => Effect.Effect<void, never>
}

/**
 * MediaSoup Client Context Tag
 *
 * Services import and use this tag for dependency injection.
 * Uses modern Effect-TS class-based Tag syntax.
 */
export class MediaSoupClient extends Context.Tag("@app/infrastructure/MediaSoupClient")<
  MediaSoupClient,
  MediaSoupClientInterface
>() {}

/**
 * MediaSoup Client Implementation
 * Stores MediaSoup resources as private Effect Option fields
 */
const createMediaSoupClientImpl = (): MediaSoupClientInterface => {
  // Private state - single source of truth for MediaSoup resources
  let device = O.none<Device>()
  let activeTransport = O.none<types.Transport>()
  let activeProducer = O.none<types.Producer>()
  let activeConsumer = O.none<types.Consumer>()

  return {
    /**
     * Initialize device with RTP capabilities
     */
    initDevice: (rtpCapabilities: types.RtpCapabilities) =>
      pipe(
        Effect.sync(() => new Device()),
        Effect.andThen(newDevice =>
          pipe(
            Effect.tryPromise({
              try: () => newDevice.load({ routerRtpCapabilities: rtpCapabilities }),
              catch: error => new MediaSoupError({
                cause: String(error),
                operation: 'initDevice',
                deviceState: 'loading',
                timestamp: new Date()
              })
            }),
            Effect.map(() => {
              device = O.some(newDevice)
            })
          )
        ),
        Effect.catchAll(error =>
          error instanceof MediaSoupError
            ? Effect.fail(error)
            : Effect.fail(new MediaSoupError({
                cause: String(error),
                operation: 'initDevice',
                timestamp: new Date()
              }))
        )
      ),

    /**
     * Create send transport for DJ
     */
    createSendTransport: (options: TransportOptionsType) =>
      pipe(
        device,
        O.match({
          onNone: () => Effect.fail(new MediaSoupError({
            cause: 'Device not initialized',
            operation: 'createSendTransport',
            deviceState: 'not-loaded',
            timestamp: new Date()
          })),
          onSome: (dev) =>
            pipe(
              Effect.sync(() => {
                if (!dev.loaded) {
                  throw new MediaSoupError({
                    cause: 'Device not loaded',
                    operation: 'createSendTransport',
                    deviceState: 'not-loaded',
                    timestamp: new Date()
                  })
                }

                const transport = dev.createSendTransport({
                  id: options.id,
                  iceParameters: options.iceParameters as types.IceParameters,
                  iceCandidates: options.iceCandidates as types.IceCandidate[],
                  dtlsParameters: options.dtlsParameters as types.DtlsParameters,
                  sctpParameters: undefined
                })

                activeTransport = O.some(transport)
                return transport
              }),
              Effect.catchAll(error =>
                Effect.fail(
                  error instanceof MediaSoupError
                    ? error
                    : new MediaSoupError({
                        cause: String(error),
                        operation: 'createSendTransport',
                        timestamp: new Date()
                      })
                )
              )
            )
        })
      ),

    /**
     * Create receive transport for listener
     */
    createReceiveTransport: (options: TransportOptionsType) =>
      pipe(
        device,
        O.match({
          onNone: () => Effect.fail(new MediaSoupError({
            cause: 'Device not initialized',
            operation: 'createReceiveTransport',
            deviceState: 'not-loaded',
            timestamp: new Date()
          })),
          onSome: (dev) =>
            pipe(
              Effect.sync(() => {
                if (!dev.loaded) {
                  throw new MediaSoupError({
                    cause: 'Device not loaded',
                    operation: 'createReceiveTransport',
                    deviceState: 'not-loaded',
                    timestamp: new Date()
                  })
                }

                const transport = dev.createRecvTransport({
                  id: options.id,
                  iceParameters: options.iceParameters as types.IceParameters,
                  iceCandidates: options.iceCandidates as types.IceCandidate[],
                  dtlsParameters: options.dtlsParameters as types.DtlsParameters,
                  sctpParameters:  undefined
                })

                activeTransport = O.some(transport)
                return transport
              }),
              Effect.catchAll(error =>
                Effect.fail(
                  error instanceof MediaSoupError
                    ? error
                    : new MediaSoupError({
                        cause: String(error),
                        operation: 'createReceiveTransport',
                        timestamp: new Date()
                      })
                )
              )
            )
        })
      ),

    /**
     * Connect the active transport
     */
    connectActiveTransport: (dtlsParameters: types.DtlsParameters) =>
      pipe(
        activeTransport,
        O.match({
          onNone: () => Effect.fail(new MediaSoupError({
            cause: 'No active transport to connect',
            operation: 'connectActiveTransport',
            timestamp: new Date()
          })),
          onSome: (transport) =>
            Effect.tryPromise({
              try: () => transport.connect({ dtlsParameters }),
              catch: error => new MediaSoupError({
                cause: String(error),
                operation: 'connectActiveTransport',
                transportState: transport.connectionState,
                timestamp: new Date()
              })
            })
        })
      ),

    /**
     * Create producer from audio track
     */
    createProducer: (track: MediaStreamTrack, options?: {
      encodings?: types.RtpEncodingParameters[]
      codecOptions?: types.ProducerCodecOptions
      codec?: types.RtpCodecCapability
    }) =>
      pipe(
        activeTransport,
        O.match({
          onNone: () => Effect.fail(new MediaSoupError({
            cause: 'No active transport for producer',
            operation: 'createProducer',
            timestamp: new Date()
          })),
          onSome: (transport) =>
            pipe(
              Effect.tryPromise({
                try: () => transport.produce({
                  track,
                  ...options
                }),
                catch: error => new MediaSoupError({
                  cause: String(error),
                  operation: 'createProducer',
                  transportState: transport.connectionState,
                  timestamp: new Date()
                })
              }),
              Effect.map(producer => {
                activeProducer = O.some(producer)
                return producer
              })
            )
        })
      ),

    /**
     * Create consumer for listening
     */
    createConsumer: (options: ConsumerOptionsType) =>
      pipe(
        activeTransport,
        O.match({
          onNone: () => Effect.fail(new MediaSoupError({
            cause: 'No active transport for consumer',
            operation: 'createConsumer',
            timestamp: new Date()
          })),
          onSome: (transport) =>
            pipe(
              Effect.tryPromise({
                try: () => transport.consume({
                  id: options.id,
                  producerId: options.producerId,
                  kind: options.kind as types.MediaKind,
                  rtpParameters: options.rtpParameters as types.RtpParameters
                }),
                catch: error => new MediaSoupError({
                  cause: String(error),
                  operation: 'createConsumer',
                  transportState: transport.connectionState,
                  timestamp: new Date()
                })
              }),
              Effect.map(consumer => {
                activeConsumer = O.some(consumer)
                return consumer
              })
            )
        })
      ),

    /**
     * Pause producer
     */
    pauseProducer: () =>
      pipe(
        activeProducer,
        O.match({
          onNone: () => Effect.fail(new MediaSoupError({
            cause: 'No active producer to pause',
            operation: 'pauseProducer',
            timestamp: new Date()
          })),
          onSome: (producer) => Effect.sync(() => {
            if (!producer.paused) {
              producer.pause()
            }
          })
        })
      ),

    /**
     * Resume producer
     */
    resumeProducer: () =>
      pipe(
        activeProducer,
        O.match({
          onNone: () => Effect.fail(new MediaSoupError({
            cause: 'No active producer to resume',
            operation: 'resumeProducer',
            timestamp: new Date()
          })),
          onSome: (producer) => Effect.sync(() => {
            if (producer.paused) {
              producer.resume()
            }
          })
        })
      ),

    /**
     * Get current device RTP capabilities
     */
    getDeviceCapabilities: () =>
      pipe(
        device,
        O.match({
          onNone: () => Effect.fail(new MediaSoupError({
            cause: 'Device not initialized',
            operation: 'getDeviceCapabilities',
            deviceState: 'not-loaded',
            timestamp: new Date()
          })),
          onSome: (dev) =>
            Effect.sync(() => {
              if (!dev.loaded) {
                throw new MediaSoupError({
                  cause: 'Device not loaded',
                  operation: 'getDeviceCapabilities',
                  deviceState: 'not-loaded',
                  timestamp: new Date()
                })
              }
              return dev.rtpCapabilities
            })
        })
      ),

    /**
     * Check if device can produce media kind
     */
    canProduce: (kind: types.MediaKind) =>
      pipe(
        device,
        O.match({
          onNone: () => Effect.fail(new MediaSoupError({
            cause: 'Device not initialized',
            operation: 'canProduce',
            deviceState: 'not-loaded',
            timestamp: new Date()
          })),
          onSome: (dev) =>
            Effect.sync(() => {
              if (!dev.loaded) {
                throw new MediaSoupError({
                  cause: 'Device not loaded',
                  operation: 'canProduce',
                  deviceState: 'not-loaded',
                  timestamp: new Date()
                })
              }
              return dev.canProduce(kind)
            })
        })
      ),

    /**
     * Get current device
     */
    getCurrentDevice: () => device,

    /**
     * Get current transport
     */
    getCurrentTransport: () => activeTransport,

    /**
     * Get current producer
     */
    getCurrentProducer: () => activeProducer,

    /**
     * Get current consumer
     */
    getCurrentConsumer: () => activeConsumer,

    /**
     * Clean up all resources
     */
    cleanup: () => Effect.sync(() => {
      // Close producer
      pipe(
        activeProducer,
        O.map(producer => {
          try {
            if (!producer.closed) producer.close()
          } catch {}
        })
      )
      activeProducer = O.none()

      // Close consumer
      pipe(
        activeConsumer,
        O.map(consumer => {
          try {
            if (!consumer.closed) consumer.close()
          } catch {}
        })
      )
      activeConsumer = O.none()

      // Close transport
      pipe(
        activeTransport,
        O.map(transport => {
          try {
            if (transport.connectionState !== 'closed') transport.close()
          } catch {}
        })
      )
      activeTransport = O.none()

      // Clear device
      device = O.none()
    })
  }
}

/**
 * MediaSoup Client Layer
 *
 * Live implementation layer that provides the MediaSoupClient.
 * Use this in your app's main Layer composition.
 */
export const MediaSoupClientLive = Layer.succeed(
  MediaSoupClient,
  createMediaSoupClientImpl()
)
