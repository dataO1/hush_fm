import { Context, Effect, Layer, pipe, Option } from 'effect'
import { Device, types } from 'mediasoup-client'
import type { ClientCommand, ServerEvent } from '../models/websocket'
import { sendMessage, subscribeToMessages } from '../ws/client'

/**
 * Simplified transport options for internal use
 */
export interface TransportOptions {
  id: string
  dtlsParameters: any
  iceParameters: any
  iceCandidates: any[]
  sctpParameters?: any
}

/**
 * Unified WebRTC state for the service
 */
export interface WebRTCState {
  // WebSocket connection
  ws: Option.Option<WebSocket>
  roomId: Option.Option<string>
  
  // Device state
  device: Option.Option<Device>
  deviceLoaded: boolean
  rtpCapabilities: Option.Option<any>
  deviceError: Option.Option<string>
  
  // Transports
  sendTransport: Option.Option<types.Transport>
  receiveTransport: Option.Option<types.Transport>
  
  // Producers/Consumers by ID
  producers: Map<string, types.Producer>
  consumers: Map<string, types.Consumer>
  
  // Audio elements for consumers
  audioElements: Map<string, HTMLAudioElement>
  
  // Stream state
  localStream: Option.Option<MediaStream>
  remoteStreams: Map<string, MediaStream>
  
  // Connection quality
  connectionQuality: {
    rtt: number
    packetsLost: number
    jitter: number
    timestamp: number
  }
}

/**
 * WebRTC Service errors
 */
export class WebRTCError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message)
    this.name = 'WebRTCError'
  }
}

export class DeviceError extends WebRTCError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'DeviceError'
  }
}

export class TransportError extends WebRTCError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'TransportError'
  }
}

export class ProducerError extends WebRTCError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'ProducerError'
  }
}

export class ConsumerError extends WebRTCError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'ConsumerError'
  }
}

/**
 * Signaling callback type
 */
export type SignalingCallback = (roomId: string, command: ClientCommand) => Promise<void>

/**
 * Consumer options
 */
export interface ConsumerOptions {
  id: string
  producerId: string
  kind: 'audio' | 'video'
  rtpParameters: any
}

/**
 * Unified WebRTC Service interface
 * Manages Device → Transport → Producer/Consumer hierarchy
 */
/**
 * Connection states for WebRTC components
 */
export type ConnectionState = 
  | 'disconnected'
  | 'connecting' 
  | 'connected'
  | 'failed'
  | 'reconnecting'

/**
 * Device state for mediasoup-client
 */
export type DeviceState = {
  device: Option.Option<Device>
  loaded: boolean
  capabilities: Option.Option<any>
  error: Option.Option<string>
}

/**
 * Transport state tracking
 */
export type TransportState = {
  id: string
  direction: 'send' | 'receive'
  connectionState: ConnectionState
  iceState: Option.Option<RTCIceConnectionState>
  dtlsState: Option.Option<RTCDtlsTransportState>
  transport: Option.Option<types.Transport>
}

/**
 * Producer state for audio streaming
 */
export type ProducerState = {
  id: string
  kind: 'audio' | 'video'
  paused: boolean
  track: Option.Option<MediaStreamTrack>
  producer: Option.Option<types.Producer>
}

/**
 * Consumer state for receiving audio
 */
export type ConsumerState = {
  id: string
  kind: 'audio' | 'video'
  paused: boolean
  track: Option.Option<MediaStreamTrack>
  consumer: Option.Option<types.Consumer>
  producerId: string
}

export interface WebRTCService {
  // WebSocket connection management
  readonly setWebSocket: (ws: WebSocket) => Effect.Effect<void, never>
  readonly sendCommand: (command: ClientCommand) => Effect.Effect<void, WebRTCError>
  readonly setRoomId: (roomId: string) => Effect.Effect<void, never>
  
  // Device operations
  readonly initializeDevice: (rtpCapabilities: any) => Effect.Effect<void, DeviceError>
  readonly getDevice: () => Effect.Effect<Option.Option<Device>, never>
  readonly getRtpCapabilities: () => Effect.Effect<Option.Option<any>, never>
  readonly canProduceAudio: () => Effect.Effect<boolean, DeviceError>
  readonly canProduceVideo: () => Effect.Effect<boolean, DeviceError>
  readonly resetDevice: () => Effect.Effect<void, never>
  
  // Transport operations
  readonly createSendTransport: (options: TransportOptions) => Effect.Effect<void, TransportError>
  readonly createReceiveTransport: (options: TransportOptions) => Effect.Effect<void, TransportError>
  readonly getSendTransport: () => Effect.Effect<Option.Option<types.Transport>, never>
  readonly getReceiveTransport: () => Effect.Effect<Option.Option<types.Transport>, never>
  
