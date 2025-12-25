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
import { WebSocketClientService } from '../infrastructure/WebSocketClient'
import { MediaSoupClient } from '../infrastructure/MediaSoupClient'
import { AudioClient } from '../infrastructure/AudioClient'

// Import WebSocket command schemas for S.make construction and event enums
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
  WEBSOCKET_DJ_EVENT_TYPES,
  WEBSOCKET_LISTENER_EVENT_TYPES
} from '../../domain/schemas/shared/websocket.schema'

// Import domain schemas and types
import {
  UserServiceError,
  type UserRoleType,
  type DJPublishResultType
} from '../../domain/schemas/user.schema'
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
    readonly publishDJRoom: (roomId: string, djWebSocketUrl: string, deviceId?: string) => Effect.Effect<DJPublishResultType, UserServiceError, UserAdapter | WebSocketClientService | MediaSoupClient | AudioClient>
    readonly closeDJRoom: () => Effect.Effect<void, UserServiceError, ConnectionAdapter | AudioAdapter | WebSocketClientService | AudioClient | MediaSoupClient>

    // Listener Operations
    readonly joinRoomAsListener: (roomId: string, sessionId: string, listenerWebSocketUrl: string) => Effect.Effect<{ readonly listenerId: string; readonly roomId: string; readonly sessionId: string; readonly joinedAt: Date }, UserServiceError, UserAdapter | WebSocketClientService | MediaSoupClient | AudioClient>
    readonly leaveListenerRoom: (listenerId: string) => Effect.Effect<void, UserServiceError, ConnectionAdapter | WebSocketClientService | AudioClient | MediaSoupClient>

    // Shared Operations
    readonly disconnect: () => Effect.Effect<void, UserServiceError, WebSocketClientService | ConnectionAdapter>
    readonly getCurrentRole: () => Effect.Effect<UserRoleType | null, never, ConnectionAdapter>
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
        const wsClient = yield* WebSocketClientService
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
          console.info('📡 UserService: Initializing room...')
          yield* wsClient.sendDJCommand(InitRoomCommandSchema.make({ roomId }))
          const rtpCapabilitiesEvent = yield* wsClient.waitForDJEvent(WEBSOCKET_DJ_EVENT_TYPES.ROOM_INITIALIZED)

          // 4. Initialize MediaSoup device
          console.info('🎛️ UserService: Initializing MediaSoup device...')
          yield* mediaSoupClient.initDevice(rtpCapabilitiesEvent.rtpCapabilities)

          // 5. Request transport from server
          console.info('🚛 UserService: Requesting transport...')
          yield* wsClient.sendDJCommand(RequestDjTransportCommandSchema.make({}))
          const transportEvent = yield* wsClient.waitForDJEvent(WEBSOCKET_DJ_EVENT_TYPES.DJ_TRANSPORT_READY)

          // 6. Create send transport WITH event handlers
          console.info('🔧 UserService: Creating send transport with event handlers...')
          const transport = yield* mediaSoupClient.createSendTransport(transportEvent.transportOptions, {
            onConnect: async (dtlsParameters) => {
              console.info('🔗 UserService: Transport connect event - sending DTLS params to server')
              await Effect.runPromise(
                wsClient.sendDJCommand(ConnectDjTransportCommandSchema.make({
                  transportId: O.some(transport.id),
                  dtlsParameters
                }))
              )
              await Effect.runPromise(wsClient.waitForDJEvent(WEBSOCKET_DJ_EVENT_TYPES.TRANSPORT_CONNECTED))
              console.info('✅ UserService: Transport connected successfully')
            },
            onProduce: async (rtpParameters) => {
              console.info('🎤 UserService: Transport produce event - sending RTP params to server')
              await Effect.runPromise(
                wsClient.sendDJCommand(ProduceCommandSchema.make({
                  rtpParameters
                }))
              )
              const producerEvent = await Effect.runPromise(
                wsClient.waitForDJEvent(WEBSOCKET_DJ_EVENT_TYPES.PRODUCER_CREATED)
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
      }) as Effect.Effect<DJPublishResultType, UserServiceError, UserAdapter | WebSocketClientService | MediaSoupClient | AudioClient>,

    closeDJRoom: () =>
      Effect.gen(function* () {
        const connectionAdapter = yield* ConnectionAdapter
        const wsClient = yield* WebSocketClientService
        const audioClient = yield* AudioClient
        const mediaSoupClient = yield* MediaSoupClient

        // Send close command if connected
        if (connectionAdapter.isRoomConnected()) {
          yield* wsClient.sendDJCommand(CloseRoomCommandSchema.make({})).pipe(
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
        yield* wsClient.disconnectRoom().pipe(
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
        const wsClient = yield* WebSocketClientService
        const mediaSoupClient = yield* MediaSoupClient
        const audioClient = yield* AudioClient
        const userAdapter = yield* UserAdapter

        // Set active state
        activeRole = O.some('listener' as UserRoleType)
        userAdapter.setCurrentRole('listener')

        // 1. Connect WebSocket to room
        yield* wsClient.connectRoom(listenerWebSocketUrl)

        // 2. Initialize listener
        yield* wsClient.sendListenerCommand(InitListenerCommandSchema.make({}))
        const joinReadyEvent = yield* wsClient.waitForListenerEvent(WEBSOCKET_LISTENER_EVENT_TYPES.JOIN_READY)

          // 3. Initialize MediaSoup device
          yield* mediaSoupClient.initDevice(joinReadyEvent.rtpCapabilities)

          // 4. Create receive transport
          const transport = yield* mediaSoupClient.createReceiveTransport(joinReadyEvent.transportOptions)

          // 5. Connect transport
          yield* wsClient.sendListenerCommand(ConnectListenerTransportCommandSchema.make({
            transportId: O.some(transport.id),
            dtlsParameters: joinReadyEvent.transportOptions.dtlsParameters
          }))
          yield* wsClient.waitForListenerEvent(WEBSOCKET_LISTENER_EVENT_TYPES.TRANSPORT_CONNECTED)
          yield* mediaSoupClient.connectActiveTransport(joinReadyEvent.transportOptions.dtlsParameters)

          // 6. Request consumer
          const rtpCapabilities = yield* mediaSoupClient.getDeviceCapabilities()
          yield* wsClient.sendListenerCommand(RequestConsumerCommandSchema.make({
            rtpCapabilities
          }))
          const consumerEvent = yield* wsClient.waitForListenerEvent(WEBSOCKET_LISTENER_EVENT_TYPES.CONSUMER_CREATED)

          // 7. Create consumer (consumerParameters already has all required fields from transform)
          const consumer = yield* mediaSoupClient.createConsumer(consumerEvent.consumerParameters)

          // 8. Connect remote stream for audio playback
          const remoteStream = new MediaStream([consumer.track])
          yield* audioClient.connectRemoteStream(remoteStream)

          // 9. Resume consumer if needed
          if (consumer.paused) {
            yield* wsClient.sendListenerCommand(ResumeConsumerCommandSchema.make({
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
      ) as Effect.Effect<{ readonly listenerId: string; readonly roomId: string; readonly sessionId: string; readonly joinedAt: Date }, UserServiceError, UserAdapter | WebSocketClientService | MediaSoupClient | AudioClient>,

    leaveListenerRoom: (_listenerId: string) =>
      Effect.gen(function* () {
        const connectionAdapter = yield* ConnectionAdapter
        const wsClient = yield* WebSocketClientService
        const audioClient = yield* AudioClient
        const mediaSoupClient = yield* MediaSoupClient

        // Clean up audio playback
        yield* audioClient.stopStream()

        // Clean up MediaSoup resources
        yield* mediaSoupClient.cleanup()

        // Disconnect WebSocket
        yield* wsClient.disconnectRoom()

        // Reset state
        connectionAdapter.resetRoom()
        activeRole = O.none()
      }) as Effect.Effect<void, UserServiceError, ConnectionAdapter | WebSocketClientService | AudioClient | MediaSoupClient>,


    // ============= Shared Operations =============

    disconnect: () =>
      Effect.gen(function* () {
        const wsClient = yield* WebSocketClientService
        const connectionAdapter = yield* ConnectionAdapter

        // Disconnect based on active connections
        if (connectionAdapter.isLobbyConnected()) {
          yield* wsClient.disconnectLobby()
        }

        if (connectionAdapter.isRoomConnected()) {
          yield* wsClient.disconnectRoom()
        }

        activeRole = O.none()
      }) as Effect.Effect<void, UserServiceError, WebSocketClientService | ConnectionAdapter>,

    getCurrentRole: () =>
      Effect.succeed(O.getOrNull(activeRole)) as Effect.Effect<UserRoleType | null, never, ConnectionAdapter>
  }
}

/**
 * User Service Layer
 *
 * Live implementation layer that provides the UserService.
 * Use this in your app's main Layer composition.
 *
 * Note: AudioClient and other dependencies are resolved via Context.Tag
 * when the service methods are called, not at layer construction time.
 */
export const UserServiceLive = Layer.succeed(
  UserService,
  createUserServiceImpl()
)
