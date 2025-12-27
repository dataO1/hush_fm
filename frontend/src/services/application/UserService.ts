/**
 * Unified User Application Service
 *
 * Effect-TS service for both DJ and Listener workflow orchestration.
 * Combines DJ and Listener services to avoid state management issues.
 * Uses Context.Tag pattern for all dependencies - no direct imports.
 * Follows Schema-First architecture to avoid circular dependencies.
 *
 * Responsibilities:
 * - DJ room creation and publishing (18-step flow)
 * - Listener room joining (10-step flow)
 * - Audio device setup and management
 * - WebRTC transport and producer/consumer management
 * - Stream control (play/pause/volume)
 * - Error handling and recovery
 * - Cleanup and disconnection
 */

import { Effect, Context, Layer, Option as O, pipe } from 'effect'

// Import only adapters via Context.Tag
import { ConnectionAdapter, UserAdapter, AudioAdapter } from '../../stores'

// Import only infrastructure via Context.Tag
import { UserWebSocket, UserWebSocketLive } from '../infrastructure/WebSocketClient'
import { MediaSoupClient, MediaSoupClientLive } from '../infrastructure/MediaSoupClient'
import { AudioClient } from '../infrastructure/AudioClient'

// Import WebSocket command schemas for S.make construction and event types
import {
  InitRoomCommandSchema,
  RequestDjTransportCommandSchema,
  ConnectDjTransportCommandSchema,
  ProduceCommandSchema,
  PauseStreamCommandSchema,
  ResumeStreamCommandSchema,
  CloseRoomCommandSchema,
  InitListenerCommandSchema,
  GetRouterCapabilitiesCommandSchema,
  ConnectListenerTransportCommandSchema,
  RequestConsumerCommandSchema,
  ResumeConsumerCommandSchema,
  withSchemaLogging,
  // Event types
  type RoomInitializedEvent,
  type DjTransportReadyEvent,
  type TransportConnectedEvent,
  type ProducerCreatedEvent,
  type StreamPausedEvent,
  type StreamResumedEvent,
  type RoomClosedEvent,
  type ListenerTransportReadyEvent,
  type RouterCapabilitiesEvent,
  type ConsumerCreatedEvent,
  type ListenerStreamPausedEvent,
  type ListenerStreamResumedEvent
} from '../../domain/schemas/shared/websocket.schema'

// Import domain schemas and types
import {
  UserServiceError,
  type UserRoleType,
  type DJPublishResultType
} from '../../domain/schemas/user.schema'
import { WebrtcConnectionState, WsConnectionState } from '../../domain/schemas/connection.schema'

/**
 * User Service Context Tag
 *
 * Unified service for both DJ and Listener operations.
 * Uses modern 2025 Effect-TS class-based Tag syntax.
 */
export class UserService extends Context.Tag("@app/services/UserService")<
  UserService,
  {
    // DJ Operations
    readonly publishDJRoom: (roomId: string, djWebSocketUrl: string, deviceId?: string) => Effect.Effect<DJPublishResultType, UserServiceError, never>
    readonly closeDJRoom: () => Effect.Effect<void, UserServiceError, never>
    readonly pauseStream: () => Effect.Effect<void, UserServiceError, never>
    readonly resumeStream: () => Effect.Effect<void, UserServiceError, never>

    // Listener Operations
    readonly joinRoomAsListener: (roomId: string, sessionId: string) => Effect.Effect<{ readonly listenerId: string; readonly roomId: string; readonly sessionId: string; readonly joinedAt: Date }, UserServiceError, never>
    readonly leaveListenerRoom: (listenerId: string) => Effect.Effect<void, UserServiceError, never>

    // Shared Operations
    readonly connect: (url: string) => Effect.Effect<void, UserServiceError, never>
    readonly disconnect: () => Effect.Effect<void, UserServiceError, never>
    readonly getCurrentRole: () => Effect.Effect<UserRoleType | null, never, never>
  }
>() {}

/**
 * Create User Service Implementation
 *
 * Combines DJ and Listener functionality into a single service.
 * This avoids state management issues when switching between roles.
 */