  // Producer operations
  readonly produce: (track: MediaStreamTrack) => Effect.Effect<string, ProducerError>
  readonly getProducer: (producerId: string) => Effect.Effect<Option.Option<types.Producer>, never>
  readonly pauseProducer: (producerId: string) => Effect.Effect<void, ProducerError>
  readonly resumeProducer: (producerId: string) => Effect.Effect<void, ProducerError>
  readonly closeProducer: (producerId: string) => Effect.Effect<void, never>
  
  // Consumer operations
  readonly consume: (options: ConsumerOptions) => Effect.Effect<string, ConsumerError>
  readonly getConsumer: (consumerId: string) => Effect.Effect<Option.Option<types.Consumer>, never>
  readonly pauseConsumer: (consumerId: string) => Effect.Effect<void, ConsumerError>
  readonly resumeConsumer: (consumerId: string) => Effect.Effect<void, ConsumerError>
  readonly closeConsumer: (consumerId: string) => Effect.Effect<void, never>
  readonly createAudioElement: (consumerId: string, autoplay?: boolean) => Effect.Effect<HTMLAudioElement, ConsumerError>
  readonly setVolume: (consumerId: string, volume: number) => Effect.Effect<void, ConsumerError>
  readonly setMuted: (consumerId: string, muted: boolean) => Effect.Effect<void, ConsumerError>
  
  // Utility operations
  readonly getUserMedia: (constraints?: MediaStreamConstraints) => Effect.Effect<MediaStreamTrack, WebRTCError>
  readonly checkBrowserSupport: () => Effect.Effect<boolean, never>
  
  // State operations
  readonly getState: () => Effect.Effect<WebRTCState, never>
  readonly subscribeToStateChanges: (callback: (state: WebRTCState) => void) => Effect.Effect<() => void, never>
  
  // Cleanup operations
  readonly cleanup: () => Effect.Effect<void, never>
}

/**
 * Context tag for WebRTC Service
 */
export const WebRTCService = Context.GenericTag<WebRTCService>('WebRTCService')

/**
 * Internal implementation of WebRTC Service
 */
class WebRTCServiceImpl implements WebRTCService {
  // Core WebRTC objects
  private device: Option.Option<Device> = Option.none()
  private sendTransport: Option.Option<types.Transport> = Option.none()
  private receiveTransport: Option.Option<types.Transport> = Option.none()
  private transports = new Map<string, types.Transport>()
  private producers = new Map<string, types.Producer>()
  private consumers = new Map<string, types.Consumer>()
  private audioElements = new Map<string, HTMLAudioElement>()
  
  // WebSocket connection
  private ws: Option.Option<WebSocket> = Option.none()
  private roomId: Option.Option<string> = Option.none()
  
  // State management
  private stateSubscribers = new Set<(state: WebRTCState) => void>()
  
  // Device state
  private deviceLoaded = false
  private rtpCapabilities: Option.Option<any> = Option.none()
  private deviceError: Option.Option<string> = Option.none()

  /**
   * Get current state snapshot
   */
  private getStateSnapshot(): WebRTCState {
    return {
      ws: this.ws,
      roomId: this.roomId,
      device: this.device,
      deviceLoaded: this.deviceLoaded,
      rtpCapabilities: this.rtpCapabilities,
      deviceError: this.deviceError,
      sendTransport: this.sendTransport,
      receiveTransport: this.receiveTransport,
      producers: new Map(this.producers),
      consumers: new Map(this.consumers),
      audioElements: new Map(this.audioElements),
      localStream: Option.none(), // TODO: Track local stream
      remoteStreams: new Map(), // TODO: Track remote streams
      connectionQuality: {
        rtt: 0,
        packetsLost: 0,
        jitter: 0,
        timestamp: Date.now()
      }
    }
  }

  /**
   * Notify all state subscribers
   */
  private notifyStateChange(): void {
    const state = this.getStateSnapshot()
    this.stateSubscribers.forEach(callback => callback(state))
  }

