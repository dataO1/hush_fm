import { Effect, pipe } from 'effect'
import type { Device, types } from 'mediasoup-client'
import { withWebRTCSpan, withTransportTimeoutTracking } from '../telemetry'

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
 * Transport manager for WebRTC connections
 */
export class TransportManager {
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

          // Set up event handlers
          this.setupTransportEvents(transport, 'send')
          
          // Transport state is now managed by WebRTCProvider
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

          // Set up event handlers
          this.setupTransportEvents(transport, 'receive')
          
          // Transport state is now managed by WebRTCProvider
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
   * Connect transport with DTLS parameters
   */
  connectTransport = (
    transport: types.Transport,
    _dtlsParameters: any
  ): Effect.Effect<void, TransportConnectionError> =>
    pipe(
      Effect.tryPromise({
        try: async () => {
          // Connection state is now managed by WebRTCProvider
          
          // For local network, we only need to handle DTLS
          console.debug(`Transport initial state: ${transport.connectionState}`)
          
          if (transport.connectionState !== 'connected') {
            // Transport will automatically connect for local network
            // Just wait for the connection state to change
            await new Promise<void>((resolve, reject) => {
              const startTime = Date.now()
              const timeout = setTimeout(() => {
                const elapsed = Date.now() - startTime
                console.error(`Transport connection timeout after ${elapsed}ms, final state: ${transport.connectionState}`)
                reject(new Error(`Transport connection timeout after ${elapsed}ms`))
              }, 10000) // 10 second timeout

              transport.on('connectionstatechange', (state) => {
                const elapsed = Date.now() - startTime
                console.debug(`Transport state changed to '${state}' after ${elapsed}ms`)
                
                if (state === 'connected') {
                  console.info(`Transport connected successfully after ${elapsed}ms`)
                  clearTimeout(timeout)
                  resolve()
                } else if (state === 'failed' || state === 'closed') {
                  console.error(`Transport connection failed with state '${state}' after ${elapsed}ms`)
                  clearTimeout(timeout)
                  reject(new Error(`Transport connection failed: ${state} after ${elapsed}ms`))
                }
              })
              
              console.debug(`Waiting for transport connection, starting state: ${transport.connectionState}`)
            })
          } else {
            console.info(`Transport already connected: ${transport.connectionState}`)
          }
        },
        catch: (error) => new TransportConnectionError(
          `Failed to connect transport: ${error instanceof Error ? error.message : String(error)}`,
          error
        )
      }),
      withTransportTimeoutTracking(10000, transport.id),
      Effect.tap(() => Effect.logInfo(`Transport connected: ${transport.id}`))
    )

  /**
   * Set up transport event handlers for reactive updates
   */
  private setupTransportEvents(transport: types.Transport, direction: 'send' | 'receive'): void {
    // Connection state changes
    transport.on('connectionstatechange', (state: string) => {
      Effect.runSync(
        Effect.sync(() => {
          // Connection state is now managed by WebRTCProvider
          // Log for debugging purposes
          console.debug('Transport connection state changed:', state)
        })
      )
    })

    // Handle the 'connect' event for send transports
    if (direction === 'send') {
      transport.on('connect', async (_: any, callback: () => void, errback: (error: Error) => void) => {
        try {
          // For local network, we need to send DTLS parameters to backend
          // This will be handled by the WebSocket signaling
          callback()
        } catch (error) {
          errback(error instanceof Error ? error : new Error(String(error)))
        }
      })

      // Handle the 'produce' event
      transport.on('produce', async (parameters: any, callback: (params: { id: string }) => void, errback: (error: Error) => void) => {
        try {
          // Send produce request to backend via WebSocket
          // This will be handled by the WebSocket signaling
          callback({ id: parameters.id || 'temp-producer-id' })
        } catch (error) {
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