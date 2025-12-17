/**
 * Listener Flows Service
 *
 * Implements the complete 10-step listener room connection flow as specified
 * in DJ_ROOM_CREATION_FLOW_HOW_ITS_SUPPOSED_TO_BE.md (steps 1-10a + 6b-7b error handling).
 *
 * Uses room store for state management and domain schemas for type safety.
 */

import { Effect, pipe, Option } from 'effect'
import type { RoomStore } from '../../stores/room.store'
import {
  type ListenerState,
  createInitialListenerState
} from '../../domain/schemas/listener.schema'
import {
  type RoomMetadata,
} from '../../domain/schemas/room.schema'
import type {
  ListenerEvent,
  ListenerCommand
} from '../websocket/schemas/websocket'
import type { RoomInfo } from '../generated/hushFMAPI.schemas'
import {
  ListenerFlowError,
  AudioPlaybackError
} from '../../domain/errors'
import { createAndLoadDevice } from '../mediasoup/device.service'
import { createReceiveTransportWithEvents } from '../mediasoup/transport.service'
import { createAudioConsumer } from '../mediasoup/consumer.service'
import {
  connectToListener,
  requestRouterCapabilities,
  subscribeToRouterCapabilities,
  sendListenerCommand
} from '../websocket/websocket.service'
import { ConnectionState } from '../../domain/schemas/room.schema'
import {
  cleanupConsumerWithStore,
  cleanupTransportWithStore,
  cleanupWebSocketWithStore
} from './cleanup-flows.service'

/**
 * WebSocket connection error for listener
 */
export class ListenerWebSocketError {
  readonly _tag = 'ListenerWebSocketError'
  constructor(
    public readonly cause: string,
    public readonly recoverable: boolean = true,
    public readonly context?: Record<string, unknown>
  ) {}
}

/**
 * Request to join room as listener
 */
export interface JoinRoomRequest {
  /** ID of the room to join */
  roomId: string
  /** Session ID from browser fingerprint */
  sessionId: string
  /** Unique listener WebSocket URL from RequestJoin response */
  listenerWebSocketUrl: string
  /** Room information from RequestJoin response */
  roomInfo?: RoomInfo
  /** Optional listener name */
  listenerName?: string
}

/**
 * Listener join result
 */
export interface ListenerJoinResult {
  listenerId: string
  roomMetadata: RoomMetadata
  audioStream: MediaStream
}


/**
 * Get or create listener WebSocket connection for session
 */
export const getOrCreateListenerWebSocket = (
  roomStore: RoomStore,
  sessionId: string,
  listenerWebSocketUrl: string,
  roomId: string
): Effect.Effect<WebSocket, ListenerWebSocketError> =>
  pipe(
    Effect.gen(function* (_) {
      // Check if listener already exists in store with active WebSocket
      const existingListener = roomStore.listeners.find((l: any) => l.id === sessionId)

      if (existingListener) {
        const existingWebSocket = Option.getOrNull(existingListener.websocket?.websocket)

        if (existingWebSocket && existingWebSocket.readyState === WebSocket.OPEN) {
          console.info('🔄 Reusing existing listener WebSocket connection for session:', sessionId)
          return existingWebSocket
        } else {
          console.info('🔄 Existing listener found but WebSocket is closed, creating new connection')
          // Clean up old listener state
          roomStore.actions.removeListener(sessionId)
        }
      }

      console.info('🔗 Creating new listener WebSocket connection:', { sessionId, listenerWebSocketUrl })

      // Initialize listener state in room store with session ID
      const initialListenerState = createInitialListenerState()
      const listenerState: ListenerState = {
        ...initialListenerState,
        currentStep: 'connecting',
        flowStartedAt: Option.some(new Date())
      }

      // Add listener using session ID as the key
      roomStore.actions.addListener(sessionId, listenerState)

      // Create WebSocket connection using websocket service with correct URL format
      const listenerWebSocket = yield* _(pipe(
        connectToListener(roomId, sessionId),
        Effect.mapError(error => new ListenerWebSocketError(
          'Failed to connect to listener WebSocket via service',
          true,
          { sessionId, roomId, originalError: error.message }
        ))
      ))

      console.info('✅ Listener WebSocket connected successfully via service')

      // Set up stream event listeners for pause/resume
      console.log(`🔧 [Listener ${sessionId}] Setting up stream event handlers for pause/resume`)
      setupListenerStreamEventHandlers(listenerWebSocket, roomStore, sessionId)

      // Update listener state with connected WebSocket
      roomStore.actions.updateListener(sessionId, {
        websocket: {
          ...initialListenerState.websocket,
          websocket: Option.some(listenerWebSocket),
          connectionState: 'connected',
          roomId: Option.some(roomId),
          url: Option.some(`wss://${window.location.hostname}:3443/ws/listener/${sessionId}`),
          connectedAt: Option.some(new Date())
        }
      })

      return listenerWebSocket
    })
  )