  /**
   * Set up transport event handlers using WebSocket client
   */
  private setupTransportEvents = (transport: types.Transport, direction: 'send' | 'receive'): void => {
    // Connection state changes
    transport.on('connectionstatechange', (state: string) => {
      console.debug(`Transport ${transport.id} connection state: ${state}`)
      this.notifyStateChange()
    })

    // Handle the 'connect' event for send transports
    if (direction === 'send') {
      transport.on('connect', async (dtlsParameters: any, callback: () => void, errback: (error: Error) => void) => {
        try {
          const command: ClientCommand = {
            type: 'connectTransport',
            dtlsParameters: dtlsParameters,
            _traceContext: Option.none()
          }
          
          // Use WebSocket client to send command
          await Effect.runPromise(this.sendCommand(command))
          callback()
        } catch (error) {
          console.error('Transport connect failed:', error)
          errback(error instanceof Error ? error : new Error(String(error)))
        }
      })

      // Handle the 'produce' event
      transport.on('produce', async (parameters: any, callback: (params: { id: string }) => void, errback: (error: Error) => void) => {
        try {
          const command: ClientCommand = {
            type: 'produce',
            rtpParameters: parameters,
            _traceContext: Option.none()
          }
          
          // Use WebSocket client to send command
          await Effect.runPromise(this.sendCommand(command))
          
          // Generate temporary producer ID - server will provide the real one via ServerEvent
          const producerId = `producer-${parameters.kind}-${Date.now()}`
          callback({ id: producerId })
        } catch (error) {
          console.error('Transport produce failed:', error)
          errback(error instanceof Error ? error : new Error(String(error)))
        }
      })
    }

    // Handle the 'connect' event for receive transports
    if (direction === 'receive') {
      transport.on('connect', async (dtlsParameters: any, callback: () => void, errback: (error: Error) => void) => {
        try {
          const command: ClientCommand = {
            type: 'connectListenerTransport',
            dtlsParameters: dtlsParameters,
            _traceContext: Option.none()
          }
          
          // Use WebSocket client to send command
          await Effect.runPromise(this.sendCommand(command))
          callback()
        } catch (error) {
          console.error('Listener transport connect failed:', error)
          errback(error instanceof Error ? error : new Error(String(error)))
        }
      })
    }
  }

  /**
   * Set up producer event handlers
   */
  private setupProducerEvents = (producer: types.Producer): void => {
    producer.on('trackended', () => {
      console.info(`Producer track ended: ${producer.id}`)
      this.closeProducer(producer.id)
    })

    producer.on('transportclose', () => {
      console.info(`Producer transport closed: ${producer.id}`)
      this.closeProducer(producer.id)
    })
  }

  /**
   * Set up consumer event handlers
   */
  private setupConsumerEvents = (consumer: types.Consumer): void => {
    consumer.on('trackended', () => {
      console.info(`Consumer track ended: ${consumer.id}`)
      this.closeConsumer(consumer.id)
    })

    consumer.on('transportclose', () => {
      console.info(`Consumer transport closed: ${consumer.id}`)
      this.closeConsumer(consumer.id)
    })
  }

  // Device operations
  initializeDevice = (rtpCapabilities: any): Effect.Effect<void, DeviceError> =>
    pipe(
      Effect.tryPromise({
        try: async () => {
          let device: Device
          try {
            device = new Device()
          } catch (error) {
            if ((error as Error).name === 'UnsupportedError') {
              throw new DeviceError('Browser does not support WebRTC')
            }
            throw error
          }
          
          await device.load({ routerRtpCapabilities: rtpCapabilities })
          
          this.device = Option.some(device)
          this.deviceLoaded = true
          this.rtpCapabilities = Option.some(rtpCapabilities)
          this.deviceError = Option.none()
          this.notifyStateChange()
        },
        catch: (error) => new DeviceError(
          error instanceof DeviceError ? error.message : `Failed to initialize device: ${error}`,
          error
        )
      }),
      Effect.tap(() => Effect.logInfo('Device initialized successfully'))
    )

  getDevice = (): Effect.Effect<Option.Option<Device>, never> =>
    Effect.succeed(this.device)

  getRtpCapabilities = (): Effect.Effect<Option.Option<any>, never> =>
    Effect.succeed(this.rtpCapabilities)

  canProduceAudio = (): Effect.Effect<boolean, DeviceError> =>
    pipe(
      this.device,
      Option.match({
        onNone: () => Effect.fail(new DeviceError('Device not initialized')),
        onSome: (device) => Effect.succeed(device.canProduce('audio'))
      }),
      Effect.tap(canProduce => 
        Effect.logDebug(`Device can produce audio: ${canProduce}`)
      )
    )

  canProduceVideo = (): Effect.Effect<boolean, DeviceError> =>
    pipe(
      this.device,
      Option.match({
        onNone: () => Effect.fail(new DeviceError('Device not initialized')),
        onSome: (device) => Effect.succeed(device.canProduce('video'))
      }),
      Effect.tap(canProduce => 
        Effect.logDebug(`Device can produce video: ${canProduce}`)
      )
    )

