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

import { Effect, Context, Layer, Option as O } from 'effect'

// Import only adapters via Context.Tag
import { ConnectionAdapter, UserAdapter } from '../../stores'

// Import only infrastructure via Context.Tag
import { WebSocketClientService } from '../infrastructure/WebSocketClient'
import { MediaSoupClient } from '../infrastructure/MediaSoupClient'
import { AudioClient } from '../infrastructure/AudioClient'

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
    readonly closeDJRoom: () => Effect.Effect<void, UserServiceError, ConnectionAdapter | WebSocketClientService | AudioClient | MediaSoupClient>
    readonly getAudioDevices: () => Effect.Effect<Array<{ deviceId: string, label: string }>, UserServiceError, AudioClient>

    // Listener Operations
    readonly joinRoomAsListener: (roomId: string, sessionId: string, listenerWebSocketUrl: string) => Effect.Effect<{ readonly listenerId: string; readonly roomId: string; readonly sessionId: string; readonly joinedAt: Date }, UserServiceError, UserAdapter | WebSocketClientService | MediaSoupClient | AudioClient>
    readonly leaveListenerRoom: (listenerId: string) => Effect.Effect<void, UserServiceError, ConnectionAdapter | WebSocketClientService>

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

        // Set active state
        activeRole = O.some('dj' as UserRoleType)
        userAdapter.setCurrentRole('dj')

        try {
          // 1. Connect WebSocket to room
          yield* wsClient.connectRoom(djWebSocketUrl)

          // 2. Initialize room and get RTP capabilities
          yield* wsClient.sendDJCommand({ type: 'initRoom', roomId } as any)
          const rtpCapabilitiesEvent = yield* wsClient.waitForDJEvent('roomInitialized')

          // 3. Initialize MediaSoup device
          yield* mediaSoupClient.initDevice(rtpCapabilitiesEvent.rtpCapabilities)

          // 4. Request transport from server
          yield* wsClient.sendDJCommand({ type: 'requestDjTransport' } as any)
          const transportEvent = yield* wsClient.waitForDJEvent('djTransportReady')

          // 5. Create send transport
          const transport = yield* mediaSoupClient.createSendTransport(transportEvent.transportOptions)

          // 6. Connect transport
          yield* wsClient.sendDJCommand({
            type: 'connectDjTransport',
            transportId: O.some(transport.id),
            dtlsParameters: transportEvent.transportOptions.dtlsParameters
          })
          yield* wsClient.waitForDJEvent('transportConnected')
          yield* mediaSoupClient.connectActiveTransport(transportEvent.transportOptions.dtlsParameters)

          // 7. Get audio stream if deviceId provided
          const stream = deviceId ? yield* audioClient.selectDevice(deviceId) : yield* audioClient.currentStream().pipe(
            O.match({
              onNone: () => Effect.fail(new UserServiceError({
                cause: 'No audio device selected',
                operation: 'publishDJRoom',
                role: 'dj' as UserRoleType,
                timestamp: new Date()
              })),
              onSome: stream => Effect.succeed(stream)
            })
          )

          // 8. Create producer from audio track
          const audioTrack = stream.getAudioTracks()[0]
          if (!audioTrack) {
            throw new UserServiceError({
              cause: 'No audio track in stream',
              operation: 'publishDJRoom',
              role: 'dj' as UserRoleType,
              timestamp: new Date()
            })
          }

          const producer = yield* mediaSoupClient.createProducer(audioTrack)

          // 9. Notify server about producer
          yield* wsClient.sendDJCommand({
            type: 'produce',
            rtpParameters: producer.rtpParameters
          } as any)
          const producerEvent = yield* wsClient.waitForDJEvent('producerCreated')

          return {
            roomId: producerEvent.roomId,
            producerId: producerEvent.producerId,
            djWebSocketUrl,
            publishedAt: new Date()
          }
        } catch (error) {
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
          yield* wsClient.sendDJCommand({ type: 'closeRoom' } as any).pipe(
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

    getAudioDevices: () =>
      Effect.gen(function* () {
        const audioClient = yield* AudioClient
        const devices = yield* audioClient.getAudioDevices().pipe(
          Effect.mapError((error) => new UserServiceError({
            cause: `Failed to get audio devices: ${error}`,
            role: 'dj', // Audio devices are typically requested by DJs
            operation: 'getAudioDevices',
            timestamp: new Date()
          }))
        )
        // Map to expected format
        return devices.map(d => ({
          deviceId: d.deviceId,
          label: d.label || 'Unknown Device'
        }))
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
        yield* wsClient.sendListenerCommand({ type: 'initListener' } as any)
        const joinReadyEvent = yield* wsClient.waitForListenerEvent('joinReady')

          // 3. Initialize MediaSoup device
          yield* mediaSoupClient.initDevice(joinReadyEvent.rtpCapabilities)

          // 4. Create receive transport
          const transport = yield* mediaSoupClient.createReceiveTransport(joinReadyEvent.transportOptions)

          // 5. Connect transport
          yield* wsClient.sendListenerCommand({
            type: 'connectListenerTransport',
            transportId: O.some(transport.id),
            dtlsParameters: joinReadyEvent.transportOptions.dtlsParameters
          } as any)
          yield* wsClient.waitForListenerEvent('transportConnected')
          yield* mediaSoupClient.connectActiveTransport(joinReadyEvent.transportOptions.dtlsParameters)

          // 6. Request consumer
          const rtpCapabilities = yield* mediaSoupClient.getDeviceCapabilities()
          yield* wsClient.sendListenerCommand({
            type: 'requestConsumer',
            rtpCapabilities
          } as any)
          const consumerEvent = yield* wsClient.waitForListenerEvent('consumerCreated')

          // 7. Create consumer (consumerParameters already has all required fields from transform)
          const consumer = yield* mediaSoupClient.createConsumer(consumerEvent.consumerParameters)

          // 8. Connect remote stream for audio playback
          const remoteStream = new MediaStream([consumer.track])
          yield* audioClient.connectRemoteStream(remoteStream)

          // 9. Resume consumer if needed
          if (consumer.paused) {
            yield* wsClient.sendListenerCommand({
              type: 'resumeConsumer',
              consumerId: consumer.id
            } as any)
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
