/**
 * WebRTC Infrastructure Service
 * 
 * Global singleton service for managing WebRTC transport connections.
 * Handles MediaSoup transport events and updates connection state.
 * 
 * Responsibilities:
 * - Managing WebRTC transport lifecycle
 * - Handling connection timeouts
 * - Updating connection state via ConnectionAdapter
 * - Event handler registration for transports
 */

import { Effect, Context, Layer, Option, pipe } from 'effect'
import { types } from 'mediasoup-client'
import { WebrtcConnectionState, TransportError } from '../../domain/schemas/connection.schema'
import { ConnectionAdapter } from '../../stores/connection/connection.adapter'

/**
 * WebRTC Service Interface
 */
interface WebRTCServiceImpl {
  /**
   * Connect and monitor a WebRTC transport
   */
  readonly connect: (transport: types.Transport) => Effect.Effect<void, TransportError, never>

  /**
   * Disconnect and cleanup WebRTC resources
   */
  readonly disconnect: () => Effect.Effect<void, never, never>

  /**
   * Get current WebRTC connection state
   */
  readonly state: () => Effect.Effect<WebrtcConnectionState, never, never>
}

/**
 * WebRTC Service Context Tag
 */
export class WebRTCService extends Context.Tag("@app/services/WebRTCService")<
  WebRTCService,
  WebRTCServiceImpl
>() {}

/**
 * WebRTC Service Implementation
 */
const createWebRTCServiceImpl = (): WebRTCServiceImpl => {
  let currentTransport: Option.Option<types.Transport> = Option.none()
  let connectionTimeoutId: Option.Option<NodeJS.Timeout> = Option.none()

  const clearConnectionTimeout = Effect.sync(() => {
    pipe(
      connectionTimeoutId,
      Option.match({
        onNone: () => {},
        onSome: (timeoutId) => {
          clearTimeout(timeoutId)
          connectionTimeoutId = Option.none()
        }
      })
    )
  })

  const setupConnectionTimeout = (connectionAdapter: Context.Tag.Service<ConnectionAdapter>) =>
    Effect.gen(function* () {
      yield* clearConnectionTimeout
      
      const timeoutEffect = Effect.delay(
        Effect.gen(function* () {
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
        }),
        "30 seconds"
      )

      const timeoutId = setTimeout(() => Effect.runSync(timeoutEffect), 30000)
      connectionTimeoutId = Option.some(timeoutId)
    })

  const handleTransportEvents = (transport: types.Transport, connectionAdapter: Context.Tag.Service<ConnectionAdapter>) =>
    Effect.gen(function* () {
      // Handle connection state changes
      yield* Effect.sync(() => {
        transport.on('connectionstatechange', (state) => {
          Effect.runSync(Effect.gen(function* () {
            switch (state) {
              case 'connecting':
                connectionAdapter.setWebRTCState(WebrtcConnectionState.CONNECTING)
                break
              case 'connected':
                yield* clearConnectionTimeout
                connectionAdapter.setWebRTCState(WebrtcConnectionState.CONNECTED)
                connectionAdapter.clearError()
                break
              case 'failed':
              case 'closed':
                yield* clearConnectionTimeout
                connectionAdapter.setWebRTCState(WebrtcConnectionState.DISCONNECTED)
                break
              case 'disconnected':
                connectionAdapter.setWebRTCState(WebrtcConnectionState.DISCONNECTING)
                break
            }
          }) as Effect.Effect<void, never, never>)
        })
      })

      // Handle ICE gathering state changes
      yield* Effect.sync(() => {
        transport.on('icegatheringstatechange', (state) => {
          if (state === 'complete' && transport.connectionState === 'connected') {
            connectionAdapter.setWebRTCState(WebrtcConnectionState.CONNECTED)
          }
        })
      })

      // Transport closure is handled in connectionstatechange event above
    })

  const cleanupExistingTransport = Effect.gen(function* () {
    yield* pipe(
      currentTransport,
      Option.match({
        onNone: () => Effect.void,
        onSome: (transport) => Effect.sync(() => {
          if (!transport.closed) {
            transport.close()
          }
        })
      })
    )
  })

  const service: WebRTCServiceImpl = {
    connect: (transport: types.Transport) =>
      Effect.gen(function* () {
        const connectionAdapter = yield* ConnectionAdapter

        // Clean up any existing transport
        yield* cleanupExistingTransport

        currentTransport = Option.some(transport)
        
        // Set initial connecting state
        yield* Effect.sync(() => {
          connectionAdapter.setWebRTCState(WebrtcConnectionState.CONNECTING)
          connectionAdapter.clearError()
        })

        // Setup timeout and event handlers
        yield* setupConnectionTimeout(connectionAdapter)
        yield* handleTransportEvents(transport, connectionAdapter)
      }) as Effect.Effect<void, TransportError, never>,

    disconnect: () =>
      Effect.gen(function* () {
        const connectionAdapter = yield* ConnectionAdapter

        yield* clearConnectionTimeout
        yield* cleanupExistingTransport
        
        currentTransport = Option.none()
        
        yield* Effect.sync(() => {
          connectionAdapter.setWebRTCState(WebrtcConnectionState.DISCONNECTED)
        })
      }) as Effect.Effect<void, never, never>,

    state: () =>
      Effect.gen(function* () {
        const connectionAdapter = yield* ConnectionAdapter
        
        return pipe(
          currentTransport,
          Option.match({
            onNone: () => WebrtcConnectionState.DISCONNECTED,
            onSome: (transport) => {
              if (transport.closed) {
                return WebrtcConnectionState.DISCONNECTED
              }
              
              switch (transport.connectionState) {
                case 'connected':
                  return WebrtcConnectionState.CONNECTED
                case 'connecting':
                  return WebrtcConnectionState.CONNECTING
                case 'disconnected':
                  return WebrtcConnectionState.DISCONNECTING
                default:
                  return WebrtcConnectionState.DISCONNECTED
              }
            }
          })
        )
      }) as Effect.Effect<WebrtcConnectionState, never, never>
  }

  return service
}

/**
 * WebRTC Service Layer
 */
export const WebRTCServiceLive = Layer.succeed(
  WebRTCService,
  createWebRTCServiceImpl()
)

/**
 * Global singleton WebRTC service instance
 * 
 * This creates the service immediately when the module loads,
 * making it available throughout the application.
 */
let webRTCServiceInstance: Option.Option<WebRTCServiceImpl> = Option.none()

/**
 * Get or create the singleton WebRTC service
 */
export const getWebRTCService = (): WebRTCServiceImpl => {
  return pipe(
    webRTCServiceInstance,
    Option.match({
      onNone: () => {
        const service = createWebRTCServiceImpl()
        webRTCServiceInstance = Option.some(service)
        return service
      },
      onSome: (service) => service
    })
  )
}

/**
 * Reset the global WebRTC service (useful for testing)
 */
export const resetGlobalWebRTCService = (): void => {
  webRTCServiceInstance = Option.none()
}