  getDeviceInfo = (): Effect.Effect<{
    loaded: boolean
    canProduceAudio: boolean
    canProduceVideo: boolean
    rtpCapabilities: any
  }, DeviceError> =>
    pipe(
      Effect.all({
        canProduceAudio: this.canProduceAudio(),
        canProduceVideo: this.canProduceVideo(),
        rtpCapabilities: this.getRtpCapabilities(),
      }),
      Effect.map(({ canProduceAudio, canProduceVideo, rtpCapabilities }) => ({
        loaded: this.deviceLoaded,
        canProduceAudio,
        canProduceVideo,
        rtpCapabilities,
      }))
    )

  resetDevice = (): Effect.Effect<void, never> =>
    Effect.sync(() => {
      this.device = Option.none()
      this.deviceLoaded = false
      this.rtpCapabilities = Option.none()
      this.deviceError = Option.none()
      this.notifyStateChange()
    })

  // =========================
  // WebSocket Operations (using existing ws/client.ts)
  // =========================
  setWebSocket = (ws: WebSocket): Effect.Effect<void, never> =>
    Effect.sync(() => {
      this.ws = Option.some(ws)
      this.setupWebSocketEventHandlers(ws)
      this.notifyStateChange()
    })

  sendCommand = (command: ClientCommand): Effect.Effect<void, WebRTCError> =>
    pipe(
      this.ws,
      Option.match({
        onNone: () => Effect.fail(new WebRTCError('WebSocket not connected')),
        onSome: (ws) => pipe(
          sendMessage(ws, command),
          Effect.mapError(error => new WebRTCError(`Failed to send command: ${error.message}`, error))
        )
      })
    )

  setRoomId = (roomId: string): Effect.Effect<void, never> =>
    Effect.sync(() => {
      this.roomId = Option.some(roomId)
      this.notifyStateChange()
    })

  /**
   * Set up WebSocket event handlers using existing client
   */
  private setupWebSocketEventHandlers = (ws: WebSocket): void => {
    // Use existing subscribeToMessages from ws/client.ts
    Effect.runSync(
      subscribeToMessages<ServerEvent>(
        ws,
        (message: ServerEvent) => this.handleServerEvent(message),
        (error: Error) => console.error('WebSocket error:', error)
      )
    )
  }

  /**
   * Handle server events from WebSocket
   */
  private handleServerEvent = (event: ServerEvent): void => {
    console.log('Received server event:', event.type, event)
    
    // Handle each event type using discriminated union
    switch (event.type) {
      case 'transportReady':
        // Transport was created on server side
        console.info(`Transport ready: ${event.transportId}`)
        this.notifyStateChange()
        break
        
      case 'transportConnected':
        // Transport successfully connected (DTLS handshake complete)
        console.info(`Transport connected: ${event.transportId}`)
        this.notifyStateChange()
        break
        
      case 'producerCreated':
        // Producer was successfully created on server
        console.info(`Producer created: ${event.producerId} in room ${event.roomId}`)
        // Update room ID if received
        this.roomId = Option.some(event.roomId)
        this.notifyStateChange()
        break
        
      case 'consumerCreated':
        // Consumer was created, we can start consuming
        console.info(`Consumer created: ${event.consumerId} for producer ${event.producerId}`)
        // Consumer parameters are provided by server
        this.notifyStateChange()
        break
        
      case 'streamPaused':
        console.info(`Stream paused in room: ${event.roomId}`)
        // Update local state if this affects our producers
        Option.match(this.roomId, {
          onNone: () => {},
          onSome: (currentRoomId) => {
            if (currentRoomId === event.roomId) {
              // Could pause local producers here if needed
              this.notifyStateChange()
            }
          }
        })
        break
        
      case 'streamResumed':
        console.info(`Stream resumed in room: ${event.roomId}`)
        // Update local state if this affects our producers
        Option.match(this.roomId, {
          onNone: () => {},
          onSome: (currentRoomId) => {
            if (currentRoomId === event.roomId) {
              // Could resume local producers here if needed
              this.notifyStateChange()
            }
          }
        })
        break
        
      case 'roomJoined':
        // Successfully joined a room as listener
        console.info(`Joined room: ${event.room.id}`)
        this.roomId = Option.some(event.room.id)
        // Store RTP capabilities for device initialization
        this.rtpCapabilities = Option.some(event.rtpCapabilities)
        this.notifyStateChange()
        break
        
      case 'roomClosed':
        console.info(`Room closed: ${event.roomId}, reason: ${event.reason}`)
        // Clean up if this was our room
        Option.match(this.roomId, {
          onNone: () => {},
          onSome: (currentRoomId) => {
            if (currentRoomId === event.roomId) {
              // Cleanup local state
              this.producers.clear()
              this.consumers.clear()
              this.audioElements.clear()
              this.sendTransport = Option.none()
              this.receiveTransport = Option.none()
              this.roomId = Option.none()
              this.notifyStateChange()
            }
          }
        })
        break
        
      case 'listenerCountUpdated':
        console.info(`Listener count updated for room ${event.roomId}: ${event.count}`)
        // This is informational, just log it
        break
        
      case 'commandFailed':
        console.error(`Command failed: ${event.command} - ${event.error}`)
        // Could set error state here
        this.deviceError = Option.some(`Command failed: ${event.error}`)
        this.notifyStateChange()
        break
        
      case 'authenticationError':
        console.error(`Authentication error: ${event.message}`)
        this.deviceError = Option.some(`Auth error: ${event.message}`)
        this.notifyStateChange()
        break
        
      case 'roomNotFound':
        console.error(`Room not found: ${event.roomId}`)
        this.deviceError = Option.some(`Room not found: ${event.roomId}`)
        // Clear room ID since it doesn't exist
        this.roomId = Option.none()
        this.notifyStateChange()
        break
        
      default:
        // TypeScript will ensure this is never reached if all cases are handled
        console.warn('Unknown server event type:', (event as any).type)
        break
    }
  }

