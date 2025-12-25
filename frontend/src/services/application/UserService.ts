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
import { UserWebSocket, createWebSocketClientService } from '../infrastructure/WebSocketClient'
import { MediaSoupClient, MediaSoupClientLive } from '../infrastructure/MediaSoupClient'
import { AudioClient, AudioClientLive } from '../infrastructure/AudioClient'
import { ConnectionAdapterLive } from '../../stores/connection/connection.adapter'

// Import WebSocket command schemas for S.make construction and event types
import { 
  InitRoomCommandSchema, 
  RequestDjTransportCommandSchema, 
  ConnectDjTransportCommandSchema, 
  ProduceCommandSchema,
  CloseRoomCommandSchema,
  InitListenerCommandSchema,
  ConnectListenerTransportCommandSchema,
  RequestConsumerCommandSchema,
  ResumeConsumerCommandSchema,
  // Event types
  type RoomInitializedEvent,
  type DjTransportReadyEvent,
  type TransportConnectedEvent,
  type ProducerCreatedEvent,
  type RoomClosedEvent,
  type JoinReadyEvent,
  type ConsumerCreatedEvent
} from '../../domain/schemas/shared/websocket.schema'

// Import domain schemas and types
import {
  UserServiceError,
  type UserRoleType,
  type DJPublishResultType
} from '../../domain/schemas/user.schema'
import { WsConnectionState } from '../../domain/schemas/connection.schema'
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

    // Listener Operations
    readonly joinRoomAsListener: (roomId: string, sessionId: string, listenerWebSocketUrl: string) => Effect.Effect<{ readonly listenerId: string; readonly roomId: string; readonly sessionId: string; readonly joinedAt: Date }, UserServiceError, never>
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

  return {
    // ============= DJ Operations =============

    publishDJRoom: (roomId: string, djWebSocketUrl: string, deviceId?: string) =>
      Effect.gen(function* () {
        const wsClient = yield* UserWebSocket
        const mediaSoupClient = yield* MediaSoupClient
        const audioClient = yield* AudioClient
        const userAdapter = yield* UserAdapter

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
          
          // Send command and wait for response in one call
          const rtpCapabilitiesEvent = yield* wsClient.sendCommand<RoomInitializedEvent>(
            InitRoomCommandSchema.make({ roomId })
          )

          // 4. Initialize MediaSoup device
          console.info('🎛️ UserService: Initializing MediaSoup device...')
          yield* mediaSoupClient.initDevice(rtpCapabilitiesEvent.rtpCapabilities)

          // 5. Request transport from server
          console.info('🚛 UserService: Requesting transport...')
          
          // Send command and wait for response in one call
          const transportEvent = yield* wsClient.sendCommand<DjTransportReadyEvent>(
            RequestDjTransportCommandSchema.make({})
          )

          // 6. Create send transport WITH event handlers
          console.info('🔧 UserService: Creating send transport with event handlers...')
          const transport = yield* mediaSoupClient.createSendTransport(transportEvent.transportOptions, {
            onConnect: async (dtlsParameters) => {
              console.info('🔗 UserService: Transport connect event - sending DTLS params')
              
              // Send command and wait for response in one call
              await Effect.runPromise(
                wsClient.sendCommand<TransportConnectedEvent>(
                  ConnectDjTransportCommandSchema.make({
                    transportId: O.some(transport.id),
                    dtlsParameters
                  })
                )
              )
              console.info('✅ UserService: Transport connected successfully')
            },
            onProduce: async (rtpParameters) => {
              console.info('🎤 UserService: Transport produce event - sending RTP params')
              
              // Send command and wait for response in one call
              const producerEvent = await Effect.runPromise(
                wsClient.sendCommand<ProducerCreatedEvent>(
                  ProduceCommandSchema.make({ rtpParameters })
                )
              )
              console.info('✅ UserService: Producer created successfully', { producerId: producerEvent.producerId })
              return producerEvent.producerId
            }
          })

          // 8. Create producer from audio track (this will trigger the events)
          console.info('🎵 UserService: Creating producer...')
          const producer = yield* mediaSoupClient.createProducer(audioTrack)

          return {
            roomId,
            producerId: producer.id,
            djWebSocketUrl,
            publishedAt: new Date()
          }
        } catch (error) {
          console.error('❌ UserService: Error in DJ publishing flow:', error)
          // Cleanup MediaSoup resources on error
          yield* mediaSoupClient.cleanup()
          activeRole = O.none()

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
          yield* wsClient.sendCommand<RoomClosedEvent>(CloseRoomCommandSchema.make({})).pipe(
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


    // ============= Listener Operations =============

    joinRoomAsListener: (roomId: string, sessionId: string, listenerWebSocketUrl: string) =>
      Effect.gen(function* () {
        const wsClient = yield* UserWebSocket
        const mediaSoupClient = yield* MediaSoupClient
        const audioClient = yield* AudioClient
        const userAdapter = yield* UserAdapter

        // Set active state
        activeRole = O.some('listener' as UserRoleType)
        userAdapter.setCurrentRole('listener')

        // 1. Connect WebSocket to room
        yield* wsClient.connect(listenerWebSocketUrl)

        // 2. Initialize listener
        console.info('🔗 UserService: Initializing listener...')
        
        // Send command and wait for response in one call
        const joinReadyEvent = yield* wsClient.sendCommand<JoinReadyEvent>(
          InitListenerCommandSchema.make({})
        )

          // 3. Initialize MediaSoup device
          yield* mediaSoupClient.initDevice(joinReadyEvent.rtpCapabilities)

          // 4. Create receive transport
          const transport = yield* mediaSoupClient.createReceiveTransport(joinReadyEvent.transportOptions)

          // 5. Connect transport
          console.info('🔗 UserService: Connecting transport...')
          
          // Send command and wait for response in one call
          yield* wsClient.sendCommand<TransportConnectedEvent>(
            ConnectListenerTransportCommandSchema.make({
              transportId: O.some(transport.id),
              dtlsParameters: joinReadyEvent.transportOptions.dtlsParameters
            })
          )
          yield* mediaSoupClient.connectActiveTransport(joinReadyEvent.transportOptions.dtlsParameters)

          // 6. Request consumer
          console.info('🎧 UserService: Requesting consumer...')
          const rtpCapabilities = yield* mediaSoupClient.getDeviceCapabilities()
          
          // Send command and wait for response in one call
          const consumerEvent = yield* wsClient.sendCommand<ConsumerCreatedEvent>(
            RequestConsumerCommandSchema.make({ rtpCapabilities })
          )

          // 7. Create consumer (consumerParameters already has all required fields from transform)
          const consumer = yield* mediaSoupClient.createConsumer(consumerEvent.consumerParameters)

          // 8. Connect remote stream for audio playback
          const remoteStream = new MediaStream([consumer.track])
          yield* audioClient.connectRemoteStream(remoteStream)

          // 9. Resume consumer if needed
          if (consumer.paused) {
            yield* wsClient.sendCommandFireForget(ResumeConsumerCommandSchema.make({
              consumerId: consumer.id
            }))
          }

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
            // Cleanup MediaSoup resources on error
            const mediaSoupClient = yield* MediaSoupClient
            yield* mediaSoupClient.cleanup()
            activeRole = O.none()

            // Map error to UserServiceError
            return yield* Effect.fail(new UserServiceError({
              cause: `Failed to join room as listener: ${error}`,
              role: 'listener',
              operation: 'joinRoomAsListener',
              timestamp: new Date()
            }))
          })
        )
      ) as Effect.Effect<{ readonly listenerId: string; readonly roomId: string; readonly sessionId: string; readonly joinedAt: Date }, UserServiceError, UserAdapter | UserWebSocket | MediaSoupClient | AudioClient>,

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
          Effect.provideService(AudioClient, audioClient)
        ),
      closeDJRoom: () =>
        serviceImpl.closeDJRoom().pipe(
          Effect.provideService(ConnectionAdapter, connectionAdapter),
          Effect.provideService(AudioAdapter, audioAdapter),
          Effect.provideService(UserWebSocket, userWebSocket),
          Effect.provideService(MediaSoupClient, mediaSoupClient),
          Effect.provideService(AudioClient, audioClient)
        ),
      joinRoomAsListener: (roomId: string, sessionId: string, listenerWebSocketUrl: string) =>
        serviceImpl.joinRoomAsListener(roomId, sessionId, listenerWebSocketUrl).pipe(
          Effect.provideService(UserAdapter, userAdapter),
          Effect.provideService(UserWebSocket, userWebSocket),
          Effect.provideService(MediaSoupClient, mediaSoupClient),
          Effect.provideService(AudioClient, audioClient)
        ),
      leaveListenerRoom: (listenerId: string) =>
        serviceImpl.leaveListenerRoom(listenerId).pipe(
          Effect.provideService(ConnectionAdapter, connectionAdapter),
          Effect.provideService(UserWebSocket, userWebSocket),
          Effect.provideService(MediaSoupClient, mediaSoupClient),
          Effect.provideService(AudioClient, audioClient)
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
 */
export const UserServiceLive = UserFeatureLayer.pipe(
  Layer.provide(Layer.mergeAll(
    Layer.scoped(UserWebSocket, createWebSocketClientService),
    MediaSoupClientLive.pipe(Layer.provide(ConnectionAdapterLive)),
    AudioClientLive
  ))
)