/**
 * Join room as listener - implements complete 10-step flow with unique WebSocket
 *
 * Updated flow steps:
 * 1. Connect to unique listener WebSocket URL (from lobby response)
 * 2. Send initListener command → Backend creates webrtc receiver transport → sends params
 * 3. Frontend creates receive transport from params
 * 4. Frontend sends device RTP capabilities to backend
 * 5. Backend checks canConsume() → creates consumer if compatible
 * 6a. Backend sends consumer params (id, kind, rtp) → continue to 7a
 * 6b. Backend returns error if router incompatible → go to 7b
 * 7a. Frontend creates client consumer → fires connect event
 * 7b. Frontend shows error, cancels joining, returns to lobby
 * 8a. Frontend connect handler sends DTLS params to backend
 * 9a. Backend connects receiver transport with DTLS params
 * 10a. Media streaming starts
 */
export const joinRoomAsListener = (
  roomStore: RoomStore,
  request: JoinRoomRequest
): Effect.Effect<ListenerJoinResult, ListenerFlowError | ListenerWebSocketError> =>
  pipe(
    Effect.gen(function* (_) {
      console.info('🎧 Starting listener join flow for room:', request.roomId)
      console.info('🔗 Unique listener WebSocket URL:', request.listenerWebSocketUrl)

      // Use session ID as listener ID (stable identity)
      const listenerId = request.sessionId

      try {
        // Step 1: Get or create listener WebSocket connection
        console.info('✅ Step 1: Getting or creating listener WebSocket connection')

        const listenerWebSocket = yield* _(getOrCreateListenerWebSocket(
          roomStore,
          request.sessionId,
          request.listenerWebSocketUrl,
          request.roomId
        ))

        // Step 2: Request router RTP capabilities for device initialization
        console.info('✅ Step 2: Requesting router RTP capabilities from backend')
        roomStore.actions.setListenerFlowStep(listenerId, 'requesting_capabilities')

        // Request router capabilities
        yield* _(requestRouterCapabilities(listenerWebSocket, request.roomId).pipe(
          Effect.mapError(error => new ListenerFlowError({
            cause: `Failed to request router capabilities: ${String(error)}`,
            step: 'requesting_capabilities',
            stepNumber: 2,
            recoverable: true,
            context: { timestamp: new Date(), operation: 'request_router_capabilities' }
          }))
        ))

        // Wait for router capabilities response
        console.info('✅ Step 3: Waiting for router RTP capabilities from backend')
        console.log('🔧 Step 3: Starting router capabilities subscription...')

        const routerRtpCapabilities = yield* _(subscribeToRouterCapabilities(listenerWebSocket).pipe(
          Effect.mapError(error => {
            console.error('❌ Step 3: Router capabilities subscription failed:', error)
            console.error('❌ Step 3: Error details:', {
              errorType: typeof error,
              errorMessage: String(error),
              errorCause: (error as any)?.cause,
              errorContext: (error as any)?.context
            })

            return new ListenerFlowError({
              cause: `Failed to receive router capabilities: ${String(error)} | Cause: ${(error as any)?.cause || 'Unknown'}`,
              step: 'requesting_capabilities',
              stepNumber: 3,
              recoverable: true,
              context: {
                timestamp: new Date(),
                operation: 'request_router_capabilities'
              }
            })
          })
        ))

        console.log('✅ Step 3: Router capabilities received successfully:', routerRtpCapabilities)
        // Create and load device with router RTP capabilities (now available!)
        const device = yield* _(createAndLoadDevice(routerRtpCapabilities).pipe(
          Effect.mapError(error => new ListenerFlowError({
            cause: `Failed to create device: ${String(error)}`,
            step: 'creating_transport',
            stepNumber: 6,
            recoverable: false,
            context: { timestamp: new Date(), operation: 'create_device', details: { listenerId, error } }
          }))
        ))

        // Step 4: Send initListener command to initialize transport receiver
        console.info('✅ Step 4: Sending initListener command to initialize transport receiver')
        roomStore.actions.setListenerFlowStep(listenerId, 'waiting_transport')

        const initCommand: ListenerCommand = {
          type: 'initListener'
        }

        listenerWebSocket.send(JSON.stringify(initCommand))

        // Wait for transport params from backend
        console.info('✅ Step 5: Waiting for transport params from backend')
        roomStore.actions.setListenerFlowStep(listenerId, 'waiting_transport')

        const transportParams = yield* _(waitForTransportParams(listenerWebSocket))

        // Step 6: Frontend creates receive transport from params
        console.info('✅ Step 6: Creating receive transport from params')
        roomStore.actions.setListenerFlowStep(listenerId, 'creating_transport')


        // Create receive transport
        const receiveTransport = yield* _(createReceiveTransportWithEvents(device, transportParams, {
          onConnect: async (dtlsParameters) => {
            console.info('✅ Step 8a: Transport connect event - sending DTLS params')
            const dtlsCommand: ListenerCommand = {
              type: 'connectListenerTransport',
              transportId: transportParams.id,
              dtlsParameters
            }
            listenerWebSocket.send(JSON.stringify(dtlsCommand))
          }
        }).pipe(
          Effect.mapError(error => new ListenerFlowError({
            cause: `Failed to create receive transport: ${String(error)}`,
            step: 'creating_transport',
            stepNumber: 3,
            recoverable: false,
            context: { timestamp: new Date(), operation: 'create_transport', details: { listenerId, error } }
          }))
        ))

        // Update listener state with device and transport
        roomStore.actions.updateListener(listenerId, {
          device: {
            device: Option.some(device),
            loaded: true,
            rtpCapabilities: Option.some(device.rtpCapabilities),
            routerRtpCapabilities: Option.some(transportParams.rtpCapabilities),
            loadError: Option.none(),
            handlerName: Option.some(device.handlerName),
            canProduce: device.canProduce('audio'),
            canConsume: true
          },
          receiveTransport: {
            ...createInitialListenerState().receiveTransport,
            transport: Option.some(receiveTransport),
            id: Option.some(transportParams.id),
            connectionState: 'new',
            transportOptions: Option.some(transportParams),
            connected: false
          }
        })

        console.info('Device and transport created successfully')

        // Step 4: Frontend sends device RTP capabilities to backend
        console.info('✅ Step 4: Sending device RTP capabilities to backend')
        roomStore.actions.setListenerFlowStep(listenerId, 'sending_capabilities')

        const rtpCapabilitiesCommand: ListenerCommand = {
          type: 'requestConsumer',
          rtpCapabilities: device.rtpCapabilities
        }
        listenerWebSocket.send(JSON.stringify(rtpCapabilitiesCommand))

        // Step 5: Backend checks canConsume() → creates consumer if compatible
        console.info('✅ Step 5: Waiting for backend consumer compatibility check')
        roomStore.actions.setListenerFlowStep(listenerId, 'waiting_consumer')

        // Wait for either consumer params (6a) or error (6b)
        const consumerResult = yield* _(waitForConsumerResult(listenerWebSocket))

        if (consumerResult.type === 'error') {
          // Step 6b + 7b: Backend returns error → show error, cancel joining, return to lobby
          console.error('❌ Step 6b/7b: Router incompatible, canceling join')
          roomStore.actions.setListenerError(listenerId, consumerResult.error, 'error')

          // Cleanup and return to lobby - store action is now synchronous
          roomStore.actions.disconnectFromRoom()

          yield* _(Effect.fail(new ListenerFlowError({
            cause: `Room join failed: ${consumerResult.error}`,
            step: 'error',
            stepNumber: 6,
            recoverable: false,
            context: { timestamp: new Date(), operation: 'consumer_check', details: { listenerId, roomIncompatible: true } }
          })))
        }

        // Step 6a: Backend sends consumer params (id, kind, rtp) → continue to 7a
        if (consumerResult.type !== 'success') {
          throw new Error('Unexpected consumer result type')
        }
        const consumerParams = consumerResult.params
        console.info('✅ Step 6a: Received consumer params from backend')

        // Step 7a: Frontend creates client consumer → fires connect event
        console.info('✅ Step 7a: Creating client-side consumer')
        roomStore.actions.setListenerFlowStep(listenerId, 'creating_consumer')

        // Create consumer using the audio consumer service
        const { consumer } = yield* _(createAudioConsumer(
          receiveTransport,
          consumerParams,
          {
            onTrackEnded: (_consumer) => {
              console.error('❌ Consumer track ended')
              roomStore.actions.setListenerError(listenerId, 'Audio track ended', 'error')
            }
          },
          { autoplay: true, volume: 0.8 }
        ).pipe(
          Effect.mapError(error => new ListenerFlowError({
            cause: `Failed to create consumer: ${String(error)}`,
            step: 'creating_consumer',
            stepNumber: 7,
            recoverable: false,
            context: { timestamp: new Date(), operation: 'create_consumer', details: { listenerId, error } }
          }))
        ))

        // Step 10a: Media streaming starts
        console.info('✅ Step 10a: Media streaming should start now')
        roomStore.actions.setListenerFlowStep(listenerId, 'streaming')
        
        // Set room connection state to streaming (listener is now receiving audio)
        roomStore.actions.setConnectionState(ConnectionState.STREAMING)

        const audioStream = new MediaStream([consumer.track])

        // Update listener state with consumer and audio stream
        roomStore.actions.updateListener(listenerId, {
          consumer: {
            ...createInitialListenerState().consumer,
            consumer: Option.some(consumer),
            id: Option.some(consumerParams.id),
            producerId: Option.some(consumerParams.producerId),
            kind: 'audio',
            paused: false,
            rtpParameters: Option.some(consumerParams.rtpParameters),
            track: Option.some(consumer.track),
            createdAt: Option.some(new Date())
          },
          audioPlayback: {
            ...createInitialListenerState().audioPlayback,
            mediaStream: Option.some(audioStream),
            volume: 0.8,
            muted: false,
            playing: true
          },
          flowCompletedAt: Option.some(new Date())
        })

        console.info('✅ Consumer and audio stream created successfully')

        // Set room metadata from request room info
        const roomMetadata: RoomMetadata = {
          id: request.roomId,
          name: request.roomInfo?.name || 'Unknown Room',
          djName: request.roomInfo?.djName || 'Unknown DJ',
          description: Option.fromNullable(request.roomInfo?.description),
          isPublic: true,
          createdAt: new Date(request.roomInfo?.createdAt || new Date()),
          tags: request.roomInfo?.tags || []
        }

        roomStore.actions.setRoomMetadata(roomMetadata)

        console.info('🎉 Listener join flow completed successfully!')

        return {
          listenerId,
          roomMetadata,
          audioStream
        }

      } catch (error) {
        console.error('❌ Listener join flow failed:', error)
        roomStore.actions.setListenerError(
          listenerId,
          String(error),
          'error'
        )
        throw error
      }
    })
  )

