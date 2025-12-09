import { Effect, Option, pipe } from 'effect'
import type { Device, types } from 'mediasoup-client'
import { withWebRTCSpan } from '../telemetry'
import type { ClientCommand } from '../models/websocket'

/**
 * Transport-specific errors
 */
export class TransportError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message)
    this.name = 'TransportError'
  }
}

export class TransportConnectionError extends TransportError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'TransportConnectionError'
  }
}

/**
 * Transport options from backend (optimized for local network)
 */
export type TransportOptions = {
  id: string
  dtlsParameters: any
  iceParameters: any
  iceCandidates: any[]
  sctpParameters?: any
  _localNetworkOptimized?: boolean
}

/**
 * Check if transport is optimized for local network
 */
export const isLocalNetworkOptimized = (options: TransportOptions): boolean => 
  options._localNetworkOptimized === true || options.iceCandidates.length === 0

/**
 * Signaling callback for sending commands to backend
 */
export type SignalingCallback = (roomId: string, command: any) => Promise<void>

/**
 * Transport manager for WebRTC connections
 */
export class TransportManager {
  private signalingCallback: SignalingCallback | null = null
  private currentRoomId: string | null = null
  /**
   * Set signaling callback for WebSocket communication
   */
  setSignaling = (roomId: string, callback: SignalingCallback): void => {
    this.currentRoomId = roomId
    this.signalingCallback = callback
  }

  /**
   * Clear signaling callback
   */
  clearSignaling = (): void => {
    this.currentRoomId = null
    this.signalingCallback = null
  }

  /**
   * Create send transport for DJ (audio streaming)
   */
  createSendTransport = (
    device: Device,
    transportOptions: TransportOptions
  ): Effect.Effect<types.Transport, TransportError> =>
    pipe(
      Effect.tryPromise({
        try: async () => {
          // Create transport with local network optimization
          // Empty iceCandidates forces local-only peer discovery
          const transport = device.createSendTransport({
            id: transportOptions.id,
            iceParameters: transportOptions.iceParameters,
            iceCandidates: transportOptions.iceCandidates, // Empty for local network optimization
            dtlsParameters: transportOptions.dtlsParameters,
            sctpParameters: transportOptions.sctpParameters,
          })

          // Set up event handlers and monitoring
          this.setupTransportEvents(transport, 'send')
          this.monitorTransportConnection(transport)
          
          return transport
        },
        catch: (error) => new TransportError(
          `Failed to create send transport: ${error instanceof Error ? error.message : String(error)}`,
          error
        )
      }),
      withWebRTCSpan('create-send-transport', transportOptions.id),
      Effect.tap(() => Effect.logInfo(`Created send transport: ${transportOptions.id}`))
    )

  /**
   * Create receive transport for listener (audio reception)
   */
  createReceiveTransport = (
    device: Device,
    transportOptions: TransportOptions
  ): Effect.Effect<types.Transport, TransportError> =>
    pipe(
      Effect.tryPromise({
        try: async () => {
          // Create transport with local network optimization
          // Empty iceCandidates forces local-only peer discovery
          const transport = device.createRecvTransport({
            id: transportOptions.id,
            iceParameters: transportOptions.iceParameters,
            iceCandidates: transportOptions.iceCandidates, // Empty for local network optimization
            dtlsParameters: transportOptions.dtlsParameters,
            sctpParameters: transportOptions.sctpParameters,
          })

          // Set up event handlers and monitoring
          this.setupTransportEvents(transport, 'receive')
          this.monitorTransportConnection(transport)
          
          return transport
        },
        catch: (error) => new TransportError(
          `Failed to create receive transport: ${error instanceof Error ? error.message : String(error)}`,
          error
        )
      }),
      withWebRTCSpan('create-recv-transport', transportOptions.id),
      Effect.tap(() => Effect.logInfo(`Created receive transport: ${transportOptions.id}`))
    )

  /**
   * Monitor transport connection state changes (for debugging)
   * Note: Connection happens automatically when produce() is called
   */
  private monitorTransportConnection = (transport: types.Transport): void => {
    console.debug(`Monitoring transport connection, initial state: ${transport.connectionState}`)
    
    transport.on('connectionstatechange', (state) => {
      console.debug(`Transport state changed to '${state}'`)
      
      if (state === 'connected') {
        console.info(`Transport connected successfully`)
      } else if (state === 'failed' || state === 'closed') {
        console.error(`Transport connection failed with state '${state}'`)
      }
    })
  }

