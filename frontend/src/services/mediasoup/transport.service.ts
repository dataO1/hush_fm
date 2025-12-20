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
import { WebRTCConnectionState } from '../../domain/schemas/room.schema'

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
 * Transport State Information
 */
export interface TransportState {
  id: string
  direction: 'send' | 'receive'
  connectionState: string // Raw MediaSoup transport connection state
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
  onConnectionStateChange?: (state: string) => void
  onWebRTCStateChange?: (state: WebRTCConnectionState, details?: { error?: Error, iceState?: string, connectionState?: string }) => void
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

  /**
   * Wait for WebRTC connection using comprehensive event monitoring
   * Includes handler tracking to prevent duplicate connections
   */
  readonly waitForWebRTCConnection: (
    transport: types.Transport,
    timeoutMs: number,
    handlerContext: { type: 'listener'; listenerId: string } | { type: 'dj' }
  ) => Effect.Effect<WebRTCConnectionState, TransportConnectionError>
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
              // Use backend-provided ICE configuration (no override)
            })

            // Set up event handlers
            await this.setupTransportEventHandlers(transport, 'send', callbacks)

            console.info('✅ Created send transport successfully', {
              transport_id: transport.id,
              direction: 'send',
              ice_role: 'controlling',
              id: nativeOptions.id,
              iceParameters: nativeOptions.iceParameters,
              iceCandidates: nativeOptions.iceCandidates,
              dtlsParameters: nativeOptions.dtlsParameters,
              sctpParameters: nativeOptions.sctpParameters,
              // Use backend-provided ICE configuration (no override)
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
              // Use backend-provided ICE configuration (no override)
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
      connectionState: transport.connectionState,
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
   * Wait for WebRTC connection using comprehensive event monitoring
   * Includes handler tracking to prevent duplicate connections
   */
  waitForWebRTCConnection = (
    transport: types.Transport,
    timeoutMs: number = 10000,
    handlerContext: { type: 'listener'; listenerId: string } | { type: 'dj' }
  ): Effect.Effect<WebRTCConnectionState, TransportConnectionError> =>
    pipe(
      Effect.async<WebRTCConnectionState, TransportConnectionError>((resume) => {
        // Get room store for handler tracking
        const { getRoomStore } = require('../../stores/room.store')
        const roomStore = getRoomStore()
        
        // Check for existing timeout ID and clear it
        let existingTimeoutId: number | null = null
        if (handlerContext.type === 'listener') {
          existingTimeoutId = roomStore.actions.getListenerConnectionTimeoutId(handlerContext.listenerId)
        } else {
          existingTimeoutId = roomStore.actions.getDJConnectionTimeoutId()
        }
        
        if (existingTimeoutId !== null) {
          console.warn(`🧹 Clearing existing WebRTC timeout: ${existingTimeoutId} for transport: ${transport.id}`)
          clearTimeout(existingTimeoutId)
        }

        let resolved = false
        let timeoutHandle: NodeJS.Timeout

        // Comprehensive WebRTC state tracking
        let iceGatheringCompleted = false
        let connectionEstablished = false
        let hasError = false

        const checkCurrentState = () => {
          const currentConnectionState = transport.connectionState
          const currentIceState = (transport as any).iceGatheringState

          console.info(`🔍 WebRTC validation: current states`, {
            connection_state: currentConnectionState,
            ice_gathering_state: currentIceState,
            transport_id: transport.id
          })

          // Check if already connected
          if (currentConnectionState === 'connected' && currentIceState === 'complete') {
            iceGatheringCompleted = true
            connectionEstablished = true
            return WebRTCConnectionState.CONNECTED
          }

          // Check if already failed
          if (currentConnectionState === 'failed' || currentConnectionState === 'disconnected') {
            hasError = true
            return WebRTCConnectionState.FAILED
          }

          // Initialize state tracking based on current state
          if (currentIceState === 'complete') {
            iceGatheringCompleted = true
          }
          if (currentConnectionState === 'connected') {
            connectionEstablished = true
          }

          return null
        }

        const updateWebRTCState = (eventType: string) => {
          if (resolved) return

          if (hasError) {
            resolved = true
            cleanup()
            console.info(`❌ WebRTC connection failed (${eventType})`)
            resume(Effect.succeed(WebRTCConnectionState.FAILED))
            return
          }

          // Connection is only considered 'connected' when BOTH ICE gathering completes AND connection is established
          if (iceGatheringCompleted && connectionEstablished) {
            resolved = true
            cleanup()
            console.info(`✅ WebRTC connection established (${eventType})`)
            resume(Effect.succeed(WebRTCConnectionState.CONNECTED))
          }
          // Otherwise stay in connecting state
        }

        const cleanup = () => {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle)
          }
          transport.removeListener('icegatheringstatechange', iceGatheringHandler)
          transport.removeListener('icecandidateerror', iceCandidateErrorHandler)
          transport.removeListener('connectionstatechange', connectionStateHandler)
          
          // Clear timeout ID from store when done
          if (handlerContext.type === 'listener') {
            roomStore.actions.updateListenerTransportState(handlerContext.listenerId, {
              activeConnectionTimeoutId: Option.none()
            })
          } else {
            const currentTransport = Option.getOrNull(roomStore.state.participants.dj.sendTransport)
            if (currentTransport) {
              roomStore.actions.updateDJState({
                sendTransport: Option.some({
                  ...currentTransport,
                  activeConnectionTimeoutId: Option.none()
                })
              })
            }
          }
        }

        // Event handlers
        const iceGatheringHandler = (iceGatheringState: string) => {
          console.info(`🧊 WebRTC validation: ICE gathering state: ${iceGatheringState}`)

          if (iceGatheringState === 'complete') {
            iceGatheringCompleted = true
          } else if (iceGatheringState === 'gathering') {
            iceGatheringCompleted = false
          }

          updateWebRTCState('icegatheringstatechange')
        }

        const iceCandidateErrorHandler = (event: any) => {
          console.error(`❌ WebRTC validation: ICE candidate error:`, event)
          hasError = true
          updateWebRTCState('icecandidateerror')
        }

        const connectionStateHandler = (connectionState: string) => {
          console.info(`🔄 WebRTC validation: connection state: ${connectionState}`)

          if (connectionState === 'connected') {
            connectionEstablished = true
          } else if (connectionState === 'failed' || connectionState === 'disconnected') {
            hasError = true
          } else {
            connectionEstablished = false
          }

          updateWebRTCState('connectionstatechange')
        }

        // Check current state first
        const initialState = checkCurrentState()
        if (initialState) {
          console.info(`🔍 WebRTC validation: returning initial state: ${initialState}`)
          resume(Effect.succeed(initialState))
          return Effect.void
        }

        // Set up event listeners for comprehensive monitoring
        console.info(`⏳ WebRTC validation: setting up comprehensive event monitoring...`)
        transport.on('icegatheringstatechange', iceGatheringHandler)
        transport.on('icecandidateerror', iceCandidateErrorHandler)
        transport.on('connectionstatechange', connectionStateHandler)

        // Set up timeout and store ID in store
        timeoutHandle = setTimeout(() => {
          if (resolved) return
          resolved = true
          cleanup()

          const finalState = {
            connection_state: transport.connectionState,
            ice_gathering_state: (transport as any).iceGatheringState,
            ice_completed: iceGatheringCompleted,
            connection_established: connectionEstablished,
            has_error: hasError
          }

          console.error(`⏰ WebRTC validation timeout after ${timeoutMs}ms`, finalState)
          resume(Effect.fail(new TransportConnectionError(
            `WebRTC connection timeout after ${timeoutMs}ms. Final state: ${JSON.stringify(finalState)}`
          )))
        }, timeoutMs)

        // Store timeout ID in store for cleanup tracking
        const timeoutId = timeoutHandle as any as number // Node.js returns number
        console.info(`🔄 Storing timeout ID: ${timeoutId} for transport: ${transport.id}`)
        if (handlerContext.type === 'listener') {
          roomStore.actions.updateListenerTransportState(handlerContext.listenerId, {
            activeConnectionTimeoutId: Option.some(timeoutId)
          })
        } else {
          const currentTransport = Option.getOrNull(roomStore.state.participants.dj.sendTransport)
          if (currentTransport) {
            roomStore.actions.updateDJState({
              sendTransport: Option.some({
                ...currentTransport,
                activeConnectionTimeoutId: Option.some(timeoutId)
              })
            })
          }
        }

        return Effect.sync(cleanup)
      }),
      Effect.tap(() => Effect.logInfo(`WebRTC connection validation completed for transport: ${transport.id}`))
    )

  /**
   * Setup transport event handlers (private method)
   */
  private setupTransportEventHandlers = async (
    transport: types.Transport,
    direction: 'send' | 'receive',
    callbacks?: TransportCallbacks
  ) => {
    // Set up WebRTC state monitoring if callback is provided
    if (callbacks?.onWebRTCStateChange) {
      // Use the unified WebRTC monitoring - run in background, don't wait for it
      Effect.runFork(
        pipe(
          this.waitForWebRTCConnection(transport, Infinity, { type: 'dj' }), // No timeout for persistent monitoring
          Effect.andThen(state => Effect.sync(() => {
            callbacks.onWebRTCStateChange?.(state, {
              iceState: (transport as any).iceGatheringState,
              connectionState: transport.connectionState
            })
          })),
          Effect.catchAll(error => Effect.sync(() => {
            console.warn(`WebRTC monitoring ended for transport ${transport.id}:`, error)
          }))
        )
      )
    }

    // Legacy connection state change callback for backward compatibility
    transport.on('connectionstatechange', (state) => {
      console.info(`🔄 ${direction} transport connection state changed: ${state}`, {
        transport_id: transport.id,
        connection_state: state,
        ice_state: (transport as any).iceState,
        dtls_state: (transport as any).dtlsState
      })

      callbacks?.onConnectionStateChange?.(state)
    })

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

/**
 * Map MediaSoup transport connection state to WebRTC status for room store
 */
export const mapTransportStateToWebRTCStatus = (
  transportState: string
): 'disconnected' | 'connecting' | 'connected' | 'failed' => {
  switch (transportState) {
    case 'new':
    case 'connecting':
      return 'connecting'
    case 'connected':
      return 'connected'
    case 'failed':
      return 'failed'
    case 'disconnected':
    case 'disconnecting':
    default:
      return 'disconnected'
  }
}

/**
 * Get WebRTC status from transport for room store
 */
export const getTransportWebRTCStatus = (
  transport: types.Transport
): 'disconnected' | 'connecting' | 'connected' | 'failed' => {
  return mapTransportStateToWebRTCStatus(transport.connectionState)
}