/**
 * Leave room as listener - cleanup flow
 * Sends leaveRoom command to backend, then cleans up local resources
 */
export const leaveRoomAsListener = (
  roomStore: RoomStore,
  listenerId: string
): Effect.Effect<void, ListenerFlowError> =>
  pipe(
    Effect.gen(function* (_) {
      console.info('👋 Leaving room as listener:', listenerId)

      // Get current listener state using session ID
      const listener = roomStore.getListener(listenerId)

      if (!listener) {
        console.warn('No listener found with ID:', listenerId)
        return
      }

      // Step 1: Send leaveRoom command to backend if WebSocket is open
      const listenerWebSocket = Option.getOrNull(listener.websocket.websocket)
      if (listenerWebSocket && listenerWebSocket.readyState === WebSocket.OPEN) {
        console.info('📡 Sending leaveRoom command to backend')
        try {
          yield* _(sendListenerCommand(listenerWebSocket, { type: 'leaveRoom' }).pipe(
            Effect.tapBoth({
              onFailure: (error) => Effect.sync(() => {
                console.warn('Failed to send leaveRoom command, continuing with cleanup:', error.message)
              }),
              onSuccess: () => Effect.sync(() => {
                console.info('✅ LeaveRoom command sent to backend')
              })
            }),
            // Don't fail the entire leave flow if command sending fails
            Effect.catchAll(() => Effect.void)
          ))
        } catch (error) {
          console.warn('Error sending leave command:', error)
        }
      } else {
        console.info('WebSocket not available or not open, skipping backend notification')
      }

      // Step 2: Sequential cleanup using store-aware cleanup services
      console.info('🧹 Starting sequential MediaSoup cleanup with store updates')
      roomStore.actions.setListenerFlowStep(listenerId, 'cleanup')
      
      // 2a: Consumer cleanup with store updates - use leaving mode for faster cleanup
      yield* _(cleanupConsumerWithStore(roomStore, listenerId, 5000, true).pipe(
        Effect.catchAll((error) => {
          console.warn(`⚠️ [${listenerId}] Consumer cleanup failed, continuing:`, error.message)
          return Effect.void
        })
      ))
      
      // 2b: Transport cleanup with store updates - use leaving mode for faster cleanup
      yield* _(cleanupTransportWithStore(roomStore, listenerId, 5000, true).pipe(
        Effect.catchAll((error) => {
          console.warn(`⚠️ [${listenerId}] Transport cleanup failed, continuing:`, error.message)
          return Effect.void
        })
      ))
      
      // 2c: WebSocket cleanup with store updates
      yield* _(cleanupWebSocketWithStore(roomStore, listenerId, 3000).pipe(
        Effect.catchAll((error) => {
          console.warn(`⚠️ [${listenerId}] WebSocket cleanup failed, continuing:`, error.message)
          return Effect.void
        })
      ))

      // Step 3: Update room state
      console.info('🔄 Updating room state to DISCONNECTED')
      roomStore.actions.setConnectionState(ConnectionState.DISCONNECTED)
      
      // Step 4: Remove listener from store
      roomStore.actions.removeListener(listenerId)
      console.info('✅ Listener removed from store and local cleanup complete')

      console.info('🏁 Leave room as listener flow completed successfully')
    }),
    // Add timeout protection for the entire cleanup process
    Effect.timeout(15_000), // 15 second timeout for complete cleanup
    Effect.catchAll((error) => {
      console.error(`❌ [${listenerId}] Leave room flow failed or timed out:`, error)
      // Force cleanup on timeout/error - ensure store is always cleaned up
      roomStore.actions.setConnectionState(ConnectionState.DISCONNECTED)
      roomStore.actions.removeListener(listenerId)
      console.warn(`🔧 [${listenerId}] Forced cleanup completed after error/timeout`)
      return Effect.void
    })
  )