  ensureDevice = (rtpCapabilities: any): Effect.Effect<Device, DeviceError> =>
    pipe(
      this.device,
      Option.match({
        onNone: () => pipe(
          this.initializeDevice(rtpCapabilities),
          Effect.andThen(() => this.getDevice()),
          Effect.andThen(Option.match({
            onNone: () => Effect.fail(new DeviceError('Device not available after initialization')),
            onSome: (device) => Effect.succeed(device)
          }))
        ),
        onSome: (device) => this.deviceLoaded 
          ? Effect.succeed(device) 
          : pipe(
            this.initializeDevice(rtpCapabilities),
            Effect.andThen(() => this.getDevice()),
            Effect.andThen(Option.match({
              onNone: () => Effect.fail(new DeviceError('Device not available after initialization')),
              onSome: (device) => Effect.succeed(device)
            }))
          )
      })
    )

  // Transport operations
  createSendTransport = (options: TransportOptions): Effect.Effect<void, TransportError> =>
    pipe(
      this.device,
      Option.match({
        onNone: () => Effect.fail(new TransportError('Device not initialized')),
        onSome: (device) => Effect.sync(() => {
          // Transport creation is synchronous
          const transport = device.createSendTransport({
            id: options.id,
            iceParameters: options.iceParameters,
            iceCandidates: options.iceCandidates,
            dtlsParameters: options.dtlsParameters,
            sctpParameters: options.sctpParameters,
          })
          
          // Store transport and set up events
          this.transports.set(transport.id, transport)
          this.sendTransport = Option.some(transport)
          this.setupTransportEvents(transport, 'send')
          this.notifyStateChange()
        })
      }),
      Effect.tap(() => Effect.logInfo(`Created send transport: ${options.id}`))
    )

  createReceiveTransport = (options: TransportOptions): Effect.Effect<void, TransportError> =>
    pipe(
      this.device,
      Option.match({
        onNone: () => Effect.fail(new TransportError('Device not initialized')),
        onSome: (device) => Effect.sync(() => {
          // Transport creation is synchronous
          const transport = device.createRecvTransport({
            id: options.id,
            iceParameters: options.iceParameters,
            iceCandidates: options.iceCandidates,
            dtlsParameters: options.dtlsParameters,
            sctpParameters: options.sctpParameters,
          })
          
          // Store transport and set up events
          this.transports.set(transport.id, transport)
          this.receiveTransport = Option.some(transport)
          this.setupTransportEvents(transport, 'receive')
          this.notifyStateChange()
        })
      }),
      Effect.tap(() => Effect.logInfo(`Created receive transport: ${options.id}`))
    )

  getSendTransport = (): Effect.Effect<Option.Option<types.Transport>, never> =>
    Effect.succeed(this.sendTransport)

  getReceiveTransport = (): Effect.Effect<Option.Option<types.Transport>, never> =>
    Effect.succeed(this.receiveTransport)

  getTransport = (id: string): Effect.Effect<Option.Option<types.Transport>, never> =>
    Effect.succeed(Option.fromNullable(this.transports.get(id)))

  closeTransport = (transportId: string): Effect.Effect<void, never> =>
    pipe(
      Effect.sync(() => {
        const transport = this.transports.get(transportId)
        if (transport) {
          transport.close()
          this.transports.delete(transportId)
          this.notifyStateChange()
        }
      }),
      Effect.tap(() => Effect.logInfo(`Closed transport: ${transportId}`))
    )

