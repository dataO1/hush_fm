/**
 * MediaSoup Transport Service
 * 
 * Extracted service for managing MediaSoup Transport lifecycle:
 * - Send/Receive transport creation
 * - Transport connection and state management
 * - ICE/DTLS state tracking
 * - Transport statistics and diagnostics
 * 
 * Pure Effect-TS service with minimal WebSocket dependencies.
 */

import { Effect, pipe, Option, Context, Layer } from 'effect'
import { Device, types } from 'mediasoup-client'
import type { TransportOptions as ApiTransportOptions } from '../generated/hushFMAPI.schemas'
import { TransportOptionsFromApi, type InternalTransportOptions } from '../websocket/schemas/websocket'

/**
 * Transport Service Errors
 */
export class TransportError extends Error {
  public readonly cause?: unknown
  
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'TransportError'
    this.cause = cause
  }
}

export class TransportConnectionError extends TransportError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'TransportConnectionError'
  }
}

export class TransportCreationError extends TransportError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'TransportCreationError'
  }
}

/**
 * Transport Connection States
 */
export type ConnectionState = 'new' | 'connecting' | 'connected' | 'disconnecting' | 'disconnected' | 'failed'

/**
 * Transport State Information
 */
export interface TransportState {
  id: string
  direction: 'send' | 'receive'
  connectionState: ConnectionState
  iceState: Option.Option<RTCIceConnectionState>
  dtlsState: Option.Option<RTCDtlsTransportState>
  transport: Option.Option<types.Transport>
}

/**
 * Transport Statistics
 */
export interface TransportStats {
  id: string
  direction: 'send' | 'receive'
  bytesReceived?: number
  bytesSent?: number
  packetsReceived?: number
  packetsSent?: number
  roundTripTime?: number
  timestamp: Date
}

/**
 * Transport Event Callbacks
 */
export interface TransportCallbacks {
  onConnect?: (dtlsParameters: any) => Promise<void>
  onConnectionStateChange?: (state: ConnectionState) => void
  onProduce?: (parameters: any, callback: (params: { id: string }) => void, errback: (error: Error) => void) => void
}

/**
 * Transport Service Interface
 */
export interface MediaSoupTransportService {
  /**
   * Create send transport
   */
  readonly createSendTransport: (
    device: Device, 
    options: ApiTransportOptions,
    callbacks?: TransportCallbacks
  ) => Effect.Effect<types.Transport, TransportCreationError>
  
  /**
   * Create receive transport
   */
  readonly createReceiveTransport: (
    device: Device,
    options: ApiTransportOptions,
    callbacks?: TransportCallbacks
  ) => Effect.Effect<types.Transport, TransportCreationError>
  
  /**
   * Connect transport with DTLS parameters
   */
  readonly connectTransport: (
    transport: types.Transport,
    dtlsParameters: any
  ) => Effect.Effect<void, TransportConnectionError>
  
  /**
   * Get transport statistics
   */
  readonly getTransportStats: (transport: types.Transport) => Effect.Effect<any, TransportError>
  
  /**
   * Restart ICE for transport
   */
  readonly restartIce: (
    transport: types.Transport,
    iceParameters?: any
  ) => Effect.Effect<void, TransportError>
  
  /**
   * Close transport
   */
  readonly closeTransport: (transport: types.Transport) => Effect.Effect<void, never>
  
  /**
   * Get transport state
   */
  readonly getTransportState: (transport: types.Transport) => Effect.Effect<TransportState, never>
  
  /**
   * Setup transport event handlers
   */
  readonly setupTransportEvents: (
    transport: types.Transport,
    direction: 'send' | 'receive',
    callbacks?: TransportCallbacks
  ) => Effect.Effect<void, never>
  
  /**
   * Validate transport options
   */
  readonly validateTransportOptions: (options: ApiTransportOptions) => Effect.Effect<InternalTransportOptions, TransportError>
}

/**
 * Transport Service Implementation
 */
class MediaSoupTransportServiceImpl implements MediaSoupTransportService {
  
  /**
   * Create send transport
   */
  createSendTransport = (
    device: Device, 
    options: ApiTransportOptions,
    callbacks?: TransportCallbacks
  ): Effect.Effect<types.Transport, TransportCreationError> =>
    pipe(
      this.validateTransportOptions(options),
      Effect.andThen(nativeOptions =>
        Effect.tryPromise({
          try: async () => {
            if (!device.loaded) {
              throw new Error('Device not loaded')
            }

            const transport = device.createSendTransport({
              id: nativeOptions.id,
              iceParameters: nativeOptions.iceParameters,
              iceCandidates: nativeOptions.iceCandidates,
              dtlsParameters: nativeOptions.dtlsParameters,
              sctpParameters: nativeOptions.sctpParameters,
              // Local network optimization
              iceServers: [],
              iceTransportPolicy: 'all',
            })

            // Set up event handlers
            await this.setupTransportEventHandlers(transport, 'send', callbacks)
            
            console.info('✅ Created send transport successfully', {
              transport_id: transport.id,
              direction: 'send',
              ice_role: 'controlling'
            })

            return transport
          },
          catch: (error) => new TransportCreationError(
            `Failed to create send transport: ${error}`,
            error
          )
        })
      ),
      Effect.tap(transport => Effect.logInfo(`Created send transport: ${transport.id}`))
    )

