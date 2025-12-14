import { Context, Effect, Layer, pipe, Option, Deferred, Fiber } from 'effect'
import { Device, types } from 'mediasoup-client'
import type { ClientCommand, ServerEvent } from '../models/websocket'
import type { TransportOptions as ApiTransportOptions, ConsumerParameters as ApiConsumerParameters } from '../generated/api.schemas'
import { TransportOptionsFromApi, ConsumerOptionsFromApi, type InternalTransportOptions, type InternalConsumerOptions } from '../models/websocket'
import { subscribeToMessages } from '../ws/client'
import { getWebSocketTraceContext } from '../telemetry'

// Use the transport options from the websocket models
export type TransportOptions = InternalTransportOptions



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
  rtpCapabilities: Option.Option<types.RtpCapabilities>
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

// Use the consumer options from the websocket models  
export type ConsumerOptions = InternalConsumerOptions

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
  capabilities: Option.Option<types.RtpCapabilities>
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
  readonly setDjWebSocket: (ws: WebSocket) => Effect.Effect<void, never>
  readonly setListenerWebSocket: (ws: WebSocket) => Effect.Effect<void, never>
  readonly sendCommand: (command: ClientCommand) => Effect.Effect<void, WebRTCError>
  readonly sendWebSocketMessage: (message: ClientCommand) => Effect.Effect<void, WebRTCError>
  readonly setRoomId: (roomId: string) => Effect.Effect<void, never>
  
  // Router capabilities for device initialization
  readonly getRouterCapabilities: (roomId: string) => Effect.Effect<types.RtpCapabilities, WebRTCError>
  readonly waitForRouterCapabilities: (roomId: string) => Effect.Effect<types.RtpCapabilities, WebRTCError>
  
  readonly waitForJoinReady: (roomId: string) => Effect.Effect<{
    room: any,
    transportOptions: ApiTransportOptions,
    producerId: string,
    rtpCapabilities: types.RtpCapabilities
  }, WebRTCError>
  
  // Device operations (use native MediaSoup types)
  readonly initializeDevice: (rtpCapabilities: types.RtpCapabilities) => Effect.Effect<void, DeviceError>
  readonly getDevice: () => Effect.Effect<Option.Option<Device>, never>
  readonly getRtpCapabilities: () => Effect.Effect<Option.Option<types.RtpCapabilities>, never>
  readonly canProduceAudio: () => Effect.Effect<boolean, DeviceError>
  readonly canProduceVideo: () => Effect.Effect<boolean, DeviceError>
  readonly resetDevice: () => Effect.Effect<void, never>
  
  // Transport operations (accept API wrapper types and convert internally)
  readonly createSendTransport: (options: ApiTransportOptions) => Effect.Effect<void, TransportError>
  readonly createReceiveTransport: (options: ApiTransportOptions) => Effect.Effect<void, TransportError>
  readonly getSendTransport: () => Effect.Effect<Option.Option<types.Transport>, never>
  readonly getReceiveTransport: () => Effect.Effect<Option.Option<types.Transport>, never>
  
  // Producer operations
  readonly produce: (track: MediaStreamTrack) => Effect.Effect<string, ProducerError>
  readonly getProducer: (producerId: string) => Effect.Effect<Option.Option<types.Producer>, never>
  readonly getAllProducers: () => Effect.Effect<types.Producer[], never>
  readonly pauseProducer: (producerId: string) => Effect.Effect<void, ProducerError>
  readonly resumeProducer: (producerId: string) => Effect.Effect<void, ProducerError>
  readonly pauseStream: () => Effect.Effect<void, ProducerError>
  readonly resumeStream: () => Effect.Effect<void, ProducerError>
  readonly closeProducer: (producerId: string) => Effect.Effect<void, never>
  
  // Consumer operations (accept API wrapper types and convert internally)
  readonly consume: (options: ApiConsumerParameters) => Effect.Effect<string, ConsumerError>
  readonly createConsumerFromProducer: (producerId: string) => Effect.Effect<string, ConsumerError>
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
  
  // Producer pause state (MediaSoup state as single source of truth)
  readonly subscribeToProducerPauseState: (callback: (isPaused: boolean) => void) => Effect.Effect<() => void, never>
  readonly getProducerPausedState: () => Effect.Effect<boolean, never>
  
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
  
  // WebSocket connections - separate endpoints for DJ and listener
  private djWebSocket: Option.Option<WebSocket> = Option.none()
  private listenerWebSocket: Option.Option<WebSocket> = Option.none()
  private roomId: Option.Option<string> = Option.none()
  private connectionType: 'dj' | 'listener' | null = null
  
  // State management
  private stateSubscribers = new Set<(state: WebRTCState) => void>()
  
  // Device state
  private deviceLoaded = false
  private rtpCapabilities: Option.Option<types.RtpCapabilities> = Option.none()
  private deviceError: Option.Option<string> = Option.none()
  
  // Producer pause state (MediaSoup state as single source of truth)
  private producerPauseSubscribers = new Set<(isPaused: boolean) => void>()
  
  // For listeners: track remote DJ producer pause state (since listeners don't have local producers)
  private remoteDJPauseState = true // Assume paused initially until we get room state

  /**
   * Get current state snapshot
   */
  private getStateSnapshot(): WebRTCState {
    return {
      ws: this.connectionType === 'dj' ? this.djWebSocket : this.listenerWebSocket,
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
   * Get current producer pause state
   * For DJs: check local producer state
   * For listeners: use remote DJ pause state from events
   */
  private getProducerPauseState(): boolean {
    // If we're a DJ and have local producers, use local producer state
    if (this.connectionType === 'dj' && this.producers.size > 0) {
      const producer = Array.from(this.producers.values())[0] // Assuming one producer for DJ
      return producer.paused
    }
    
    // For listeners or when no local producers: use remote DJ state
    return this.remoteDJPauseState
  }
  
  /**
   * Notify producer pause state subscribers
   */
  private notifyProducerPauseChange(): void {
    const isPaused = this.getProducerPauseState()
    this.producerPauseSubscribers.forEach(callback => callback(isPaused))
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
      transport.on('connect', async ({ dtlsParameters }: { dtlsParameters: any }, callback: () => void, errback: (error: Error) => void) => {
        try {
          // MediaSoup provides complete DTLS parameters, use them directly
          const traceContext = getWebSocketTraceContext()
          console.debug('DTLS params being sent:', dtlsParameters)
          console.debug('Trace context being sent:', traceContext)
          
          const command: ClientCommand = {
            type: 'connectDjTransport',
            dtlsParameters: dtlsParameters,
            _traceContext: traceContext
          }
          
          console.debug('Full command being sent:', JSON.stringify(command, null, 2))
          
          // Use WebSocket client to send command
          await Effect.runPromise(this.sendCommand(command))
          callback()
        } catch (error) {
          console.error('Transport connect failed:', error)
          errback(error instanceof Error ? error : new Error(String(error)))
        }
      })

      // Produce event is now handled in createSendTransport
    }

    // Handle the 'connect' event for receive transports
    if (direction === 'receive') {
      transport.on('connect', async ({ dtlsParameters }: { dtlsParameters: any }, callback: () => void, errback: (error: Error) => void) => {
        try {
          console.debug('Receive transport connect event - sending DTLS parameters to backend', dtlsParameters)
          
          // MediaSoup provides complete DTLS parameters with fingerprints - send them to backend
          const traceContext = getWebSocketTraceContext()
          const command: ClientCommand = {
            type: 'connectListenerTransport',
            dtlsParameters: dtlsParameters,
            _traceContext: traceContext
          }
          
          // Send via WebSocket to backend
          const result = this.sendWebSocketMessage(command)
          
          // Execute the Effect to actually send the message
          await Effect.runPromise(result)
          
          // Acknowledge the connection is ready
          callback()
        } catch (error) {
          console.error('Receive transport connect failed:', error)
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

    consumer.on('@pause', () => {
      console.info(`Consumer paused: ${consumer.id}`)
      // Update audio element if exists
      const audioElement = this.audioElements.get(consumer.id)
      if (audioElement) {
        audioElement.pause()
      }
      this.notifyStateChange()
    })

    consumer.on('@resume', () => {
      console.info(`Consumer resumed: ${consumer.id}`)
      // Update audio element if exists
      const audioElement = this.audioElements.get(consumer.id)
      if (audioElement) {
        audioElement.play().catch(error => {
          console.warn('Failed to resume audio playback:', error)
        })
      }
      this.notifyStateChange()
    })
  }

  // Device operations
  initializeDevice = (rtpCapabilities: types.RtpCapabilities): Effect.Effect<void, DeviceError> =>
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
          
          // Convert API RTP capabilities to native format
          const nativeRtpCapabilities = rtpCapabilities
          await device.load({ routerRtpCapabilities: nativeRtpCapabilities })
          
          // Store device's own RTP capabilities (intersection of router + browser capabilities)
          const deviceRtpCapabilities = device.rtpCapabilities
          
          this.device = Option.some(device)
          this.deviceLoaded = true
          this.rtpCapabilities = Option.some(deviceRtpCapabilities)
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

  getRtpCapabilities = (): Effect.Effect<Option.Option<types.RtpCapabilities>, never> =>
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
    rtpCapabilities: Option.Option<types.RtpCapabilities>
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
    this.setListenerWebSocket(ws)

  setDjWebSocket = (ws: WebSocket): Effect.Effect<void, never> =>
    Effect.sync(() => {
      this.djWebSocket = Option.some(ws)
      this.connectionType = 'dj'
      this.setupWebSocketEventHandlers(ws)
      this.notifyStateChange()
    })

  setListenerWebSocket = (ws: WebSocket): Effect.Effect<void, never> =>
    Effect.sync(() => {
      this.listenerWebSocket = Option.some(ws)
      this.connectionType = 'listener'
      this.setupWebSocketEventHandlers(ws)
      this.notifyStateChange()
    })

  sendCommand = (command: ClientCommand): Effect.Effect<void, WebRTCError> =>
    pipe(
      Effect.logTrace(`Preparing to send WebSocket command: ${command.type}`),
      Effect.andThen(() => Effect.sync(() => this.getActiveWebSocket(command))),
      Effect.andThen(wsOption =>
        Option.match(wsOption, {
          onNone: () => Effect.fail(new WebRTCError(
            'Appropriate WebSocket not connected - cannot send command',
            new Error(`Command: ${command.type}, Connection type: ${this.connectionType}`)
          )),
          onSome: (socket) => pipe(
            Effect.logTrace(`WebSocket state: ${socket.readyState} (${this.getWebSocketStateText(socket.readyState)})`),
            Effect.andThen(() => {
              // Check WebSocket state with detailed error reporting
              switch (socket.readyState) {
                case WebSocket.CONNECTING:
                  return Effect.fail(new WebRTCError(
                    'WebSocket is still connecting - command cannot be sent yet',
                    new Error(`Command: ${command.type}, State: CONNECTING`)
                  ))
                case WebSocket.OPEN:
                  return Effect.tryPromise({
                    try: async () => {
                      const message = JSON.stringify(command)
                      socket.send(message)
                    },
                    catch: (error) => new WebRTCError(
                      `Failed to send WebSocket message`,
                      error instanceof Error ? error : new Error(String(error))
                    )
                  })
                case WebSocket.CLOSING:
                  return Effect.fail(new WebRTCError(
                    'WebSocket is closing - cannot send command',
                    new Error(`Command: ${command.type}, State: CLOSING`)
                  ))
                case WebSocket.CLOSED:
                  return Effect.fail(new WebRTCError(
                    'WebSocket is closed - cannot send command',
                    new Error(`Command: ${command.type}, State: CLOSED`)
                  ))
                default:
                  return Effect.fail(new WebRTCError(
                    `Unknown WebSocket state: ${socket.readyState}`,
                    new Error(`Command: ${command.type}`)
                  ))
              }
            })
          )
        })
      ),
      Effect.tap(() => Effect.logInfo(
        `Successfully sent WebSocket command: ${command.type}`,
        { command_type: command.type, room_id: Option.getOrElse(this.roomId, () => 'unknown') }
      )),
      Effect.tapError((error) => Effect.logError(
        `Failed to send WebSocket command: ${command.type} - ${error.message}`,
        { command_type: command.type, error_message: error.message }
      ))
    )

  /**
   * Get the appropriate WebSocket for the given command
   */
  private getActiveWebSocket = (command: ClientCommand): Option.Option<WebSocket> => {
    // Determine which WebSocket to use based on command type
    switch (command.type) {
      // DJ commands use DJ WebSocket
      case 'connectDjTransport':
      case 'produce':
      case 'pauseStream':
      case 'resumeStream':
      case 'closeRoom':
        return this.djWebSocket
      
      // Listener commands use Listener WebSocket  
      case 'requestJoin':
      case 'connectListenerTransport':
      case 'leaveRoom':
      case 'requestConsumer':
        return this.listenerWebSocket
      
      default:
        // Fallback to current connection type
        return this.connectionType === 'dj' ? this.djWebSocket : this.listenerWebSocket
    }
  }

  /**
   * Get human-readable WebSocket state text
   */
  private getWebSocketStateText = (state: number): string => {
    switch (state) {
      case WebSocket.CONNECTING: return 'CONNECTING'
      case WebSocket.OPEN: return 'OPEN'
      case WebSocket.CLOSING: return 'CLOSING'
      case WebSocket.CLOSED: return 'CLOSED'
      default: return 'UNKNOWN'
    }
  }

  setRoomId = (roomId: string): Effect.Effect<void, never> =>
    Effect.sync(() => {
      this.roomId = Option.some(roomId)
      this.notifyStateChange()
    })

  sendWebSocketMessage = (message: ClientCommand): Effect.Effect<void, WebRTCError> =>
    this.sendCommand(message)

  private joinReadyPromises = new Map<string, {
    resolve: (value: any) => void,
    reject: (error: Error) => void
  }>()
  
  private routerCapabilitiesDeferred = new Map<string, Deferred.Deferred<types.RtpCapabilities, WebRTCError>>()

  waitForJoinReady = (roomId: string): Effect.Effect<{
    room: any,
    transportOptions: ApiTransportOptions,
    producerId: string,
    rtpCapabilities: types.RtpCapabilities
  }, WebRTCError> =>
    Effect.tryPromise({
      try: () => new Promise((resolve, reject) => {
        // Store the promise resolvers
        this.joinReadyPromises.set(roomId, { resolve, reject })
        
        // Clean up after timeout
        setTimeout(() => {
          const pending = this.joinReadyPromises.get(roomId)
          if (pending) {
            this.joinReadyPromises.delete(roomId)
            reject(new Error('Timeout waiting for joinReady'))
          }
        }, 30000) // 30 second timeout
      }),
      catch: (error) => new WebRTCError(
        'Failed to wait for joinReady event',
        error instanceof Error ? error : new Error(String(error))
      )
    })

  getRouterCapabilities = (roomId: string): Effect.Effect<types.RtpCapabilities, WebRTCError> => {
    const self = this
    return pipe(
      Effect.gen(function* (_) {
        // Send getRouterCapabilities command
        const command: ClientCommand = {
          type: 'getRouterCapabilities',
          roomId,
          _traceContext: {
            traceparent: 'dummy-trace',
            tracestate: null,
            metadata: null
          }
        }
        
        yield* _(self.sendWebSocketMessage(command))
        
        // Wait for routerCapabilities response
        const capabilities = yield* _(self.waitForRouterCapabilities(roomId))
        
        return capabilities
      })
    )
  }

  waitForRouterCapabilities = (roomId: string): Effect.Effect<types.RtpCapabilities, WebRTCError> => {
    const self = this
    return pipe(
      Effect.gen(function* (_) {
        // Create a new deferred for this room
        const deferred = yield* _(Deferred.make<types.RtpCapabilities, WebRTCError>())
        
        // Store the deferred
        self.routerCapabilitiesDeferred.set(roomId, deferred)
        
        // Set up timeout cleanup
        const timeoutFiber = yield* _(
          pipe(
            Effect.sleep(30000), // 30 second timeout
            Effect.andThen(() => {
              self.routerCapabilitiesDeferred.delete(roomId)
              return Deferred.fail(deferred, new WebRTCError('Timeout waiting for router capabilities'))
            }),
            Effect.fork
          )
        )
        
        // Wait for the deferred to be resolved
        const result = yield* _(Deferred.await(deferred))
        
        // Cancel timeout fiber
        yield* _(Fiber.interrupt(timeoutFiber))
        
        return result
      })
    )
  }

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
        
        // Call the MediaSoup callback with the backend producer ID
        // Since we only support one producer at a time, get the first available callback
        const [firstKey, callback] = this.producerCallbacks.entries().next().value || [null, null]
        if (callback) {
          // Call the MediaSoup callback with backend producer ID
          callback({ id: event.producerId })
          this.producerCallbacks.delete(firstKey)
          console.info(`MediaSoup callback called with backend producer ID: ${event.producerId}`)
        } else {
          console.warn('ProducerCreated event received but no callback found')
        }
        
        this.notifyStateChange()
        break
        
      case 'consumerCreated':
        // Consumer was created, we can start consuming
        console.info(`Consumer created: ${event.consumerId} for producer ${event.producerId}`)
        
        // Get the waiting deferred for this producer
        const consumerDeferred = this.consumerCreationPromises.get(event.producerId)
        if (consumerDeferred) {
          // Use the parameters from the server to create the actual consumer
          const consumeEffect = pipe(
            this.consume(event.consumerParameters),
            Effect.tap((consumerId) => Effect.logInfo(`Successfully consumed: ${consumerId} for producer ${event.producerId}`)),
            Effect.andThen((consumerId) => Deferred.succeed(consumerDeferred, consumerId)),
            Effect.tapError((error) => {
              console.error('Failed to consume after ConsumerCreated event:', error)
              return Deferred.fail(consumerDeferred, error)
            }),
            Effect.catchAll((error) => {
              // Ensure deferred is resolved even on error
              return Deferred.fail(consumerDeferred, error instanceof ConsumerError ? error : new ConsumerError('Consumer creation failed', error))
            })
          )
          
          // Run the effect to complete consumer creation
          Effect.runFork(consumeEffect)
          
          // Clean up the promise map
          this.consumerCreationPromises.delete(event.producerId)
        } else {
          console.warn(`Received ConsumerCreated event for producer ${event.producerId} but no pending request found`)
        }
        
        this.notifyStateChange()
        break
        
      case 'streamPaused':
        console.info(`Stream paused in room: ${event.roomId}`)
        // For listeners: update remote DJ pause state
        Option.match(this.roomId, {
          onNone: () => {},
          onSome: (currentRoomId) => {
            if (currentRoomId === event.roomId) {
              // Update remote DJ pause state (for listeners)
              this.remoteDJPauseState = true
              this.notifyProducerPauseChange()
              this.notifyStateChange()
            }
          }
        })
        break
        
      case 'streamResumed':
        console.info(`Stream resumed in room: ${event.roomId}`)
        // For listeners: update remote DJ pause state
        Option.match(this.roomId, {
          onNone: () => {},
          onSome: (currentRoomId) => {
            if (currentRoomId === event.roomId) {
              // Update remote DJ pause state (for listeners)
              this.remoteDJPauseState = false
              this.notifyProducerPauseChange()
              this.notifyStateChange()
            }
          }
        })
        break
        
      case 'routerCapabilities':
        // Router capabilities received for device initialization
        console.info(`Router capabilities received for room: ${event.roomId}`)
        // Store RTP capabilities for device initialization
        this.rtpCapabilities = Option.some(event.rtpCapabilities)
        // Resolve waiting Effect
        const routerCapsDeferred = this.routerCapabilitiesDeferred.get(event.roomId)
        if (routerCapsDeferred) {
          Effect.runFork(Deferred.succeed(routerCapsDeferred, event.rtpCapabilities))
          this.routerCapabilitiesDeferred.delete(event.roomId)
        }
        this.notifyStateChange()
        break
        
      case 'joinReady':
        // Room is ready for joining (listener flow)
        console.info(`Join ready for room: ${event.room.id}`)
        this.roomId = Option.some(event.room.id)
        // Store RTP capabilities for device initialization
        this.rtpCapabilities = Option.some(event.rtpCapabilities)
        
        // Initialize remote DJ pause state from room info (for listeners)
        // is_streaming = true means DJ is actively streaming (not paused)
        this.remoteDJPauseState = !event.room.isStreaming
        
        // Resolve waiting promise
        const pending = this.joinReadyPromises.get(event.room.id)
        if (pending) {
          pending.resolve({
            room: event.room,
            transportOptions: event.transportOptions,
            producerId: event.producerId,
            rtpCapabilities: event.rtpCapabilities
          })
          this.joinReadyPromises.delete(event.room.id)
        }
        this.notifyStateChange()
        this.notifyProducerPauseChange() // Notify initial pause state
        break
        
      case 'roomJoined':
        // Successfully joined a room as listener
        console.info(`Joined room: ${event.room.id}`)
        this.roomId = Option.some(event.room.id)
        // Store RTP capabilities for device initialization (convert from API format)
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

  ensureDevice = (rtpCapabilities: types.RtpCapabilities): Effect.Effect<Device, DeviceError> =>
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
  createSendTransport = (options: ApiTransportOptions): Effect.Effect<void, TransportError> =>
    pipe(
      this.device,
      Option.match({
        onNone: () => Effect.fail(new TransportError('Device not initialized')),
        onSome: (device) => Effect.sync(() => {
          // Convert API transport options to native format
          const nativeOptions = TransportOptionsFromApi.decode(options)
          const transport = device.createSendTransport({
            id: nativeOptions.id,
            iceParameters: nativeOptions.iceParameters,
            iceCandidates: nativeOptions.iceCandidates,
            dtlsParameters: nativeOptions.dtlsParameters,
            sctpParameters: nativeOptions.sctpParameters,
          })

          // CRITICAL: Set up produce event handler immediately
          transport.on('produce', async (parameters, callback, errback) => {
            try {
              // Send produce command to backend via WebSocket
              const wsOption = this.connectionType === 'dj' ? this.djWebSocket : this.listenerWebSocket
              
              if (Option.isNone(wsOption)) {
                throw new Error('WebSocket not connected')
              }
              
              const ws = wsOption.value
              if (ws.readyState !== WebSocket.OPEN) {
                throw new Error(`WebSocket not ready: state=${ws.readyState}`)
              }
              
              const command: ClientCommand = {
                type: 'produce',
                rtpParameters: parameters.rtpParameters,
                _traceContext: getWebSocketTraceContext()
              }
              
              // Store the callback to be called when ProducerCreated event arrives
              const requestKey = Date.now().toString()
              this.producerCallbacks.set(requestKey, callback)
              
              const message = JSON.stringify(command)
              ws.send(message)
              
              console.info('Produce command sent to backend, waiting for ProducerCreated event')
              
            } catch (error) {
              console.error('Failed to send produce command:', error)
              errback(error instanceof Error ? error : new Error(String(error)))
            }
          })
          
          // Store transport and set up other events
          this.transports.set(transport.id, transport)
          this.sendTransport = Option.some(transport)
          this.setupTransportEvents(transport, 'send')
          this.notifyStateChange()
        })
      }),
      Effect.tap(() => Effect.logInfo(`Created send transport: ${options.id}`))
    )

  createReceiveTransport = (options: ApiTransportOptions): Effect.Effect<void, TransportError> =>
    pipe(
      this.device,
      Option.match({
        onNone: () => Effect.fail(new TransportError('Device not initialized')),
        onSome: (device) => Effect.sync(() => {
          // Convert API transport options to native format
          const nativeOptions = TransportOptionsFromApi.decode(options)
          const transport = device.createRecvTransport({
            id: nativeOptions.id,
            iceParameters: nativeOptions.iceParameters,
            iceCandidates: nativeOptions.iceCandidates,
            dtlsParameters: nativeOptions.dtlsParameters,
            sctpParameters: nativeOptions.sctpParameters,
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
      Effect.logTrace(`Starting producer creation process`),
      Effect.andThen(() => Effect.sync(() => ({
        sendTransport: this.sendTransport,
        roomId: this.roomId,
        trackId: track.id,
        trackKind: track.kind,
        trackLabel: track.label
      }))),
      Effect.tap(({ trackId, trackKind, trackLabel }) => 
        Effect.logInfo(
          `Producing track: ${trackKind} track with ID ${trackId}`,
          { track_id: trackId, track_kind: trackKind, track_label: trackLabel }
        )
      ),
      Effect.andThen(({ sendTransport, roomId }) =>
        Option.match(sendTransport, {
          onNone: () => Effect.fail(new ProducerError(
            'Send transport not available - cannot produce track',
            new Error(`Room: ${Option.getOrElse(roomId, () => 'unknown')}`)
          )),
          onSome: (transport) => pipe(
            Effect.logTrace(`Using send transport: ${transport.id}`),
            Effect.andThen(() => Effect.succeed(transport))
          )
        })
      ),
      Effect.tap(() => Effect.logTrace('About to call transport.produce() - produce event should fire during this call')),
      Effect.andThen(transport =>
        Effect.tryPromise({
          try: async () => {
            // Call transport.produce() which will:
            // 1. Trigger the 'produce' event
            // 2. Send command to backend
            // 3. Wait for backend to create producer
            // 4. Receive backend producer ID via callback
            // 5. Complete with producer that has backend ID
            const producer = await transport.produce({
              track,
              codecOptions: {
                opusStereo: true,
                opusDtx: false, // Disable DTX - bad for music (cuts silence)
              },
              encodings: [
                { maxBitrate: 128000 } // 128 kbps for stereo music quality
              ],
            })
            
            // The producer now has the backend's ID (set via callback)
            const backendProducerId = producer.id
            
            // Store producer with backend ID
            this.producers.set(backendProducerId, producer)
            this.setupProducerEvents(producer)
            this.notifyStateChange()
            
            return backendProducerId
          },
          catch: (error) => new ProducerError(
            `Failed to create producer via MediaSoup transport`,
            error instanceof Error ? error : new Error(String(error))
          )
        })
      ),
      Effect.tap((producerId) => Effect.logInfo(
        `Successfully created producer with backend ID: ${producerId}`,
        { 
          producer_id: producerId,
          track_kind: track.kind,
          room_id: Option.getOrElse(this.roomId, () => 'unknown')
        }
      )),
      Effect.tapError((error) => Effect.logError(
        `Producer creation failed: ${error.message}`,
        { 
          error_message: error.message,
          track_kind: track.kind,
          room_id: Option.getOrElse(this.roomId, () => 'unknown')
        }
      ))
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
            this.notifyProducerPauseChange() // Notify producer pause state change
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
            this.notifyProducerPauseChange() // Notify producer pause state change
          },
          catch: (error) => new ProducerError(`Failed to resume producer: ${error}`, error)
        })
      ),
      Effect.tap(() => Effect.logInfo(`Resumed producer: ${producerId}`))
    )

  pauseStream = (): Effect.Effect<void, ProducerError> =>
    pipe(
      Effect.logInfo('Pausing stream - both local producer and backend'),
      Effect.andThen(() => this.getAllProducers()),
      Effect.andThen(producers => {
        if (producers.length === 0) {
          return Effect.fail(new ProducerError('No producer found to pause'))
        }
        
        // Pause local producer first
        const localPauseEffect = this.pauseProducer(producers[0].id)
        
        // Send WebSocket command to backend
        const sendCommandEffect = pipe(
          Effect.succeed(this.djWebSocket),
          Effect.andThen(ws =>
            Option.match(ws, {
              onNone: () => Effect.fail(new ProducerError('No WebSocket connection')),
              onSome: (websocket) =>
                Effect.tryPromise({
                  try: async () => {
                    if (websocket.readyState === WebSocket.OPEN) {
                      const command = {
                        type: 'pauseStream',
                        _traceContext: {
                          traceparent: 'dummy',
                          tracestate: null,
                          metadata: null
                        }
                      }
                      websocket.send(JSON.stringify(command))
                    } else {
                      throw new Error('WebSocket not ready')
                    }
                  },
                  catch: (error) => new ProducerError(`Failed to send pause command: ${error}`, error)
                })
            })
          )
        )
        
        // Run both operations
        return pipe(
          localPauseEffect,
          Effect.andThen(() => sendCommandEffect)
        )
      })
    )

  resumeStream = (): Effect.Effect<void, ProducerError> =>
    pipe(
      Effect.logInfo('Resuming stream - both local producer and backend'),
      Effect.andThen(() => this.getAllProducers()),
      Effect.andThen(producers => {
        if (producers.length === 0) {
          return Effect.fail(new ProducerError('No producer found to resume'))
        }
        
        // Resume local producer first
        const localResumeEffect = this.resumeProducer(producers[0].id)
        
        // Send WebSocket command to backend
        const sendCommandEffect = pipe(
          Effect.succeed(this.djWebSocket),
          Effect.andThen(ws =>
            Option.match(ws, {
              onNone: () => Effect.fail(new ProducerError('No WebSocket connection')),
              onSome: (websocket) =>
                Effect.tryPromise({
                  try: async () => {
                    if (websocket.readyState === WebSocket.OPEN) {
                      const command = {
                        type: 'resumeStream',
                        _traceContext: {
                          traceparent: 'dummy',
                          tracestate: null,
                          metadata: null
                        }
                      }
                      websocket.send(JSON.stringify(command))
                    } else {
                      throw new Error('WebSocket not ready')
                    }
                  },
                  catch: (error) => new ProducerError(`Failed to send resume command: ${error}`, error)
                })
            })
          )
        )
        
        // Run both operations
        return pipe(
          localResumeEffect,
          Effect.andThen(() => sendCommandEffect)
        )
      })
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

  getAllProducers = (): Effect.Effect<types.Producer[], never> =>
    Effect.succeed(Array.from(this.producers.values()))

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
  consume = (options: ApiConsumerParameters): Effect.Effect<string, ConsumerError> =>
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
            // Convert API consumer options to native format
            const nativeOptions = ConsumerOptionsFromApi.decode(options)
            const consumer = await transport.consume(nativeOptions)
            
            // Store consumer and set up events
            this.consumers.set(consumer.id, consumer)
            this.setupConsumerEvents(consumer)
            
            // Always resume consumer - MediaSoup handles producer pause state internally
            if (consumer.paused) {
              await consumer.resume()
            }
            
            this.notifyStateChange()
            
            return consumer.id
          },
          catch: (error) => new ConsumerError(`Failed to create consumer: ${error}`, error)
        })
      ),
      Effect.tap((id) => Effect.logInfo(`Created consumer: ${id}`))
    )

  // Map to store pending consumer creation requests
  private consumerCreationPromises = new Map<string, Deferred.Deferred<string, ConsumerError>>()
  
  // Map to store MediaSoup produce callbacks (request key -> callback)
  private producerCallbacks = new Map<string, (result: { id: string }) => void>()
  

  createConsumerFromProducer = (producerId: string): Effect.Effect<string, ConsumerError> =>
    pipe(
      Effect.logInfo(`Requesting consumer creation for producer: ${producerId}`),
      Effect.andThen(() => Effect.sync(() => this.receiveTransport)),
      Effect.andThen(transportOpt =>
        Option.match(transportOpt, {
          onNone: () => Effect.fail(new ConsumerError('Receive transport not available for consumer creation')),
          onSome: (transport) => Effect.succeed(transport)
        })
      ),
      Effect.andThen(_transport =>
        pipe(
          // Create deferred for this producer's consumer creation
          Deferred.make<string, ConsumerError>(),
          Effect.andThen(deferred => {
            // Store the deferred for this producer
            this.consumerCreationPromises.set(producerId, deferred)
            
            // Set up timeout cleanup
            const timeoutId = setTimeout(() => {
              this.consumerCreationPromises.delete(producerId)
              Effect.runFork(Deferred.fail(deferred, new ConsumerError('Timeout waiting for consumer creation')))
            }, 30000)
            
            // Send requestConsumer command to backend to trigger consumer creation
            const requestConsumerEffect = this.sendWebSocketMessage({
              type: 'requestConsumer',
              producerId: producerId,
              _traceContext: { traceparent: 'dummy', tracestate: null, metadata: null }
            })
            
            Effect.runFork(requestConsumerEffect.pipe(
              Effect.tapError(error => {
                console.error('Failed to send requestConsumer command:', error)
                this.consumerCreationPromises.delete(producerId)
                return Deferred.fail(deferred, new ConsumerError('Failed to request consumer creation'))
              })
            ))
            
            // The consumer creation will be completed when we receive the ConsumerCreated event
            // The transport 'connect' event will fire when we actually call transport.consume() with real parameters
            
            return pipe(
              // Wait for the backend to send ConsumerCreated event with actual consumer parameters
              Deferred.await(deferred),
              Effect.tap(() => Effect.sync(() => clearTimeout(timeoutId)))
            )
          })
        )
      ),
      Effect.tap((id) => Effect.logInfo(`Consumer creation completed: ${id} for producer: ${producerId}`))
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
        
        // Try to play immediately, handle autoplay restrictions
        if (autoplay) {
          audioElement.play().catch((error) => {
            console.warn('Autoplay blocked by browser, user interaction required:', error)
            // Mark that manual play is needed
            audioElement.setAttribute('data-autoplay-blocked', 'true')
          })
        }
        
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

  // Producer pause state operations (MediaSoup state as single source of truth)
  getProducerPausedState = (): Effect.Effect<boolean, never> =>
    Effect.succeed(this.getProducerPauseState())

  subscribeToProducerPauseState = (callback: (isPaused: boolean) => void): Effect.Effect<() => void, never> =>
    Effect.sync(() => {
      this.producerPauseSubscribers.add(callback)
      
      // Send initial state
      callback(this.getProducerPauseState())
      
      // Return cleanup function
      return () => {
        this.producerPauseSubscribers.delete(callback)
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
        this.djWebSocket = Option.none()
        this.listenerWebSocket = Option.none()
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