/**
 * Control audio playback for listener
 */
export const controlListenerAudio = (
  roomStore: RoomStore,
  listenerId: string,
  action: 'play' | 'pause' | 'setVolume',
  value?: number
): Effect.Effect<void, AudioPlaybackError> =>
  pipe(
    Effect.gen(function* (_) {
      const listeners = roomStore.listeners
      const listener = listeners.find(l => (l as any).id === listenerId)

      if (!listener) {
        yield* _(Effect.fail(new AudioPlaybackError({
          cause: `Listener ${listenerId} not found`,
          operation: 'play',
          autoplayBlocked: false,
          context: { timestamp: new Date(), operation: 'control_error', details: { listenerId, action } }
        })))
      }

      // Check if audio stream is available
      if (listener) {
        const hasAudioStream = Option.isSome(listener.audioPlayback.mediaStream)
        if (!hasAudioStream) {
          yield* _(Effect.fail(new AudioPlaybackError({
            cause: 'Audio stream not available',
            operation: action === 'setVolume' ? 'volume' : action,
            autoplayBlocked: false,
            context: { timestamp: new Date(), operation: 'stream_error', details: { listenerId, action } }
          })))
        }
      }

      switch (action) {
        case 'play':
          roomStore.actions.setListenerMuted(listenerId, false)
          break
        case 'pause':
          roomStore.actions.setListenerMuted(listenerId, true)
          break
        case 'setVolume':
          if (typeof value === 'number') {
            roomStore.actions.setListenerVolume(listenerId, value)
          }
          break
      }
    })
  )

