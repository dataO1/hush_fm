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

import { Effect, pipe, Context, Layer } from 'effect'
import { Device, types } from 'mediasoup-client'

/**
 * MediaSoup transport options from API
 */
export interface TransportOptions {
  id: string
  iceParameters: types.IceParameters
  iceCandidates: types.IceCandidate[]
  dtlsParameters: types.DtlsParameters
  sctpParameters?: types.SctpParameters
}

/**
 * MediaSoup produce options
 */
export interface ProduceOptions {
  kind: types.MediaKind
  rtpParameters: types.RtpParameters
  paused?: boolean
  codecOptions?: types.ProducerCodecOptions
}

/**
 * MediaSoup consume options  
 */
export interface ConsumeOptions {
  id: string
  producerId: string
  kind: types.MediaKind
  rtpParameters: types.RtpParameters
  paused?: boolean
}

/**
 * MediaSoup Infrastructure Error
 */
export class MediaSoupInfrastructureError extends Error {
  constructor(
    message: string,
    public operation: string,
    public cause?: unknown
  ) {
    super(message)
    this.name = 'MediaSoupInfrastructureError'
  }
}

/**
 * MediaSoup Client Interface
 */
export interface MediaSoupClient {
  /**
   * Create and load device
   */
  readonly createDevice: (rtpCapabilities: types.RtpCapabilities) => Effect.Effect<Device, MediaSoupInfrastructureError>
  
  /**
   * Create send transport
   */
  readonly createSendTransport: (device: Device, options: TransportOptions) => Effect.Effect<types.Transport, MediaSoupInfrastructureError>
  
  /**
   * Create receive transport
   */
  readonly createReceiveTransport: (device: Device, options: TransportOptions) => Effect.Effect<types.Transport, MediaSoupInfrastructureError>
  
  /**
   * Connect transport
   */
  readonly connectTransport: (transport: types.Transport, dtlsParameters: types.DtlsParameters) => Effect.Effect<void, MediaSoupInfrastructureError>
  
  /**
   * Create producer
   */
  readonly createProducer: (transport: types.Transport, track: MediaStreamTrack, options?: Partial<ProduceOptions>) => Effect.Effect<types.Producer, MediaSoupInfrastructureError>
  
  /**
   * Create consumer
   */
  readonly createConsumer: (transport: types.Transport, options: ConsumeOptions) => Effect.Effect<types.Consumer, MediaSoupInfrastructureError>
  
  /**
   * Close transport
   */
  readonly closeTransport: (transport: types.Transport) => Effect.Effect<void, never>
  
  /**
   * Close producer
   */
  readonly closeProducer: (producer: types.Producer) => Effect.Effect<void, never>
  
  /**
   * Close consumer
   */
  readonly closeConsumer: (consumer: types.Consumer) => Effect.Effect<void, never>
  
  /**
   * Get device capabilities
   */
  readonly getDeviceCapabilities: (device: Device) => Effect.Effect<types.RtpCapabilities, MediaSoupInfrastructureError>
  
  /**
   * Check if device can produce
   */
  readonly canProduce: (device: Device, kind: types.MediaKind) => Effect.Effect<boolean, MediaSoupInfrastructureError>
}

/**
 * MediaSoup Client Implementation
 */
/**
 * MediaSoup Client Context Tag
 * 
 * Services import and use this tag for dependency injection.
 * Uses the same name as the interface for clean imports.
 */
export class MediaSoupClient extends Context.Tag("@app/infrastructure/MediaSoupClient")<
  MediaSoupClient,
  MediaSoupClient
>() {}

/**
 * MediaSoup Client Implementation
 */
