import { Effect, pipe } from 'effect'
import type { Device, types } from 'mediasoup-client'
import { transportActions, TransportState, ConnectionState } from './store'

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
 * Transport options from backend
 */
export type TransportOptions = {
  id: string
  dtlsParameters: any
  localAddress?: string
  localPort?: number
}

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
          const transport = device.createSendTransport({
            id: transportOptions.id,
            iceParameters: { 
              usernameFragment: 'local', 
              password: 'localpass' 
            }, // Minimal ICE for local network
            iceCandidates: [], // Empty for local network
            dtlsParameters: transportOptions.dtlsParameters,
          })

          // Set up event handlers
          this.setupTransportEvents(transport, 'send')
          
          // Add to store
          const transportState: TransportState = {
            id: transport.id,
            direction: 'send',
            connectionState: 'disconnected',
            iceState: null,
            dtlsState: null,
            transport,
          }
          
          transportActions.addTransport(transportState)

          return transport
        },
        catch: (error) => new TransportError(
          `Failed to create send transport: ${error instanceof Error ? error.message : String(error)}`,
          error
        )
      }),
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
          const transport = device.createRecvTransport({
            id: transportOptions.id,
            iceParameters: { 
              usernameFragment: 'local', 
              password: 'localpass' 
            }, // Minimal ICE for local network
            iceCandidates: [], // Empty for local network
            dtlsParameters: transportOptions.dtlsParameters,
          })

          // Set up event handlers
          this.setupTransportEvents(transport, 'receive')
          
          // Add to store
          const transportState: TransportState = {
            id: transport.id,
            direction: 'receive',
            connectionState: 'disconnected',
            iceState: null,
            dtlsState: null,
            transport,
          }
          
          transportActions.addTransport(transportState)

          return transport
        },
        catch: (error) => new TransportError(
          `Failed to create receive transport: ${error instanceof Error ? error.message : String(error)}`,
          error
        )
      }),
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
          // Update connection state
          transportActions.updateTransportState(transport.id, 'connecting')
          
          // For local network, we only need to handle DTLS
          if (transport.connectionState !== 'connected') {
            // Transport will automatically connect for local network
            // Just wait for the connection state to change
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(new Error('Transport connection timeout'))
              }, 10000) // 10 second timeout

              transport.on('connectionstatechange', (state) => {
                if (state === 'connected') {
                  clearTimeout(timeout)
                  resolve()
                } else if (state === 'failed' || state === 'closed') {
                  clearTimeout(timeout)
                  reject(new Error(`Transport connection failed: ${state}`))
                }
              })
            })
          }
        },
        catch: (error) => {
          transportActions.updateTransportState(transport.id, 'failed')
          return new TransportConnectionError(
            `Failed to connect transport: ${error instanceof Error ? error.message : String(error)}`,
            error
          )
        }
      }),
      Effect.tap(() => {
        transportActions.updateTransportState(transport.id, 'connected')
        return Effect.logInfo(`Transport connected: ${transport.id}`)
      })
    )

  /**
   * Set up transport event handlers for reactive updates
   */
  private setupTransportEvents(transport: types.Transport, direction: 'send' | 'receive'): void {
    // Connection state changes
    transport.on('connectionstatechange', (state: string) => {
      Effect.runSync(
        Effect.sync(() => {
          let connectionState: ConnectionState

          switch (state) {
            case 'new':
            case 'connecting':
              connectionState = 'connecting'
              break
            case 'connected':
              connectionState = 'connected'
              break
            case 'disconnected':
              connectionState = 'disconnected'
              break
            case 'failed':
            case 'closed':
              connectionState = 'failed'
              break
            default:
              connectionState = 'disconnected'
          }

          transportActions.updateTransportState(transport.id, connectionState)
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
        transportActions.removeTransport(transportId)
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