const createUserServiceImpl = () => {
  // Store active WebSocket connections for proper cleanup
  let activeRole = O.none<UserRoleType>()

  // Internal helper function to cleanup DJ room on connection failure
  const cleanupFailedDJConnection = () =>
    Effect.gen(function* () {
      const connectionAdapter = yield* ConnectionAdapter
      const wsClient = yield* UserWebSocket
      const mediaSoupClient = yield* MediaSoupClient
      
      console.info('🧹 UserService: Cleaning up failed DJ connection...')

      // Send close command if we have a room connection
      if (connectionAdapter.isRoomConnected()) {
        try {
          console.info('🧹 UserService: Sending close room command to backend...')
          
          // Create command using logging wrapper
          const makeCloseRoomCommand = withSchemaLogging(CloseRoomCommandSchema, 'CloseRoomCommand')
          const closeRoomCommand = yield* makeCloseRoomCommand({}).pipe(
            Effect.mapError((error) => {
              console.warn('⚠️ UserService: Failed to create close room command:', error)
              return new UserServiceError({
                cause: `Failed to create close room command: ${error}`,
                role: 'dj',
                operation: 'cleanupFailedDJConnection',
                timestamp: new Date()
              })
            })
          )

          // Send close command (fire-and-forget, don't fail if it errors)
          yield* wsClient.sendCommand<RoomClosedEvent>(closeRoomCommand).pipe(
            Effect.catchAll((error) => {
              console.warn('⚠️ UserService: Failed to send close room command (ignoring):', error)
              return Effect.succeed(undefined) // Don't fail cleanup on close command error
            })
          )
          
          console.info('✅ UserService: Close room command sent successfully')
        } catch (error) {
          console.warn('⚠️ UserService: Error during close room command (ignoring):', error)
        }
      }

      // Always cleanup MediaSoup resources
      yield* mediaSoupClient.cleanup().pipe(
        Effect.catchAll((error) => {
          console.warn('⚠️ UserService: MediaSoup cleanup failed (ignoring):', error)
          return Effect.succeed(undefined) // Don't fail on cleanup errors
        })
      )
      
      // Reset active role
      activeRole = O.none()
      
      console.info('✅ UserService: Failed DJ connection cleanup completed')
    })

  return {
    // ============= DJ Operations =============

    publishDJRoom: (roomId: string, djWebSocketUrl: string, deviceId?: string) =>
      Effect.gen(function* () {
        const wsClient = yield* UserWebSocket
        const mediaSoupClient = yield* MediaSoupClient
        const audioClient = yield* AudioClient
        const userAdapter = yield* UserAdapter
        const connectionAdapter = yield* ConnectionAdapter

        console.info('🎤 UserService: Starting DJ room publishing flow...')

        // 1. Check for existing audio stream first
        const currentStreamOption = audioClient.currentStream()
        const stream = yield* pipe(
          currentStreamOption,
          O.match({
            onNone: () => deviceId ? audioClient.selectDevice(deviceId) : Effect.fail(new UserServiceError({
              cause: 'No audio device selected and no deviceId provided',
              operation: 'publishDJRoom',
              role: 'dj' as UserRoleType,
              timestamp: new Date()
            })),
            onSome: stream => {
              console.info('✅ UserService: Using existing audio stream')
              return Effect.succeed(stream)
            }
          })
        )

        // 2. Verify audio track exists
        const audioTrack = stream.getAudioTracks()[0]
        if (!audioTrack) {
          return yield* Effect.fail(new UserServiceError({
            cause: 'No audio track in stream',
            operation: 'publishDJRoom',
            role: 'dj' as UserRoleType,
            timestamp: new Date()
          }))
        }

        // Set active state
        activeRole = O.some('dj' as UserRoleType)
        userAdapter.setCurrentRole('dj')

        try {
          // 3. Initialize room and get RTP capabilities (WebSocket already connected from DJRoom mount)
          console.info('📡 UserService: Initializing room and waiting for capabilities...')

          // Create command using logging wrapper
          const makeInitRoomCommand = withSchemaLogging(InitRoomCommandSchema, 'InitRoomCommand')
          const initRoomCommand = yield* makeInitRoomCommand({ roomId })

          // Send command and wait for response in one call
          const rtpCapabilitiesEvent = yield* wsClient.sendCommand<RoomInitializedEvent>(initRoomCommand)

          // 4. Initialize MediaSoup device
          console.info('🎛️ UserService: Initializing MediaSoup device...')
          yield* mediaSoupClient.initDevice(rtpCapabilitiesEvent.rtpCapabilities)

          // 5. Request transport from server
          console.info('🚛 UserService: Requesting transport...')

          // Create command using logging wrapper
          const makeRequestDjTransportCommand = withSchemaLogging(RequestDjTransportCommandSchema, 'RequestDjTransportCommand')
          const requestTransportCommand = yield* makeRequestDjTransportCommand({})

          // Send command and wait for response in one call
          const transportEvent = yield* wsClient.sendCommand<DjTransportReadyEvent>(requestTransportCommand)

          // 6. Create send transport WITH event handlers
          console.info('🔧 UserService: Creating send transport with event handlers...')
          const transport = yield* mediaSoupClient.createSendTransport(transportEvent.transportOptions, {
            onConnect: async (dtlsParameters) => {
              console.info('🔗 UserService: Transport connect event - sending DTLS params')

              // Create command using logging wrapper
              const makeConnectDjTransportCommand = withSchemaLogging(ConnectDjTransportCommandSchema, 'ConnectDjTransportCommand')
              const connectTransportCommand = await makeConnectDjTransportCommand({
                transportId: O.some(transport.id),
                dtlsParameters
              }).pipe(Effect.runPromise)

              // Send command and wait for response in one call
              await wsClient.sendCommand<TransportConnectedEvent>(connectTransportCommand).pipe(Effect.runPromise)
              console.info('✅ UserService: Transport connected successfully')
            },
            onProduce: async (rtpParameters) => {
              console.info('🎤 UserService: Transport produce event - sending RTP params')

              // Create command using logging wrapper
              const makeProduceCommand = withSchemaLogging(ProduceCommandSchema, 'ProduceCommand')
              const produceCommand = await makeProduceCommand({ rtpParameters }).pipe(Effect.runPromise)

              // Send command and wait for response in one call
              const producerEvent = await wsClient.sendCommand<ProducerCreatedEvent>(produceCommand).pipe(Effect.runPromise)
              console.info('✅ UserService: Producer created successfully', { producerId: producerEvent.producerId })
              
              // Update connection state to STREAMING after successful producer creation
              connectionAdapter.setWebRTCState(WebrtcConnectionState.STREAMING)
              console.info('🎯 UserService: Updated connection state to STREAMING')
              
              return producerEvent.producerId
            }
          })

          // 8. Create producer from audio track (this will trigger the events)
          console.info('🎵 UserService: Creating producer...')
          const producer = yield* mediaSoupClient.createProducer(audioTrack, {codecOptions: {
            opusStereo: true,
            opusFec: true, // Forward Error Correction
            opusDtx: false, // Explicitly disable DTX
            opusMaxAverageBitrate: 128000 // Target 128kbps for high-quality music
          }}).pipe(
            Effect.catchAll((error) => {
              console.error('❌ UserService: createProducer failed, triggering cleanup:', error)
              
              // Use Effect.gen to compose cleanup with error propagation
              return Effect.gen(function* () {
                // Attempt cleanup but don't fail if it errors
                yield* cleanupFailedDJConnection().pipe(
                  Effect.catchAll((cleanupError) => {
                    console.warn('⚠️ UserService: Cleanup failed during createProducer error:', cleanupError)
                    return Effect.succeed(undefined)
                  })
                )
                
                // After cleanup, propagate the original error
                return yield* Effect.fail(error)
              })
            })
          )

          // Ensure audio adapter shows as playing when streaming starts
          const audioAdapter = yield* AudioAdapter
          audioAdapter.updateStreamState({ playing: true })
          console.info('🎯 UserService: Updated audio adapter state to playing')

          return {
            roomId,
            producerId: producer.id,
            djWebSocketUrl,
            publishedAt: new Date()
          }
        } catch (error) {
          console.error('❌ UserService: Error in DJ publishing flow:', error)
          
          // Perform comprehensive cleanup including sending close room command
          yield* cleanupFailedDJConnection()

          throw error
        }
      }) as Effect.Effect<DJPublishResultType, UserServiceError, UserAdapter | UserWebSocket | MediaSoupClient | AudioClient>,

    closeDJRoom: () =>
      Effect.gen(function* () {
        const connectionAdapter = yield* ConnectionAdapter
        const wsClient = yield* UserWebSocket
        const audioClient = yield* AudioClient
        const mediaSoupClient = yield* MediaSoupClient

        // Send close command if connected
        if (connectionAdapter.isRoomConnected()) {
          // Create command using logging wrapper
          const makeCloseRoomCommand = withSchemaLogging(CloseRoomCommandSchema, 'CloseRoomCommand')
          const closeRoomCommand = yield* makeCloseRoomCommand({}).pipe(
            Effect.mapError((error) => new UserServiceError({
              cause: `Failed to create close room command: ${error}`,
              role: 'dj',
              operation: 'closeDJRoom',
              timestamp: new Date()
            }))
          )

          yield* wsClient.sendCommand<RoomClosedEvent>(closeRoomCommand).pipe(
            Effect.mapError((error) => new UserServiceError({
              cause: `Failed to send close room command: ${error}`,
              role: 'dj',
              operation: 'closeDJRoom',
              timestamp: new Date()
            }))
          )
        }

        // Clean up MediaSoup resources
        yield* mediaSoupClient.cleanup().pipe(
          Effect.mapError((error) => new UserServiceError({
            cause: `Failed to cleanup MediaSoup resources: ${error}`,
            role: 'dj',
            operation: 'closeDJRoom',
            timestamp: new Date()
          }))
        )

        // Stop audio stream
        yield* audioClient.stopStream()

        // Disconnect WebSocket
        yield* wsClient.disconnect().pipe(
          Effect.mapError((error) => new UserServiceError({
            cause: `Failed to disconnect room WebSocket: ${error}`,
            role: 'dj',
            operation: 'closeDJRoom',
            timestamp: new Date()
          }))
        )

        // Reset state
        connectionAdapter.resetRoom()
        activeRole = O.none()
      }),

    pauseStream: () =>
      Effect.gen(function* () {
        const wsClient = yield* UserWebSocket
        const audioAdapter = yield* AudioAdapter
        
        console.info('⏸️ UserService: Sending pause stream command...')
        
        // Update local state optimistically (for UI responsiveness)
        audioAdapter.updateStreamState({ playing: false })
        
        // Create command using logging wrapper
        const makePauseStreamCommand = withSchemaLogging(PauseStreamCommandSchema, 'PauseStreamCommand')
        const pauseStreamCommand = yield* makePauseStreamCommand({})
        
        // Send as fire-forget command (oneshot)
        yield* wsClient.sendCommandFireForget(pauseStreamCommand).pipe(
          Effect.mapError((error) => new UserServiceError({
            cause: `Failed to pause stream: ${error}`,
            role: 'dj',
            operation: 'pauseStream',
            timestamp: new Date()
          }))
        )
        
        console.info('✅ UserService: Stream pause command sent')
      }) as Effect.Effect<void, UserServiceError, UserWebSocket | AudioAdapter>,

    resumeStream: () =>
      Effect.gen(function* () {
        const wsClient = yield* UserWebSocket
        const audioAdapter = yield* AudioAdapter
        
        console.info('▶️ UserService: Sending resume stream command...')
        
        // Update local state optimistically (for UI responsiveness)
        audioAdapter.updateStreamState({ playing: true })
        
        // Create command using logging wrapper
        const makeResumeStreamCommand = withSchemaLogging(ResumeStreamCommandSchema, 'ResumeStreamCommand')
        const resumeStreamCommand = yield* makeResumeStreamCommand({})
        
        // Send as fire-forget command (oneshot)
        yield* wsClient.sendCommandFireForget(resumeStreamCommand).pipe(
          Effect.mapError((error) => new UserServiceError({
            cause: `Failed to resume stream: ${error}`,
            role: 'dj',
            operation: 'resumeStream',
            timestamp: new Date()
          }))
        )
        
        console.info('✅ UserService: Stream resume command sent')
      }) as Effect.Effect<void, UserServiceError, UserWebSocket | AudioAdapter>,


    // ============= Listener Operations =============

    joinRoomAsListener: (roomId: string, sessionId: string) =>
      Effect.gen(function* () {
        const wsClient = yield* UserWebSocket
        const mediaSoupClient = yield* MediaSoupClient
        const audioClient = yield* AudioClient
        const userAdapter = yield* UserAdapter
        const connectionAdapter = yield* ConnectionAdapter

        // Set active state
        activeRole = O.some('listener' as UserRoleType)
        userAdapter.setCurrentRole('listener')

        // 1. Starting listener join flow (WebSocket should be connected by now)
        console.info('🔗 UserService: Starting listener join flow...')
        const connectionState = connectionAdapter.getConnectionState()
        console.info('🔍 UserService: Connection state debug:', {
          roomWsState: connectionState.roomWsState,
          webrtcState: connectionState.webrtcConnectionState
        })

        // Check if we already have an active WebRTC connection
        if (connectionAdapter.isRoomConnected()) {
          console.info('✅ UserService: Already connected to room, skipping handshake')
          connectionAdapter.setCurrentRoomId(roomId)
          return { listenerId: sessionId, roomId, sessionId, joinedAt: new Date() }
        }

        // 2. Request RTP capabilities from backend
        console.info('🎛️ UserService: Requesting router RTP capabilities...')
        // Create command using logging wrapper
        const makeGetRouterCapabilitiesCommand = withSchemaLogging(GetRouterCapabilitiesCommandSchema, 'GetRouterCapabilitiesCommand')
        const getRouterCapabilitiesCommand = yield* makeGetRouterCapabilitiesCommand({ roomId })

        const routerCapabilitiesEvent = yield* wsClient.sendCommand<RouterCapabilitiesEvent>(
          getRouterCapabilitiesCommand
        ).pipe(
          Effect.mapError((error) => new UserServiceError({
            cause: `Failed to get router capabilities: ${error}`,
            role: 'listener',
            operation: 'joinRoomAsListener',
            timestamp: new Date()
          }))
        )

        // 3. Initialize MediaSoup device with RTP capabilities
        console.info('🎛️ UserService: Initializing MediaSoup device...')
        yield* mediaSoupClient.initDevice(routerCapabilitiesEvent.rtpCapabilities).pipe(
          Effect.mapError((error) => new UserServiceError({
            cause: `Failed to initialize MediaSoup device: ${error}`,
            role: 'listener',
            operation: 'joinRoomAsListener',
            timestamp: new Date()
          }))
        )

        // 4. Request transport receiver from backend
        console.info('🚛 UserService: Requesting receive transport...')
        // Create command using logging wrapper
        const makeInitListenerCommand = withSchemaLogging(InitListenerCommandSchema, 'InitListenerCommand')
        const initListenerCommand = yield* makeInitListenerCommand({})

        const transportEvent = yield* wsClient.sendCommand<ListenerTransportReadyEvent>(
          initListenerCommand
        ).pipe(
          Effect.mapError((error) => new UserServiceError({
            cause: `Failed to get transport options: ${error}`,
            role: 'listener',
            operation: 'joinRoomAsListener',
            timestamp: new Date()
          }))
        )

        // 5. Create receive transport locally WITH event handlers
        console.info('🔧 UserService: Creating receive transport with event handlers...')
        yield* mediaSoupClient.createReceiveTransport(transportEvent.transportOptions, {
          onConnect: async (dtlsParameters) => {
            console.info('🔗 UserService: Transport connect event - sending DTLS params')

            // Create command using logging wrapper
            const makeConnectListenerTransportCommand = withSchemaLogging(ConnectListenerTransportCommandSchema, 'ConnectListenerTransportCommand')
            const connectTransportCommand = await makeConnectListenerTransportCommand({
              transportId: O.some(transportEvent.transportOptions.id),
              dtlsParameters
            }).pipe(Effect.runPromise)

            await wsClient.sendCommand<TransportConnectedEvent>(connectTransportCommand).pipe(Effect.runPromise)
            console.info('✅ UserService: Transport connected successfully')
          }
        }).pipe(
          Effect.mapError((error) => new UserServiceError({
            cause: `Failed to create receive transport: ${error}`,
            role: 'listener',
            operation: 'joinRoomAsListener',
            timestamp: new Date()
          }))
        )

        // 6. Send device RTP capabilities to request consumer
        console.info('🎧 UserService: Requesting consumer...')
        const rtpCapabilities = yield* mediaSoupClient.getDeviceCapabilities().pipe(
          Effect.mapError((error) => new UserServiceError({
            cause: `Failed to get device capabilities: ${error}`,
            role: 'listener',
            operation: 'joinRoomAsListener',
            timestamp: new Date()
          }))
        )

        // Create command using logging wrapper
        const makeRequestConsumerCommand = withSchemaLogging(RequestConsumerCommandSchema, 'RequestConsumerCommand')
        const requestConsumerCommand = yield* makeRequestConsumerCommand({ rtpCapabilities })

        const consumerEvent = yield* wsClient.sendCommand<ConsumerCreatedEvent>(
          requestConsumerCommand
        ).pipe(
          Effect.mapError((error) => new UserServiceError({
            cause: `Failed to request consumer: ${error}`,
            role: 'listener',
            operation: 'joinRoomAsListener',
            timestamp: new Date()
          }))
        )

        // Check for error response
        if (!consumerEvent.consumerParameters) {
          return yield* Effect.fail(new UserServiceError({
            cause: 'Router does not support consumer - codec mismatch',
            role: 'listener',
            operation: 'joinRoomAsListener',
            timestamp: new Date()
          }))
        }

        // 7. Create consumer (this will trigger transport connect event)
        console.info('🎵 UserService: Creating consumer...')
        const consumer = yield* mediaSoupClient.createConsumer(consumerEvent.consumerParameters).pipe(
          Effect.mapError((error) => new UserServiceError({
            cause: `Failed to create consumer: ${error}`,
            role: 'listener',
            operation: 'joinRoomAsListener',
            timestamp: new Date()
          }))
        )
        
        // Update connection state to STREAMING after successful consumer creation
        connectionAdapter.setWebRTCState(WebrtcConnectionState.STREAMING)
        console.info('🎯 UserService: Updated listener connection state to STREAMING')
        
        // Set audio adapter to playing when listener starts streaming
        const audioAdapter = yield* AudioAdapter
        audioAdapter.updateStreamState({ playing: true })
        console.info('🎯 UserService: Updated listener audio adapter state to playing')

        // 8. Connect remote stream for audio playback
        console.info('🔊 UserService: Connecting audio stream...')
        const remoteStream = new MediaStream([consumer.track])
        yield* audioClient.connectRemoteStream(remoteStream).pipe(
          Effect.mapError((error) => new UserServiceError({
            cause: `Failed to connect remote stream: ${error}`,
            role: 'listener',
            operation: 'joinRoomAsListener',
            timestamp: new Date()
          }))
        )

        // 9. Resume consumer if needed
        if (consumer.paused) {
          console.info('▶️ UserService: Resuming consumer...')
          // Create command using logging wrapper
          const makeResumeConsumerCommand = withSchemaLogging(ResumeConsumerCommandSchema, 'ResumeConsumerCommand')
          const resumeConsumerCommand = yield* makeResumeConsumerCommand({
            consumerId: consumer.id
          })

          yield* wsClient.sendCommandFireForget(resumeConsumerCommand).pipe(
            Effect.mapError((error) => new UserServiceError({
              cause: `Failed to resume consumer: ${error}`,
              role: 'listener',
              operation: 'joinRoomAsListener',
              timestamp: new Date()
            }))
          )
        }

        console.info('✅ UserService: Listener successfully joined room')
        
        // Track current room for lobby highlighting
        connectionAdapter.setCurrentRoomId(roomId)
        
        const listenerId = `${sessionId}-${roomId}`
        return {
          listenerId,
          roomId,
          sessionId,
          joinedAt: new Date()
        }
      }).pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            console.error('❌ UserService: Error in listener joining flow:', error)
            // Cleanup MediaSoup resources on error
            const mediaSoupClient = yield* MediaSoupClient
            yield* mediaSoupClient.cleanup()
            activeRole = O.none()

            // Return the error (it's already a UserServiceError from mapError calls)
            return yield* Effect.fail(error)
          })
        )
      ) as Effect.Effect<{ readonly listenerId: string; readonly roomId: string; readonly sessionId: string; readonly joinedAt: Date }, UserServiceError, UserAdapter | UserWebSocket | MediaSoupClient | AudioClient | ConnectionAdapter>,

    leaveListenerRoom: (_listenerId: string) =>
      Effect.gen(function* () {
        const connectionAdapter = yield* ConnectionAdapter
        const wsClient = yield* UserWebSocket
        const audioClient = yield* AudioClient
        const mediaSoupClient = yield* MediaSoupClient

        // Clean up audio playback
        yield* audioClient.stopStream()

        // Clean up MediaSoup resources
        yield* mediaSoupClient.cleanup()

        // Disconnect WebSocket
        yield* wsClient.disconnect()

        // Reset state
        connectionAdapter.resetRoom()
        activeRole = O.none()
      }) as Effect.Effect<void, UserServiceError, ConnectionAdapter | UserWebSocket | AudioClient | MediaSoupClient>,


    // ============= Shared Operations =============

    connect: (url: string) =>
      Effect.gen(function* () {
        const wsClient = yield* UserWebSocket
        const connectionAdapter = yield* ConnectionAdapter

        // Connect to the user WebSocket
        yield* wsClient.connect(url).pipe(
          Effect.mapError((error) => new UserServiceError({
            cause: `Failed to connect to user WebSocket: ${error}`,
            operation: 'connect',
            role: O.getOrNull(activeRole) || 'unknown' as UserRoleType,
            timestamp: new Date()
          }))
        )

        // Subscribe to stream pause/resume events for logging (don't update local state)
        // Note: These events are for information only - local mute state is controlled by the UI
        yield* wsClient.subscribe('streamPaused', (event: StreamPausedEvent | ListenerStreamPausedEvent) => {
          console.info('⏸️ UserService: Stream paused event received (server confirmation):', event.roomId)
          // Only update state if we have an active role and are actually connected
          if (O.isSome(activeRole) && connectionAdapter.isConnected()) {
            connectionAdapter.setWebRTCState(WebrtcConnectionState.PAUSED)
          } else {
            console.info('ℹ️ UserService: Ignoring streamPaused event - no active role or not connected')
          }
        }).pipe(
          Effect.mapError((error) => new UserServiceError({
            cause: `Failed to subscribe to streamPaused events: ${error}`,
            operation: 'connect',
            role: O.getOrNull(activeRole) || 'unknown' as UserRoleType,
            timestamp: new Date()
          }))
        )

        yield* wsClient.subscribe('streamResumed', (event: StreamResumedEvent | ListenerStreamResumedEvent) => {
          console.info('▶️ UserService: Stream resumed event received (server confirmation):', event.roomId)
          connectionAdapter.setWebRTCState(WebrtcConnectionState.STREAMING)
        }).pipe(
          Effect.mapError((error) => new UserServiceError({
            cause: `Failed to subscribe to streamResumed events: ${error}`,
            operation: 'connect',
            role: O.getOrNull(activeRole) || 'unknown' as UserRoleType,
            timestamp: new Date()
          }))
        )

        // Update connection state
        connectionAdapter.setRoomWSState(WsConnectionState.CONNECTED)
      }) as Effect.Effect<void, UserServiceError, UserWebSocket | ConnectionAdapter>,

    disconnect: () =>
      Effect.gen(function* () {
        const wsClient = yield* UserWebSocket
        const connectionAdapter = yield* ConnectionAdapter

        // Disconnect based on active connections
        if (connectionAdapter.isLobbyConnected()) {
          yield* wsClient.disconnect()
        }

        if (connectionAdapter.isRoomConnected()) {
          yield* wsClient.disconnect()
        }

        activeRole = O.none()
      }) as Effect.Effect<void, UserServiceError, UserWebSocket | ConnectionAdapter>,

    getCurrentRole: () =>
      Effect.succeed(O.getOrNull(activeRole)) as Effect.Effect<UserRoleType | null, never, ConnectionAdapter>
  }
}