// Helper functions for WebSocket event handling

/**
 * Set up stream event handlers for listener WebSocket
 * Handles streamPaused and streamResumed events from DJ
 */
function setupListenerStreamEventHandlers(
  listenerWebSocket: WebSocket,
  roomStore: RoomStore,
  sessionId: string
): void {
  const handleMessage = (event: MessageEvent) => {
    try {
      const message = JSON.parse(event.data) as ListenerEvent
      
      // Debug: Log all messages to see what we're receiving
      console.log(`🔍 [Listener ${sessionId}] Received WebSocket message:`, message.type, message)
      
      switch (message.type) {
        case 'streamPaused':
          console.info(`🎵 [Listener ${sessionId}] Stream paused by DJ, updating room state to PAUSED`)
          roomStore.actions.setConnectionState(ConnectionState.PAUSED)
          // Also update the specific listener's audio playback state
          roomStore.actions.setListenerMuted(sessionId, true)
          console.log(`🔄 [Listener ${sessionId}] Room connection state set to:`, roomStore.connectionState)
          break
          
        case 'streamResumed':
          console.info(`🎵 [Listener ${sessionId}] Stream resumed by DJ, updating room state to STREAMING`)
          roomStore.actions.setConnectionState(ConnectionState.STREAMING)
          // Also update the specific listener's audio playback state
          roomStore.actions.setListenerMuted(sessionId, false)
          console.log(`🔄 [Listener ${sessionId}] Room connection state set to:`, roomStore.connectionState)
          break
          
        case 'roomClosed':
          console.info(`🏠 [Listener ${sessionId}] Room closed by DJ, disconnecting listener`)
          roomStore.actions.setConnectionState(ConnectionState.DISCONNECTED)
          // Cleanup will be handled by the room store
          break
          
        default:
          // Don't ignore completely - log for debugging
          console.debug(`🔍 [Listener ${sessionId}] Ignoring message type: ${message.type}`)
          break
      }
    } catch (error) {
      console.warn(`❌ [Listener ${sessionId}] Failed to parse WebSocket message:`, error, event.data)
    }
  }

  // Add the message handler
  listenerWebSocket.addEventListener('message', handleMessage)
  console.log(`✅ [Listener ${sessionId}] Stream event handler added to WebSocket`)
  
  // Clean up handler when WebSocket closes
  listenerWebSocket.addEventListener('close', () => {
    listenerWebSocket.removeEventListener('message', handleMessage)
    console.info(`🧹 [Listener ${sessionId}] Cleaned up stream event listeners`)
  })
}