  getTransportStats = (transportId: string): Effect.Effect<any, TransportError> =>
    pipe(
      Effect.sync(() => {
        const transport = this.transports.get(transportId)
        if (!transport) {
          throw new TransportError(`Transport not found: ${transportId}`)
        }
        return transport
      }),
      Effect.andThen(transport =>
        Effect.tryPromise({
          try: () => transport.getStats(),
          catch: (error) => new TransportError(
            `Failed to get transport stats: ${error instanceof Error ? error.message : String(error)}`,
            error
          )
        })
      ),
      Effect.tap(() => Effect.logDebug(`Retrieved stats for transport: ${transportId}`))
    )

  restartIce = (transportId: string): Effect.Effect<void, TransportError> =>
    pipe(
      Effect.sync(() => {
        const transport = this.transports.get(transportId)
        if (!transport) {
          throw new TransportError(`Transport not found: ${transportId}`)
        }
        return transport
      }),
      Effect.andThen(transport =>
        Effect.tryPromise({
          try: () => transport.restartIce({
            iceParameters: { 
              usernameFragment: 'local', 
              password: 'localpass' 
            }
          }),
          catch: (error) => new TransportError(
            `Failed to restart ICE: ${error instanceof Error ? error.message : String(error)}`,
            error
          )
        })
      ),
      Effect.tap(() => Effect.logInfo(`Restarted ICE for transport: ${transportId}`))
    )

  // Producer operations  
  produce = (track: MediaStreamTrack): Effect.Effect<string, ProducerError> =>
    pipe(
      Effect.sync(() => this.sendTransport),
      Effect.andThen(transportOpt =>
        Option.match(transportOpt, {
          onNone: () => Effect.fail(new ProducerError('Send transport not available')),
          onSome: (transport) => Effect.succeed(transport)
        })
      ),
      Effect.andThen(transport =>
        Effect.tryPromise({
          try: async () => {
            const producer = await transport.produce({
              track,
              codecOptions: {
                opusStereo: true,
                opusDtx: true,
              },
            })
            
            // Store producer and set up events
            this.producers.set(producer.id, producer)
            this.setupProducerEvents(producer)
            this.notifyStateChange()
            
            return producer.id
          },
          catch: (error) => new ProducerError(`Failed to create producer: ${error}`, error)
        })
      ),
      Effect.tap((id) => Effect.logInfo(`Created producer: ${id}`))
    )

  pauseProducer = (producerId: string): Effect.Effect<void, ProducerError> =>
    pipe(
      Effect.sync(() => {
        const producer = this.producers.get(producerId)
        if (!producer) {
          throw new ProducerError(`Producer not found: ${producerId}`)
        }
        return producer
      }),
      Effect.andThen(producer =>
        Effect.tryPromise({
          try: async () => {
            await producer.pause()
            this.notifyStateChange()
          },
          catch: (error) => new ProducerError(`Failed to pause producer: ${error}`, error)
        })
      ),
      Effect.tap(() => Effect.logInfo(`Paused producer: ${producerId}`))
    )

  resumeProducer = (producerId: string): Effect.Effect<void, ProducerError> =>
    pipe(
      Effect.sync(() => {
        const producer = this.producers.get(producerId)
        if (!producer) {
          throw new ProducerError(`Producer not found: ${producerId}`)
        }
        return producer
      }),
      Effect.andThen(producer =>
        Effect.tryPromise({
          try: async () => {
            await producer.resume()
            this.notifyStateChange()
          },
          catch: (error) => new ProducerError(`Failed to resume producer: ${error}`, error)
        })
      ),
      Effect.tap(() => Effect.logInfo(`Resumed producer: ${producerId}`))
    )

  closeProducer = (producerId: string): Effect.Effect<void, never> =>
    pipe(
      Effect.sync(() => {
        const producer = this.producers.get(producerId)
        if (producer) {
          producer.close()
          this.producers.delete(producerId)
          this.notifyStateChange()
        }
      }),
      Effect.tap(() => Effect.logInfo(`Closed producer: ${producerId}`))
    )

  getProducer = (producerId: string): Effect.Effect<Option.Option<types.Producer>, never> =>
    Effect.succeed(Option.fromNullable(this.producers.get(producerId)))

  listProducers = (): Effect.Effect<types.Producer[], never> =>
    Effect.sync(() => Array.from(this.producers.values()))

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