/**
 * User Feature Layer
 *
 * Scoped layer that provides UserService with its UserWebSocket dependency.
 * Should be provided at the route level (DJRoom, ListenerRoom) for proper scoping.
 */
export const UserFeatureLayer = Layer.scoped(
  UserService,
  Effect.gen(function* () {
    // Resolve dependencies within this layer context
    const connectionAdapter = yield* ConnectionAdapter
    const userAdapter = yield* UserAdapter
    const audioAdapter = yield* AudioAdapter
    const userWebSocket = yield* UserWebSocket
    const mediaSoupClient = yield* MediaSoupClient
    const audioClient = yield* AudioClient

    // Get the service implementation
    const serviceImpl = createUserServiceImpl()

    // Return service implementation with resolved dependencies provided to each method
    return {
      publishDJRoom: (roomId: string, djWebSocketUrl: string, deviceId?: string) =>
        serviceImpl.publishDJRoom(roomId, djWebSocketUrl, deviceId).pipe(
          Effect.provideService(UserAdapter, userAdapter),
          Effect.provideService(UserWebSocket, userWebSocket),
          Effect.provideService(MediaSoupClient, mediaSoupClient),
          Effect.provideService(AudioClient, audioClient),
          Effect.provideService(AudioAdapter, audioAdapter),
          Effect.provideService(ConnectionAdapter, connectionAdapter)
        ),
      closeDJRoom: () =>
        serviceImpl.closeDJRoom().pipe(
          Effect.provideService(ConnectionAdapter, connectionAdapter),
          Effect.provideService(AudioAdapter, audioAdapter),
          Effect.provideService(UserWebSocket, userWebSocket),
          Effect.provideService(MediaSoupClient, mediaSoupClient),
          Effect.provideService(AudioClient, audioClient)
        ),
      pauseStream: () =>
        serviceImpl.pauseStream().pipe(
          Effect.provideService(UserWebSocket, userWebSocket),
          Effect.provideService(AudioAdapter, audioAdapter)
        ),
      resumeStream: () =>
        serviceImpl.resumeStream().pipe(
          Effect.provideService(UserWebSocket, userWebSocket),
          Effect.provideService(AudioAdapter, audioAdapter)
        ),
      joinRoomAsListener: (roomId: string, sessionId: string) =>
        serviceImpl.joinRoomAsListener(roomId, sessionId).pipe(
          Effect.provideService(UserAdapter, userAdapter),
          Effect.provideService(UserWebSocket, userWebSocket),
          Effect.provideService(MediaSoupClient, mediaSoupClient),
          Effect.provideService(AudioClient, audioClient),
          Effect.provideService(AudioAdapter, audioAdapter),
          Effect.provideService(ConnectionAdapter, connectionAdapter)
        ),
      leaveListenerRoom: (listenerId: string) =>
        serviceImpl.leaveListenerRoom(listenerId).pipe(
          Effect.provideService(ConnectionAdapter, connectionAdapter),
          Effect.provideService(UserWebSocket, userWebSocket),
          Effect.provideService(MediaSoupClient, mediaSoupClient),
          Effect.provideService(AudioClient, audioClient),
          Effect.provideService(AudioAdapter, audioAdapter)
        ),
      connect: (url: string) =>
        serviceImpl.connect(url).pipe(
          Effect.provideService(UserWebSocket, userWebSocket),
          Effect.provideService(ConnectionAdapter, connectionAdapter)
        ),
      disconnect: () =>
        serviceImpl.disconnect().pipe(
          Effect.provideService(UserWebSocket, userWebSocket),
          Effect.provideService(ConnectionAdapter, connectionAdapter)
        ),
      getCurrentRole: () =>
        serviceImpl.getCurrentRole().pipe(
          Effect.provideService(ConnectionAdapter, connectionAdapter)
        )
    } satisfies Context.Tag.Service<UserService>
  })
)

/**
 * Complete User Layer with All Dependencies
 *
 * Combines UserService with all its dependencies.
 * Use this in global layer compositions.
 * Note: AudioClient is expected to be provided from global layer.
 */
export const UserServiceLive = UserFeatureLayer.pipe(
  Layer.provide(Layer.mergeAll(
    UserWebSocketLive,
    MediaSoupClientLive
  ))
)