  /**
   * Set up transport event handlers for reactive updates
   */
  private setupTransportEvents(transport: types.Transport, direction: 'send' | 'receive'): void {
    // Connection state changes
    transport.on('connectionstatechange', (state: string) => {
      console.debug('Transport connection state changed:', state)
      // State updates are now handled by WebRTCProvider through subscription
    })

    // Handle the 'connect' event for send transports
    if (direction === 'send') {
      transport.on('connect', async (dtlsParameters: any, callback: () => void, errback: (error: Error) => void) => {
        try {
          console.debug('Transport connect event triggered with DTLS parameters:', dtlsParameters)
          
          if (!this.signalingCallback || !this.currentRoomId) {
            console.error('No signaling callback available for DTLS exchange')
            errback(new Error('Signaling not available for DTLS exchange'))
            return
          }

          // Send DTLS parameters to backend via WebSocket
          const command: ClientCommand = {
            type: 'connectTransport',
            dtlsParameters: dtlsParameters,
            _traceContext: Option.none()
          }
          await this.signalingCallback(this.currentRoomId, command)
          
          console.debug('DTLS parameters sent to backend, transport connected')
          callback()
        } catch (error) {
          console.error('Transport connect event failed:', error)
          errback(error instanceof Error ? error : new Error(String(error)))
        }
      })

      // Handle the 'produce' event
      transport.on('produce', async (parameters: any, callback: (params: { id: string }) => void, errback: (error: Error) => void) => {
        try {
          console.debug('Transport produce event triggered:', parameters)
          
          if (!this.signalingCallback || !this.currentRoomId) {
            console.error('No signaling callback available for producer creation')
            errback(new Error('Signaling not available for producer creation'))
            return
          }

          // Send RTP parameters to backend for producer creation
          const command: ClientCommand = {
            type: 'produce',
            rtpParameters: parameters,
            _traceContext: Option.none()
          }
          await this.signalingCallback(this.currentRoomId, command)
          
          // For now use the kind as producer ID, the backend should return the actual ID
          const producerId = `producer-${parameters.kind}-${Date.now()}`
          console.debug(`Producer created with ID: ${producerId}`)
          callback({ id: producerId })
        } catch (error) {
          console.error('Transport produce event failed:', error)
          errback(error instanceof Error ? error : new Error(String(error)))
        }
      })
    }

    // Note: ICE and DTLS state events not available for PlainTransport
    // These will be removed when migrating to PlainTransport
  }

  /**
   * Close transport and clean up
   */
  closeTransport = (transportId: string): Effect.Effect<void, TransportError> =>
    pipe(
      Effect.sync(() => {
        // Transport removal is now managed by WebRTCProvider
      }),
      Effect.tap(() => Effect.logInfo(`Closed transport: ${transportId}`))
    )

  /**
   * Get transport statistics
   */
  getTransportStats = (transport: types.Transport): Effect.Effect<any, TransportError> =>
    pipe(
      Effect.tryPromise({
        try: () => transport.getStats(),
        catch: (error) => new TransportError(
          `Failed to get transport stats: ${error instanceof Error ? error.message : String(error)}`,
          error
        )
      }),
      Effect.tap(() => Effect.logDebug(`Retrieved stats for transport: ${transport.id}`))
    )

  /**
   * Restart ICE (for connection recovery)
   */
  restartIce = (transport: types.Transport): Effect.Effect<void, TransportError> =>
    pipe(
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
      }),
      Effect.tap(() => Effect.logInfo(`Restarted ICE for transport: ${transport.id}`))
    )
}

/**
 * Global transport manager instance
 */
export const transportManager = new TransportManager()

/**
 * Utility to check transport compatibility
 */
export const checkTransportCompatibility = (
  device: Device,
  transportOptions: TransportOptions
): Effect.Effect<boolean, never> =>
  Effect.sync(() => {
    // For local network deployment, we assume compatibility
    // In production, you might want more sophisticated checks
    return device.loaded && !!transportOptions.dtlsParameters
  })

/**
 * Helper to format transport stats for debugging
 */
export const formatTransportStats = (stats: any): string => {
  if (!stats) return 'No stats available'
  
  return Object.entries(stats)
    .map(([_, value]: [string, any]) => ({
      id: value.id,
      type: value.type,
      bytesSent: value.bytesSent,
      bytesReceived: value.bytesReceived,
      packetsLost: value.packetsLost,
    }))
    .filter(stat => stat.type === 'transport')
    .map(stat => `Transport ${stat.id}: sent=${stat.bytesSent}, received=${stat.bytesReceived}, lost=${stat.packetsLost}`)
    .join('\n')
}