  /**
   * Create receive transport
   */
  createReceiveTransport = (
    device: Device,
    options: ApiTransportOptions,
    callbacks?: TransportCallbacks
  ): Effect.Effect<types.Transport, TransportCreationError> =>
    pipe(
      this.validateTransportOptions(options),
      Effect.andThen(nativeOptions =>
        Effect.tryPromise({
          try: async () => {
            if (!device.loaded) {
              throw new Error('Device not loaded')
            }

            const transport = device.createRecvTransport({
              id: nativeOptions.id,
              iceParameters: nativeOptions.iceParameters,
              iceCandidates: nativeOptions.iceCandidates,
              dtlsParameters: nativeOptions.dtlsParameters,
              sctpParameters: nativeOptions.sctpParameters,
              // Local network optimization
              iceServers: [],
              iceTransportPolicy: 'all',
            })

            // Set up event handlers
            await this.setupTransportEventHandlers(transport, 'receive', callbacks)
            
            console.info('✅ Created receive transport successfully', {
              transport_id: transport.id,
              direction: 'receive',
              ice_role: 'controlled'
            })

            return transport
          },
          catch: (error) => new TransportCreationError(
            `Failed to create receive transport: ${error}`,
            error
          )
        })
      ),
      Effect.tap(transport => Effect.logInfo(`Created receive transport: ${transport.id}`))
    )

  /**
   * Connect transport with DTLS parameters
   */
  connectTransport = (
    transport: types.Transport,
    dtlsParameters: any
  ): Effect.Effect<void, TransportConnectionError> =>
    pipe(
      Effect.tryPromise({
        try: async () => {
          console.info('🔗 Connecting transport with DTLS parameters', {
            transport_id: transport.id,
            dtls_parameters: dtlsParameters
          })

          // Note: connect method signature may vary by mediasoup-client version
          await (transport as any).connect({ dtlsParameters })
          
          console.info('✅ Transport connected successfully', {
            transport_id: transport.id,
            connection_state: transport.connectionState
          })
        },
        catch: (error) => new TransportConnectionError(
          `Failed to connect transport ${transport.id}: ${error}`,
          error
        )
      }),
      Effect.tap(() => Effect.logInfo(`Connected transport: ${transport.id}`))
    )

  /**
   * Get transport statistics
   */
  getTransportStats = (transport: types.Transport): Effect.Effect<any, TransportError> =>
    pipe(
      Effect.tryPromise({
        try: () => transport.getStats(),
        catch: (error) => new TransportError(
          `Failed to get transport stats: ${error}`,
          error
        )
      }),
      Effect.tap(() => Effect.logDebug(`Retrieved stats for transport: ${transport.id}`))
    )

  /**
   * Restart ICE for transport
   */
  restartIce = (
    transport: types.Transport,
    iceParameters?: any
  ): Effect.Effect<void, TransportError> =>
    pipe(
      Effect.tryPromise({
        try: () => {
          const params = iceParameters || {
            iceParameters: {
              usernameFragment: 'local',
              password: 'localpass'
            }
          }
          return transport.restartIce(params)
        },
        catch: (error) => new TransportError(
          `Failed to restart ICE for transport ${transport.id}: ${error}`,
          error
        )
      }),
      Effect.tap(() => Effect.logInfo(`Restarted ICE for transport: ${transport.id}`))
    )

  /**
   * Close transport
   */
  closeTransport = (transport: types.Transport): Effect.Effect<void, never> =>
    pipe(
      Effect.sync(() => {
        console.info('🔒 Closing transport', {
          transport_id: transport.id,
          direction: transport.constructor.name.includes('Send') ? 'send' : 'receive'
        })
        transport.close()
      }),
      Effect.tap(() => Effect.logInfo(`Closed transport: ${transport.id}`))
    )

  /**
   * Get transport state
   */
  getTransportState = (transport: types.Transport): Effect.Effect<TransportState, never> =>
    Effect.sync(() => ({
      id: transport.id,
      direction: transport.constructor.name.includes('Send') ? 'send' : 'receive',
      connectionState: transport.connectionState as ConnectionState,
      iceState: Option.fromNullable((transport as any).iceState),
      dtlsState: Option.fromNullable((transport as any).dtlsState),
      transport: Option.some(transport)
    }))

  /**
   * Setup transport event handlers
   */
  setupTransportEvents = (
    transport: types.Transport,
    direction: 'send' | 'receive',
    callbacks?: TransportCallbacks
  ): Effect.Effect<void, never> =>
    Effect.sync(() => {
      this.setupTransportEventHandlers(transport, direction, callbacks)
    })

