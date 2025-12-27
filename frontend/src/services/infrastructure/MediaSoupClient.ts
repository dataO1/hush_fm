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

import { Effect, pipe, Context, Layer, Data, Option as O, Deferred } from 'effect'
import { Device, types } from 'mediasoup-client'

// Import schema types only for our domain types
import type {
  TransportOptionsType,
  ConsumerOptionsType
} from '../../domain/schemas/shared/mediasoup.schema'

// Import connection state management
import { ConnectionAdapter } from '../../stores/connection/connection.adapter'
import { WebrtcConnectionState, TransportError, ProducerError } from '../../domain/schemas/connection.schema'

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
   * Create send transport for DJ with event handlers
   */
  readonly createSendTransport: (
    options: TransportOptionsType,
    handlers?: {
      onConnect?: (dtlsParameters: types.DtlsParameters) => Promise<void>
      onProduce?: (rtpParameters: types.RtpParameters, kind: types.MediaKind) => Promise<string>
    }
  ) => Effect.Effect<types.Transport, MediaSoupError>

  /**
   * Create receive transport for listener
   */
  readonly createReceiveTransport: (
    options: TransportOptionsType,
    handlers?: {
      onConnect?: (dtlsParameters: types.DtlsParameters) => Promise<void>
    }
  ) => Effect.Effect<types.Transport, MediaSoupError>

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
   * Consumer auto-reconnection
   */
  readonly setConsumerRecreateCallback: (
    callback: () => Effect.Effect<ConsumerOptionsType, Error>
  ) => Effect.Effect<void, never>

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
const createMediaSoupClientImpl = (connectionAdapter: Context.Tag.Service<ConnectionAdapter>): MediaSoupClientInterface => {
  // Private state - single source of truth for MediaSoup resources
  let device = O.none<Device>()
  let activeTransport = O.none<types.Transport>()
  let activeProducer = O.none<types.Producer>()
  let activeConsumer = O.none<types.Consumer>()
  let connectionTimeoutId = O.none<NodeJS.Timeout>()
  let consumerRecreateCallback = O.none<() => Effect.Effect<ConsumerOptionsType, Error>>()
  
  // Internal connection state tracking (not exposed to adapter)
  let transportConnectionState: RTCPeerConnectionState = 'new'
  let iceGatheringState: RTCIceGatheringState = 'new'
  let connectionDeferred = O.none<Deferred.Deferred<void, Error>>()

  // Helper function to clear connection timeout
  const clearConnectionTimeout = () => {
    pipe(
      connectionTimeoutId,
      O.match({
        onNone: () => {},
        onSome: (timeoutId) => {
          clearTimeout(timeoutId)
          connectionTimeoutId = O.none()
        }
      })
    )
  }

  // Helper function to create connection deferred
  const createConnectionDeferred = () =>
    Effect.gen(function* () {
      const deferred = yield* Deferred.make<void, Error>()
      connectionDeferred = O.some(deferred)
      return deferred
    })

  // Helper function to wait for transport connection (checks current state, then waits for events)
  const waitForConnection = (): Effect.Effect<void, Error> => {
    // Check current state first
    if (transportConnectionState === 'connected') {
      console.info('🔗 MediaSoup: Connection already established')
      return Effect.succeed(undefined)
    }
    
    if (transportConnectionState === 'failed' || transportConnectionState === 'closed') {
      const errorMsg = `Transport connection failed: state is ${transportConnectionState}`
      console.error('❌ MediaSoup:', errorMsg)
      return Effect.fail(new Error(errorMsg))
    }
    
    // Still connecting - wait for the deferred that was set up earlier
    return pipe(
      connectionDeferred,
      O.match({
        onNone: () => {
          // No deferred exists - this shouldn't happen if createConnectionDeferred was called earlier
          const errorMsg = `No connection deferred found and state is ${transportConnectionState}`
          console.error('❌ MediaSoup:', errorMsg)
          return Effect.fail(new Error(errorMsg))
        },
        onSome: (deferred) => {
          console.info('🔗 MediaSoup: Waiting for connection state change...')
          return Deferred.await(deferred)
        }
      })
    )
  }

  // Helper function to setup connection timeout
  const setupConnectionTimeout = () => {
    clearConnectionTimeout()
    
    const timeoutId = setTimeout(() => {
      // Check actual connection state before setting error
      const isCurrentlyConnected = connectionAdapter.isConnected()
      
      if (!isCurrentlyConnected) {
        const error = new TransportError({
          cause: 'WebRTC connection timeout after 30 seconds',
          operation: 'connect',
          direction: 'send',
          timestamp: new Date()
        })
        
        connectionAdapter.setConnectionError(error)
        connectionAdapter.setWebRTCState(WebrtcConnectionState.DISCONNECTED)
      }
    }, 30000)
    
    connectionTimeoutId = O.some(timeoutId)
  }

  // Helper function to handle transport events
  const handleTransportEvents = (transport: types.Transport) => {
    // Handle connection state changes
    transport.on('connectionstatechange', (state) => {
      console.info('🔄 MediaSoup: Transport connection state changed:', state)
      
      // Update internal state
      transportConnectionState = state as RTCPeerConnectionState
      
      switch (state) {
        case 'connecting':
          connectionAdapter.setWebRTCState(WebrtcConnectionState.CONNECTING)
          break
        case 'connected':
          clearConnectionTimeout()
          connectionAdapter.setWebRTCState(WebrtcConnectionState.CONNECTED)
          connectionAdapter.clearError()
          
          // Resolve connection deferred if waiting
          pipe(
            connectionDeferred,
            O.map((deferred) => {
              Effect.runSync(Deferred.succeed(deferred, undefined))
              connectionDeferred = O.none() // Clear the deferred
            })
          )
          break
        case 'failed':
        case 'closed':
          clearConnectionTimeout()
          
          // Set error state with proper error information
          const transportError = new TransportError({
            cause: `WebRTC connection ${state}: ICE gathering state was ${iceGatheringState}. This usually indicates network connectivity issues or missing STUN server configuration.`,
            operation: 'connect',
            direction: 'send', // Will be overridden by specific producer/consumer context
            timestamp: new Date()
          })
          
          connectionAdapter.setConnectionError(transportError)
          connectionAdapter.setWebRTCState(WebrtcConnectionState.ERROR)
          
          // Reject connection deferred if waiting
          pipe(
            connectionDeferred,
            O.map((deferred) => {
              Effect.runSync(Deferred.fail(deferred, new Error(`Transport connection ${state}: ICE gathering state was ${iceGatheringState}`)))
              connectionDeferred = O.none() // Clear the deferred
            })
          )
          break
        case 'disconnected':
          connectionAdapter.setWebRTCState(WebrtcConnectionState.DISCONNECTING)
          break
      }
    })

    // Handle ICE gathering state changes
    transport.on('icegatheringstatechange', (state) => {
      console.info('🧊 MediaSoup: ICE gathering state changed:', state)
      
      // Update internal state
      iceGatheringState = state as RTCIceGatheringState
      
      // Additional connection validation for ICE complete
      if (state === 'complete' && transport.connectionState === 'connected') {
        connectionAdapter.setWebRTCState(WebrtcConnectionState.CONNECTED)
      }
    })

    // Note: MediaSoup transport doesn't expose iceconnectionstatechange
    // We rely on connectionstatechange for ICE connection status

    // Handle ICE candidate errors for debugging
    transport.on('icecandidateerror', (event) => {
      console.warn('⚠️ MediaSoup: ICE candidate error:', event)
    })
  }

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
     * Create send transport for DJ with event handlers
     */
    createSendTransport: (options: TransportOptionsType, handlers?: {
      onConnect?: (dtlsParameters: types.DtlsParameters) => Promise<void>
      onProduce?: (rtpParameters: types.RtpParameters, kind: types.MediaKind) => Promise<string>
    }) =>
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

                // Set up event handlers if provided
                if (handlers?.onConnect) {
                  transport.on('connect', ({ dtlsParameters }, callback, errback) => {
                    console.info('🔗 MediaSoup: Transport connect event fired')
                    
                    handlers.onConnect!(dtlsParameters)
                      .then(() => {
                        console.info('✅ MediaSoup: Transport connect callback succeeded')
                        callback()
                      })
                      .catch((error) => {
                        console.error('❌ MediaSoup: Transport connect callback failed:', error)
                        // Update connection state on error
                        connectionAdapter.setWebRTCState(WebrtcConnectionState.ERROR)
                        connectionAdapter.setConnectionError(new TransportError({
                          cause: `Transport connect failed: ${String(error)}`,
                          operation: 'connect',
                          direction: 'send',
                          timestamp: new Date()
                        }))
                        errback(error)
                      })
                  })
                }

                if (handlers?.onProduce) {
                  transport.on('produce', ({ kind, rtpParameters }, callback, errback) => {
                    console.info('🎤 MediaSoup: Transport produce event fired', { kind })
                    
                    handlers.onProduce!(rtpParameters, kind as types.MediaKind)
                      .then((producerId) => {
                        console.info('✅ MediaSoup: Transport produce callback succeeded', { producerId })
                        callback({ id: producerId })
                      })
                      .catch((error) => {
                        console.error('❌ MediaSoup: Transport produce callback failed:', error)
                        // Update connection state on error
                        connectionAdapter.setWebRTCState(WebrtcConnectionState.ERROR)
                        connectionAdapter.setConnectionError(new TransportError({
                          cause: `Transport produce failed: ${String(error)}`,
                          operation: 'create',
                          direction: 'send',
                          timestamp: new Date()
                        }))
                        errback(error)
                      })
                  })
                }

                // Reset internal state for new transport
                transportConnectionState = 'new'
                iceGatheringState = 'new'
                connectionDeferred = O.none()
                
                // Set up connection state monitoring
                handleTransportEvents(transport)
                setupConnectionTimeout()
                
                // Set initial connecting state
                connectionAdapter.setWebRTCState(WebrtcConnectionState.CONNECTING)
                connectionAdapter.clearError()

                activeTransport = O.some(transport)
                return transport
              }),
              Effect.catchAll(error =>
                Effect.fail(new MediaSoupError({
                  cause: String(error),
                  operation: 'createSendTransport',
                  timestamp: new Date()
                }))
              )
            )
        })
      ),

    /**
     * Create receive transport for listener
     */
    createReceiveTransport: (options: TransportOptionsType, handlers?: {
      onConnect?: (dtlsParameters: types.DtlsParameters) => Promise<void>
    }) =>
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

                // Set up event handlers if provided
                if (handlers?.onConnect) {
                  transport.on('connect', ({ dtlsParameters }, callback, errback) => {
                    handlers.onConnect!(dtlsParameters).then(callback).catch(errback)
                  })
                }

                // Reset internal state for new transport
                transportConnectionState = 'new'
                iceGatheringState = 'new'
                connectionDeferred = O.none()
                
                // Set up connection state monitoring  
                handleTransportEvents(transport)
                setupConnectionTimeout()
                
                // Set initial connecting state
                connectionAdapter.setWebRTCState(WebrtcConnectionState.CONNECTING)
                connectionAdapter.clearError()

                // Subscribe to newproducer event for automatic consumer reconnection
                transport.observer.on('newproducer', (producer) => {
                  console.info('🔄 MediaSoup: New producer detected, attempting consumer reconnection...', { producerId: producer.id })
                  
                  pipe(
                    consumerRecreateCallback,
                    O.match({
                      onNone: () => {
                        console.info('ℹ️ MediaSoup: No consumer recreate callback registered')
                      },
                      onSome: (callback) => {
                        Effect.runPromise(
                          pipe(
                            callback(),
                            Effect.andThen((consumerOptions) => {
                              console.info('🎧 MediaSoup: Recreating consumer with options:', consumerOptions)
                              // Use the transport to create consumer directly since it's available in closure
                              return Effect.tryPromise({
                                try: () => transport.consume({
                                  id: consumerOptions.id,
                                  producerId: consumerOptions.producerId,
                                  kind: consumerOptions.kind as types.MediaKind,
                                  rtpParameters: consumerOptions.rtpParameters as types.RtpParameters
                                }),
                                catch: error => new MediaSoupError({
                                  cause: String(error),
                                  operation: 'createConsumer',
                                  transportState: transport.connectionState,
                                  timestamp: new Date()
                                })
                              }).pipe(
                                Effect.map((consumer) => {
                                  activeConsumer = O.some(consumer)
                                  console.info('✅ MediaSoup: Consumer reconnected successfully')
                                  return consumer
                                })
                              )
                            }),
                            Effect.catchAll((error) => {
                              console.error('❌ MediaSoup: Consumer reconnection failed:', error)
                              return Effect.fail(error)
                            })
                          )
                        ).catch((error) => {
                          console.error('❌ MediaSoup: Consumer reconnection promise failed:', error)
                        })
                      }
                    })
                  )
                })

                activeTransport = O.some(transport)
                return transport
              }),
              Effect.catchAll(error =>
                Effect.fail(new MediaSoupError({
                  cause: String(error),
                  operation: 'createReceiveTransport',
                  timestamp: new Date()
                }))
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
              try: () => (transport as any).connect({ dtlsParameters }),
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
            Effect.gen(function* () {
              console.info('🎵 MediaSoup: Creating producer...', {
                initialConnectionState: transportConnectionState,
                initialIceGatheringState: iceGatheringState
              })
              
              // Set up connection monitoring BEFORE starting producer creation
              if (transportConnectionState !== 'connected') {
                yield* createConnectionDeferred()
              }
              
              // Start producer creation (this will trigger transport.connect event)
              const producer = yield* Effect.tryPromise({
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
              })
              
              // Now wait for the transport connection state to be resolved
              yield* waitForConnection().pipe(
                Effect.mapError(connectionError => {
                  console.error('❌ MediaSoup: Producer waitForConnection failed:', connectionError)
                  return new MediaSoupError({
                    cause: String(connectionError),
                    operation: 'createProducer',
                    transportState: transport.connectionState,
                    timestamp: new Date()
                  })
                })
              )
              
              console.info('✅ MediaSoup: Producer created and transport connected', {
                connectionState: transportConnectionState,
                iceGatheringState: iceGatheringState
              })
              
              // Subscribe to producer lifecycle events
              producer.observer.on('close', () => {
                console.warn('🔌 MediaSoup: Producer closed')
                connectionAdapter.setWebRTCState(WebrtcConnectionState.DISCONNECTED)
              })

              producer.observer.on('trackended', () => {
                console.error('🎤 MediaSoup: Microphone disconnected')
                connectionAdapter.setConnectionError(new ProducerError({
                  cause: 'Microphone disconnected - audio device may have been unplugged',
                  operation: 'close',
                  timestamp: new Date()
                }))
                connectionAdapter.setWebRTCState(WebrtcConnectionState.ERROR)
              })

              
              activeProducer = O.some(producer)
              return producer
            })
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
            Effect.gen(function* () {
              console.info('🎧 MediaSoup: Creating consumer...', {
                initialConnectionState: transportConnectionState,
                initialIceGatheringState: iceGatheringState
              })
              
              // Set up connection monitoring BEFORE starting consumer creation  
              if (transportConnectionState !== 'connected') {
                yield* createConnectionDeferred()
              }
              
              // Start consumer creation (this will trigger transport.connect event)
              const consumer = yield* Effect.tryPromise({
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
              })
              
              // Now wait for the transport connection state to be resolved
              yield* waitForConnection().pipe(
                Effect.mapError(connectionError => {
                  console.error('❌ MediaSoup: Consumer waitForConnection failed:', connectionError)
                  return new MediaSoupError({
                    cause: String(connectionError),
                    operation: 'createConsumer',
                    transportState: transport.connectionState,
                    timestamp: new Date()
                  })
                })
              )
              
              console.info('✅ MediaSoup: Consumer created and transport connected', {
                connectionState: transportConnectionState,
                iceGatheringState: iceGatheringState
              })
              
              activeConsumer = O.some(consumer)
              
              // Configure low-latency audio settings for optimal WiFi 6 performance
              if (consumer.track && consumer.track.kind === 'audio') {
                try {
                  // Get RTCRtpReceiver for playout delay configuration
                  const receiver = consumer.rtpReceiver as any // Type assertion for newer WebRTC APIs
                  if (receiver && typeof receiver.playoutDelayHint !== 'undefined') {
                    // Set to 0 for immediate playback (saves 200-500ms on WiFi 6)
                    receiver.playoutDelayHint = 0
                    console.info('🎧 Set playoutDelayHint to 0 for low latency')
                  }
                  
                  // Set jitter buffer delay for newer browsers (Chrome/Edge)
                  if (receiver && typeof receiver.jitterBufferDelayHint !== 'undefined') {
                    receiver.jitterBufferDelayHint = 0
                    console.info('🎧 Set jitterBufferDelayHint to 0 for minimal buffering')
                  }
                } catch (error) {
                  console.warn('⚠️ Failed to configure low-latency audio settings:', error)
                }
              }
              
              return consumer
            })
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
     * Set consumer recreate callback for automatic reconnection
     */
    setConsumerRecreateCallback: (callback: () => Effect.Effect<ConsumerOptionsType, Error>) =>
      Effect.sync(() => {
        consumerRecreateCallback = O.some(callback)
        console.info('📋 MediaSoup: Consumer recreate callback registered')
      }),

    /**
     * Clean up all resources
     */
    cleanup: () => Effect.sync(() => {
      // Clear connection timeout
      clearConnectionTimeout()
      
      // Reject any pending connection deferred
      pipe(
        connectionDeferred,
        O.map((deferred) => {
          Effect.runSync(Deferred.fail(deferred, new Error('MediaSoup client cleanup - connection cancelled')))
        })
      )
      connectionDeferred = O.none()
      
      // Reset internal state
      transportConnectionState = 'new'
      iceGatheringState = 'new'
      
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
export const MediaSoupClientLive = Layer.effect(
  MediaSoupClient,
  Effect.gen(function* () {
    const connectionAdapter = yield* ConnectionAdapter
    return createMediaSoupClientImpl(connectionAdapter)
  })
)