  getProducerStats = (producerId: string): Effect.Effect<any, ProducerError> =>
    pipe(
      Effect.sync(() => {
        const producer = this.producers.get(producerId)
        if (!producer) {
          throw new ProducerError(`Producer not found: ${producerId}`)
        }
        return producer
      }),
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

  getAudioLevel = (producerId: string): Effect.Effect<number, ProducerError> =>
    pipe(
      Effect.sync(() => {
        const producer = this.producers.get(producerId)
        if (!producer) {
          throw new ProducerError(`Producer not found: ${producerId}`)
        }
        if (producer.kind !== 'audio' || !producer.track) {
          throw new ProducerError('Producer is not audio or has no track')
        }
        return producer
      }),
      Effect.map(() => {
        // Placeholder - real implementation would require audio analysis
        return 0
      })
    )

  replaceProducerTrack = (producerId: string, track: MediaStreamTrack): Effect.Effect<void, ProducerError> =>
    pipe(
      Effect.sync(() => {
        const producer = this.producers.get(producerId)
        if (!producer) {
          throw new ProducerError(`Producer not found: ${producerId}`)
        }
        return producer
      }),
      Effect.andThen(producer =>
        Effect.tryPromise({
          try: async () => {
            await producer.replaceTrack({ track })
            this.notifyStateChange()
          },
          catch: (error) => new ProducerError(`Failed to replace track: ${error}`, error)
        })
      ),
      Effect.tap(() => Effect.logInfo(`Replaced track for producer: ${producerId}`))
    )

  // Consumer operations
  consume = (options: ConsumerOptions): Effect.Effect<string, ConsumerError> =>
    pipe(
      Effect.sync(() => this.receiveTransport),
      Effect.andThen(transportOpt =>
        Option.match(transportOpt, {
          onNone: () => Effect.fail(new ConsumerError('Receive transport not available')),
          onSome: (transport) => Effect.succeed(transport)
        })
      ),
      Effect.andThen(transport =>
        Effect.tryPromise({
          try: async () => {
            const consumer = await transport.consume(options)
            
            // Store consumer and set up events
            this.consumers.set(consumer.id, consumer)
            this.setupConsumerEvents(consumer)
            this.notifyStateChange()
            
            return consumer.id
          },
          catch: (error) => new ConsumerError(`Failed to create consumer: ${error}`, error)
        })
      ),
      Effect.tap((id) => Effect.logInfo(`Created consumer: ${id}`))
    )

  pauseConsumer = (consumerId: string): Effect.Effect<void, ConsumerError> =>
    pipe(
      Effect.sync(() => {
        const consumer = this.consumers.get(consumerId)
        if (!consumer) {
          throw new ConsumerError(`Consumer not found: ${consumerId}`)
        }
        return consumer
      }),
      Effect.andThen(consumer =>
        Effect.tryPromise({
          try: async () => {
            await consumer.pause()
            this.notifyStateChange()
          },
          catch: (error) => new ConsumerError(`Failed to pause consumer: ${error}`, error)
        })
      ),
      Effect.tap(() => Effect.logInfo(`Paused consumer: ${consumerId}`))
    )

  resumeConsumer = (consumerId: string): Effect.Effect<void, ConsumerError> =>
    pipe(
      Effect.sync(() => {
        const consumer = this.consumers.get(consumerId)
        if (!consumer) {
          throw new ConsumerError(`Consumer not found: ${consumerId}`)
        }
        return consumer
      }),
      Effect.andThen(consumer =>
        Effect.tryPromise({
          try: async () => {
            await consumer.resume()
            this.notifyStateChange()
          },
          catch: (error) => new ConsumerError(`Failed to resume consumer: ${error}`, error)
        })
      ),
      Effect.tap(() => Effect.logInfo(`Resumed consumer: ${consumerId}`))
    )

  closeConsumer = (consumerId: string): Effect.Effect<void, never> =>
    pipe(
      Effect.sync(() => {
        const consumer = this.consumers.get(consumerId)
        if (consumer) {
          consumer.close()
          this.consumers.delete(consumerId)
          
          // Clean up associated audio element
          const audioElement = this.audioElements.get(consumerId)
          if (audioElement) {
            audioElement.srcObject = null
            this.audioElements.delete(consumerId)
          }
          
          this.notifyStateChange()
        }
      }),
      Effect.tap(() => Effect.logInfo(`Closed consumer: ${consumerId}`))
    )

  createAudioElement = (consumerId: string, autoplay: boolean = true): Effect.Effect<HTMLAudioElement, ConsumerError> =>
    pipe(
      Effect.sync(() => {
        const consumer = this.consumers.get(consumerId)
        if (!consumer) {
          throw new ConsumerError(`Consumer not found: ${consumerId}`)
        }
        if (!consumer.track) {
          throw new ConsumerError(`Consumer has no track: ${consumerId}`)
        }
        
        const audioElement = new Audio()
        const stream = new MediaStream([consumer.track])
        
        audioElement.srcObject = stream
        audioElement.autoplay = autoplay
        audioElement.controls = false
        
        this.audioElements.set(consumerId, audioElement)
        
        return audioElement
      }),
      Effect.tap(() => Effect.logInfo(`Created audio element for consumer: ${consumerId}`))
    )

  getConsumer = (consumerId: string): Effect.Effect<Option.Option<types.Consumer>, never> =>
    Effect.succeed(Option.fromNullable(this.consumers.get(consumerId)))

  listConsumers = (): Effect.Effect<types.Consumer[], never> =>
    Effect.sync(() => Array.from(this.consumers.values()))

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

  getAudioElement = (consumerId: string): Effect.Effect<HTMLAudioElement, ConsumerError> =>
    pipe(
      Effect.sync(() => {
        const audioElement = this.audioElements.get(consumerId)
        if (!audioElement) {
          throw new ConsumerError('No audio element found for consumer')
        }
        return audioElement
      })
    )

  setVolume = (consumerId: string, volume: number): Effect.Effect<void, ConsumerError> =>
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

  setMuted = (consumerId: string, muted: boolean): Effect.Effect<void, ConsumerError> =>
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

  getConsumerStats = (consumerId: string): Effect.Effect<any, ConsumerError> =>
    pipe(
      Effect.sync(() => {
        const consumer = this.consumers.get(consumerId)
        if (!consumer) {
          throw new ConsumerError(`Consumer not found: ${consumerId}`)
        }
        return consumer
      }),
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

  // Utility operations
  getUserMedia = (constraints?: MediaStreamConstraints): Effect.Effect<MediaStreamTrack, WebRTCError> =>
    pipe(
      Effect.tryPromise({
        try: async () => {
          const mediaConstraints = constraints || {
            audio: true,
            video: false
          }
          const stream = await navigator.mediaDevices.getUserMedia(mediaConstraints)
          const track = stream.getAudioTracks()[0]
          if (!track) {
            throw new Error('No audio track found in stream')
          }
          return track
        },
        catch: (error) => new WebRTCError(
          `Failed to get user media: ${error instanceof Error ? error.message : String(error)}`,
          error
        )
      }),
      Effect.tap(() => Effect.logInfo('Got user media stream'))
    )

  checkBrowserSupport = (): Effect.Effect<boolean, never> =>
    Effect.sync(() => {
      try {
        new Device()
        return true
      } catch (error) {
        if ((error as Error).name === 'UnsupportedError') {
          return false
        }
        // Other errors also indicate lack of support
        return false
      }
    })

  getBrowserInfo = (): Effect.Effect<{
    supported: boolean
    userAgent: string
    webrtcSupport: {
      getUserMedia: boolean
      rtcPeerConnection: boolean
      webAudio: boolean
    }
  }, never> =>
    Effect.sync(() => ({
      supported: (() => {
        try {
          new Device()
          return true
        } catch {
          return false
        }
      })(),
      userAgent: navigator.userAgent,
      webrtcSupport: {
        getUserMedia: !!(navigator.mediaDevices?.getUserMedia),
        rtcPeerConnection: !!(window.RTCPeerConnection),
        webAudio: !!(window.AudioContext || (window as any).webkitAudioContext),
      }
    }))

  // State operations
  getState = (): Effect.Effect<WebRTCState, never> =>
    Effect.succeed(this.getStateSnapshot())

  subscribeToStateChanges = (callback: (state: WebRTCState) => void): Effect.Effect<() => void, never> =>
    Effect.sync(() => {
      this.stateSubscribers.add(callback)
      
      // Send initial state
      callback(this.getStateSnapshot())
      
      // Return cleanup function
      return () => {
        this.stateSubscribers.delete(callback)
      }
    })

  // Cleanup operations
  cleanup = (): Effect.Effect<void, never> =>
    pipe(
      Effect.sync(() => {
        // Close all producers
        this.producers.forEach(producer => producer.close())
        this.producers.clear()

        // Close all consumers
        this.consumers.forEach(consumer => consumer.close())
        this.consumers.clear()

        // Close all transports
        this.transports.forEach(transport => transport.close())
        this.transports.clear()

        // Clean up audio elements
        this.audioElements.forEach(element => {
          element.srcObject = null
        })
        this.audioElements.clear()

        // Clear state subscribers
        this.stateSubscribers.clear()

        // Reset WebRTC state using Option types
        this.device = Option.none()
        this.sendTransport = Option.none()
        this.receiveTransport = Option.none()
        this.ws = Option.none()
        this.roomId = Option.none()
        this.rtpCapabilities = Option.none()
        this.deviceError = Option.none()
        this.deviceLoaded = false

        this.notifyStateChange()
      }),
      Effect.tap(() => Effect.logInfo('WebRTC service cleanup completed'))
    )
}

/**
 * Create the live layer for WebRTC Service
 */
export const WebRTCServiceLive = Layer.succeed(
  WebRTCService,
  new WebRTCServiceImpl()
)

/**
 * Convenience function to access WebRTC service from context
 */
export const useWebRTCService = Context.get(WebRTCService)