  /**
   * Validate transport options
   */
  validateTransportOptions = (options: ApiTransportOptions): Effect.Effect<InternalTransportOptions, TransportError> =>
    pipe(
      Effect.try({
        try: () => TransportOptionsFromApi.decode(options),
        catch: (error) => new TransportError(
          `Invalid transport options: ${error}`,
          error
        )
      })
    )

  /**
   * Setup transport event handlers (private method)
   */
  private setupTransportEventHandlers = async (
    transport: types.Transport,
    direction: 'send' | 'receive',
    callbacks?: TransportCallbacks
  ) => {
    // Connection state change events
    transport.on('connectionstatechange', (state) => {
      console.info(`🔄 ${direction} transport connection state changed: ${state}`, {
        transport_id: transport.id,
        connection_state: state,
        ice_state: (transport as any).iceState,
        dtls_state: (transport as any).dtlsState
      })
      callbacks?.onConnectionStateChange?.(state as ConnectionState)
    })

    // ICE state change events (may not be available in all versions)
    // transport.on('icestatechange', (iceState) => {
    //   console.info(`🧊 ${direction} transport ICE state changed: ${iceState}`, {
    //     transport_id: transport.id,
    //     ice_state: iceState
    //   })
    // })

    // DTLS state change events (may not be available in all versions)
    // transport.on('dtlsstatechange', (dtlsState) => {
    //   console.info(`🔐 ${direction} transport DTLS state changed: ${dtlsState}`, {
    //     transport_id: transport.id,
    //     dtls_state: dtlsState
    //   })
    // })

    // Connect event
    transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      try {
        console.info(`🔗 ${direction} transport connect event triggered`, {
          transport_id: transport.id,
          dtls_parameters: dtlsParameters
        })
        
        if (callbacks?.onConnect) {
          await callbacks.onConnect(dtlsParameters)
        }
        callback()
      } catch (error) {
        console.error(`❌ ${direction} transport connect failed:`, error)
        errback(error instanceof Error ? error : new Error(String(error)))
      }
    })

    // Produce event (only for send transports)
    if (direction === 'send') {
      transport.on('produce', async (parameters, callback, errback) => {
        try {
          console.info('🎵 Send transport produce event triggered', {
            transport_id: transport.id,
            rtp_parameters: parameters.rtpParameters
          })
          
          if (callbacks?.onProduce) {
            callbacks.onProduce(parameters, callback, errback)
          } else {
            // Default behavior if no callback provided
            errback(new Error('No produce callback provided'))
          }
        } catch (error) {
          console.error('❌ Producer creation failed:', error)
          errback(error instanceof Error ? error : new Error(String(error)))
        }
      })
    }
  }
}

/**
 * Service Context and Layer
 */
export const MediaSoupTransportService = Context.GenericTag<MediaSoupTransportService>('MediaSoupTransportService')

export const MediaSoupTransportServiceLive = Layer.succeed(
  MediaSoupTransportService,
  new MediaSoupTransportServiceImpl()
)

/**
 * Helper functions for working with transport service
 */

/**
 * Create send transport with event setup
 */
export const createSendTransportWithEvents = (
  device: Device,
  options: ApiTransportOptions,
  callbacks: TransportCallbacks
): Effect.Effect<types.Transport, TransportCreationError, never> =>
  pipe(
    MediaSoupTransportService,
    Effect.andThen(service => 
      service.createSendTransport(device, options, callbacks)
    ),
    Effect.provide(MediaSoupTransportServiceLive)
  )

/**
 * Create receive transport with event setup
 */
export const createReceiveTransportWithEvents = (
  device: Device,
  options: ApiTransportOptions,
  callbacks: TransportCallbacks
): Effect.Effect<types.Transport, TransportCreationError, never> =>
  pipe(
    MediaSoupTransportService,
    Effect.andThen(service => 
      service.createReceiveTransport(device, options, callbacks)
    ),
    Effect.provide(MediaSoupTransportServiceLive)
  )

/**
 * Connect transport and get state
 */
export const connectTransportAndGetState = (
  transport: types.Transport,
  dtlsParameters: any
): Effect.Effect<TransportState, TransportConnectionError, never> =>
  pipe(
    MediaSoupTransportService,
    Effect.andThen(service =>
      pipe(
        service.connectTransport(transport, dtlsParameters),
        Effect.andThen(() => service.getTransportState(transport))
      )
    ),
    Effect.provide(MediaSoupTransportServiceLive)
  )

/**
 * Get transport statistics with error handling
 */
export const getTransportStatsWithRetry = (
  transport: types.Transport,
  maxRetries: number = 3
): Effect.Effect<any, TransportError, never> =>
  pipe(
    MediaSoupTransportService,
    Effect.andThen(service => 
      pipe(
        service.getTransportStats(transport),
        Effect.retry({ times: maxRetries })
      )
    ),
    Effect.provide(MediaSoupTransportServiceLive)
  )