/**
 * Wait for transport parameters
 */
function waitForTransportParams(listenerWebSocket: WebSocket): Effect.Effect<any, ListenerFlowError> {
  return Effect.async<any, ListenerFlowError>((resolve) => {
    const handleMessage = (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data) as ListenerEvent
        if (message.type === 'listenerTransportReady') {
          listenerWebSocket.removeEventListener('message', handleMessage)
          resolve(Effect.succeed(message.transportOptions))
        }
      } catch (error) {
        // Continue listening for other messages
      }
    }

    listenerWebSocket.addEventListener('message', handleMessage)

    // Timeout after 10 seconds
    setTimeout(() => {
      listenerWebSocket.removeEventListener('message', handleMessage)
      resolve(Effect.fail(new ListenerFlowError({
        cause: 'Timeout waiting for transport parameters',
        step: 'waiting_transport_params',
        stepNumber: 2,
        recoverable: true,
        context: { timestamp: new Date(), operation: 'wait_transport', details: {} }
      })))
    }, 10000)
  })
}

/**
 * Wait for consumer result (success with params or error)
 */
function waitForConsumerResult(
  listenerWebSocket: WebSocket
): Effect.Effect<{ type: 'success'; params: any } | { type: 'error'; error: string }, ListenerFlowError> {
  return Effect.async<{ type: 'success'; params: any } | { type: 'error'; error: string }, ListenerFlowError>((resolve) => {
    const handleMessage = (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data) as ListenerEvent
        if (message.type === 'consumerCreated') {
          listenerWebSocket.removeEventListener('message', handleMessage)
          resolve(Effect.succeed({ type: 'success', params: message.consumerParameters }))
        } else if (message.type === 'commandFailed') {
          listenerWebSocket.removeEventListener('message', handleMessage)
          resolve(Effect.succeed({ type: 'error', error: message.error }))
        }
      } catch (error) {
        // Continue listening for other messages
      }
    }

    listenerWebSocket.addEventListener('message', handleMessage)

    // Timeout after 10 seconds
    setTimeout(() => {
      listenerWebSocket.removeEventListener('message', handleMessage)
      resolve(Effect.fail(new ListenerFlowError({
        cause: 'Timeout waiting for consumer result',
        step: 'waiting_consumer_check',
        stepNumber: 5,
        recoverable: true,
        context: { timestamp: new Date(), operation: 'wait_consumer', details: {} }
      })))
    }, 10000)
  })
}