const MediaSoupClientImpl: MediaSoupClient = {
  /**
   * Create and load MediaSoup device
   */
  createDevice: (rtpCapabilities: types.RtpCapabilities): Effect.Effect<Device, MediaSoupInfrastructureError> =>
    pipe(
      Effect.sync(() => new Device()),
      Effect.andThen(device =>
        pipe(
          Effect.tryPromise({
            try: () => device.load({ routerRtpCapabilities: rtpCapabilities }),
            catch: error => new MediaSoupInfrastructureError(
              'Failed to load device',
              'createDevice',
              error
            )
          }),
          Effect.map(() => device)
        )
      ),
      Effect.catchAll(error =>
        Effect.fail(error instanceof MediaSoupInfrastructureError 
          ? error 
          : new MediaSoupInfrastructureError(
              'Failed to create device',
              'createDevice',
              error
            )
        )
      )
    ),

  /**
   * Create send transport
   */
  createSendTransport: (device: Device, options: TransportOptions): Effect.Effect<types.Transport, MediaSoupInfrastructureError> =>
    pipe(
      Effect.sync(() => {
        if (!device.loaded) {
          throw new MediaSoupInfrastructureError(
            'Device not loaded',
            'createSendTransport'
          )
        }
        
        return device.createSendTransport({
          id: options.id,
          iceParameters: options.iceParameters,
          iceCandidates: options.iceCandidates,
          dtlsParameters: options.dtlsParameters,
          sctpParameters: options.sctpParameters
        })
      }),
      Effect.catchAll(error =>
        Effect.fail(new MediaSoupInfrastructureError(
          'Failed to create send transport',
          'createSendTransport',
          error
        ))
      )
    ),

  /**
   * Create receive transport
   */
  createReceiveTransport: (device: Device, options: TransportOptions): Effect.Effect<types.Transport, MediaSoupInfrastructureError> =>
    pipe(
      Effect.sync(() => {
        if (!device.loaded) {
          throw new MediaSoupInfrastructureError(
            'Device not loaded',
            'createReceiveTransport'
          )
        }
        
        return device.createRecvTransport({
          id: options.id,
          iceParameters: options.iceParameters,
          iceCandidates: options.iceCandidates,
          dtlsParameters: options.dtlsParameters,
          sctpParameters: options.sctpParameters
        })
      }),
      Effect.catchAll(error =>
        Effect.fail(new MediaSoupInfrastructureError(
          'Failed to create receive transport',
          'createReceiveTransport',
          error
        ))
      )
    ),

  /**
   * Connect transport
   */
  connectTransport: (transport: types.Transport, dtlsParameters: types.DtlsParameters): Effect.Effect<void, MediaSoupInfrastructureError> =>
    pipe(
      Effect.tryPromise({
        try: () => transport.connect({ dtlsParameters }),
        catch: error => new MediaSoupInfrastructureError(
          'Failed to connect transport',
          'connectTransport',
          error
        )
      })
    ),

  /**
   * Create producer
   */
  createProducer: (transport: types.Transport, track: MediaStreamTrack, options?: Partial<ProduceOptions>): Effect.Effect<types.Producer, MediaSoupInfrastructureError> =>
    pipe(
      Effect.tryPromise({
        try: () => transport.produce({
          track,
          ...options
        }),
        catch: error => new MediaSoupInfrastructureError(
          'Failed to create producer',
          'createProducer',
          error
        )
      })
    ),

  /**
   * Create consumer
   */
  createConsumer: (transport: types.Transport, options: ConsumeOptions): Effect.Effect<types.Consumer, MediaSoupInfrastructureError> =>
    pipe(
      Effect.tryPromise({
        try: () => transport.consume({
          id: options.id,
          producerId: options.producerId,
          kind: options.kind,
          rtpParameters: options.rtpParameters
        }),
        catch: error => new MediaSoupInfrastructureError(
          'Failed to create consumer',
          'createConsumer',
          error
        )
      })
    ),

  /**
   * Close transport
   */
  closeTransport: (transport: types.Transport): Effect.Effect<void, never> =>
    Effect.sync(() => {
      try {
        transport.close()
      } catch {
        // Ignore errors when closing
      }
    }),

  /**
   * Close producer
   */
  closeProducer: (producer: types.Producer): Effect.Effect<void, never> =>
    Effect.sync(() => {
      try {
        producer.close()
      } catch {
        // Ignore errors when closing
      }
    }),

  /**
   * Close consumer
   */
  closeConsumer: (consumer: types.Consumer): Effect.Effect<void, never> =>
    Effect.sync(() => {
      try {
        consumer.close()
      } catch {
        // Ignore errors when closing
      }
    }),

  /**
   * Get device RTP capabilities
   */
  getDeviceCapabilities: (device: Device): Effect.Effect<types.RtpCapabilities, MediaSoupInfrastructureError> =>
    pipe(
      Effect.sync(() => {
        if (!device.loaded) {
          throw new MediaSoupInfrastructureError(
            'Device not loaded',
            'getDeviceCapabilities'
          )
        }
        return device.rtpCapabilities
      }),
      Effect.catchAll(error =>
        Effect.fail(new MediaSoupInfrastructureError(
          'Failed to get device capabilities',
          'getDeviceCapabilities',
          error
        ))
      )
    ),

  /**
   * Check if device can produce media
   */
  canProduce: (device: Device, kind: types.MediaKind): Effect.Effect<boolean, MediaSoupInfrastructureError> =>
    pipe(
      Effect.sync(() => {
        if (!device.loaded) {
          throw new MediaSoupInfrastructureError(
            'Device not loaded',
            'canProduce'
          )
        }
        return device.canProduce(kind)
      }),
      Effect.catchAll(error =>
        Effect.fail(new MediaSoupInfrastructureError(
          'Failed to check device produce capability',
          'canProduce',
          error
        ))
      )
    )
}

/**
 * MediaSoup Client Service Layer
 */
/**
 * MediaSoup Client Layer
 * 
 * Live implementation layer that provides the MediaSoupClient.
 * Use this in your app's main Layer composition.
 */
export const MediaSoupClientLive = Layer.succeed(
  MediaSoupClient,
  MediaSoupClientImpl
)

/**
 * Convenience functions for common MediaSoup operations
 */
export namespace MSClient {
  /**
   * Create device with error handling
   */
  export const createDeviceWithCapabilities = (rtpCapabilities: types.RtpCapabilities) =>
    pipe(
      MediaSoupClientLive.createDevice(rtpCapabilities),
      Effect.tap(device => 
        Effect.logInfo(`MediaSoup device created: ${device.handlerName}`)
      )
    )

  /**
   * Check if browser supports MediaSoup
   */
  export const isSupported = () =>
    Effect.sync(() => Device.isSupported())

  /**
   * Get device info
   */
  export const getDeviceInfo = (device: Device) =>
    Effect.sync(() => ({
      loaded: device.loaded,
      handlerName: device.handlerName,
      canProduceAudio: device.canProduce('audio'),
      canProduceVideo: device.canProduce('video'),
      rtpCapabilities: device.loaded ? device.rtpCapabilities : null
    }))
}