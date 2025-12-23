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
import type { Producer, Consumer, Transport } from 'mediasoup-client/lib/types'

// Import only adapters via Context.Tag
import { ConnectionAdapter, UserAdapter, LobbyAdapter } from '../../stores'

// Import only infrastructure via Context.Tag
import { WebSocketClientService } from '../infrastructure/WebSocketClient'
import { MediaSoupClient } from '../infrastructure/MediaSoupClient'
import { AudioClient } from '../infrastructure/AudioClient'

// Import domain schemas and types
import { 
  UserServiceError, 
  type UserRoleType,
  type DJPublishResultType,
  type ListenerJoinResultType 
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
    readonly previewAudioDevice: (deviceId: string) => Effect.Effect<MediaStream, UserServiceError, AudioClient>
    readonly stopDevicePreview: () => Effect.Effect<void, UserServiceError, AudioClient>
    readonly publishDJRoom: (roomId: string, djWebSocketUrl: string, deviceId?: string) => Effect.Effect<DJPublishResultType, UserServiceError, ConnectionAdapter | UserAdapter | LobbyAdapter | WebSocketClientService | MediaSoupClient | AudioClient>
    readonly toggleDJStream: (pause: boolean) => Effect.Effect<void, UserServiceError, UserAdapter | WebSocketClientService>
    readonly closeDJRoom: () => Effect.Effect<void, UserServiceError, ConnectionAdapter | UserAdapter | LobbyAdapter | WebSocketClientService | AudioClient>
    readonly getAudioDevices: () => Effect.Effect<Array<{ deviceId: string, label: string }>, UserServiceError, AudioClient>

    // Listener Operations
    readonly joinRoomAsListener: (roomId: string, sessionId: string, listenerWebSocketUrl: string) => Effect.Effect<ListenerJoinResultType, UserServiceError, UserAdapter | ConnectionAdapter | LobbyAdapter | WebSocketClientService | MediaSoupClient | AudioClient>
    readonly leaveListenerRoom: (listenerId: string) => Effect.Effect<void, UserServiceError, UserAdapter | ConnectionAdapter | LobbyAdapter | WebSocketClientService | MediaSoupClient | AudioClient>

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
  let activeRoomId = O.none<string>()
  
  // Private fields for MediaSoup resources
  let activeProducer = O.none<Producer>()  // MediaSoup Producer
  let activeTransport = O.none<Transport>()  // MediaSoup Transport
  let activeConsumer = O.none<Consumer>()  // MediaSoup Consumer (for listener)

  return {
    // ============= DJ Operations =============

    previewAudioDevice: (deviceId: string) =>
      Effect.gen(function* () {
        const audioClient = yield* AudioClient
        
        // AudioClient handles all preview state internally
        return yield* audioClient.selectDevice(deviceId)
      }) as Effect.Effect<MediaStream, UserServiceError, AudioClient>,

    stopDevicePreview: () =>
      Effect.gen(function* () {
        const audioClient = yield* AudioClient
        
        // AudioClient handles all stream cleanup
        yield* audioClient.stopStream()
      }) as Effect.Effect<void, UserServiceError, AudioClient>,

    publishDJRoom: (roomId: string, djWebSocketUrl: string, deviceId?: string) =>
      Effect.gen(function* () {
        const wsClient = yield* WebSocketClientService
        const mediaSoupClient = yield* MediaSoupClient
        const audioClient = yield* AudioClient
        const userAdapter = yield* UserAdapter
        
        // Set active state
        activeRole = O.some('dj' as UserRoleType)
        activeRoomId = O.some(roomId)
        userAdapter.setCurrentRole('dj')
        
        try {
          // 1. Connect WebSocket to room
          yield* wsClient.connectRoom(djWebSocketUrl)
          
          // 2. Initialize room and get RTP capabilities
          yield* wsClient.sendDJCommand({ type: 'initRoom', roomId } as any)
          const rtpCapabilitiesEvent = yield* wsClient.waitForDJEvent('roomInitialized')
          
          // 3. Create MediaSoup device
          const device = yield* mediaSoupClient.createDevice(rtpCapabilitiesEvent.rtpCapabilities)
          
          // 4. Request transport from server
          yield* wsClient.sendDJCommand({ type: 'requestDjTransport' } as any)
          const transportEvent = yield* wsClient.waitForDJEvent('djTransportReady')
          
          // 5. Create send transport
          const transport = yield* mediaSoupClient.createSendTransport(device, transportEvent.transportOptions)
          activeTransport = O.some(transport)
          
          // 6. Connect transport
          yield* wsClient.sendDJCommand({ 
            type: 'connectDjTransport',
            transportId: O.some(transport.id),
            dtlsParameters: transport.dtlsParameters
          } as any)
          yield* wsClient.waitForDJEvent('transportConnected')
          
          // 7. Get audio stream if deviceId provided
          const stream = deviceId ? yield* audioClient.selectDevice(deviceId) : yield* audioClient.getCurrentStream().pipe(
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
          
          const producer = yield* mediaSoupClient.createProducer(transport, audioTrack)
          activeProducer = O.some(producer)
          
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
          // Cleanup on error
          pipe(activeProducer, O.map(p => p.close()))
          pipe(activeTransport, O.map(t => t.close()))
          activeProducer = O.none()
          activeTransport = O.none()
          activeRole = O.none()
          activeRoomId = O.none()
          
          throw error
        }
      }) as Effect.Effect<DJPublishResultType, UserServiceError, ConnectionAdapter | UserAdapter | LobbyAdapter | WebSocketClientService | MediaSoupClient | AudioClient>,

    toggleDJStream: (pause: boolean) =>
      Effect.gen(function* () {
        const wsClient = yield* WebSocketClientService

        return yield* pipe(
          activeProducer,
          O.match({
            onNone: () => Effect.fail(new UserServiceError({
              cause: 'No active producer to toggle',
              operation: 'toggleDJStream',
              role: 'dj' as UserRoleType,
              timestamp: new Date()
            })),
            onSome: (producer) => Effect.gen(function* () {
              if (pause) {
                producer.pause()
                yield* wsClient.sendDJCommand({ type: 'pauseStream' } as any)
              } else {
                producer.resume()
                yield* wsClient.sendDJCommand({ type: 'resumeStream' } as any)
              }
            })
          })
        )
      }) as Effect.Effect<void, UserServiceError, WebSocketClientService>,

    closeDJRoom: () =>
      Effect.gen(function* () {
        const connectionAdapter = yield* ConnectionAdapter
        const wsClient = yield* WebSocketClientService
        const audioClient = yield* AudioClient

        // Send close command if connected
        if (connectionAdapter.isRoomConnected()) {
          yield* wsClient.sendDJCommand({ type: 'closeRoom' } as any)
        }

        // Clean up MediaSoup resources using private fields
        pipe(
          activeProducer,
          O.map(producer => {
            if (!producer.closed) {
              producer.close()
            }
          })
        )

        pipe(
          activeTransport,
          O.map(transport => {
            if (transport.connectionState !== 'closed') {
              transport.close()
            }
          })
        )

        // Stop audio stream
        yield* audioClient.stopStream()

        // Disconnect WebSocket
        yield* wsClient.disconnectRoom()

        // Reset state
        connectionAdapter.resetRoom()
        
        // Clear private fields
        activeProducer = O.none()
        activeTransport = O.none()
        activeRole = O.none()
        activeRoomId = O.none()
      }) as Effect.Effect<void, UserServiceError, ConnectionAdapter | WebSocketClientService | AudioClient>,

    getAudioDevices: () =>
      Effect.gen(function* () {
        const audioClient = yield* AudioClient
        const devices = yield* audioClient.getAudioDevices()
        // Map to expected format
        return devices.map(d => ({
          deviceId: d.deviceId,
          label: d.label || 'Unknown Device'
        }))
      }) as Effect.Effect<Array<{ deviceId: string, label: string }>, UserServiceError, AudioClient>,

    // ============= Listener Operations =============

    joinRoomAsListener: (roomId: string, sessionId: string, listenerWebSocketUrl: string) =>
      Effect.gen(function* () {
        const wsClient = yield* WebSocketClientService
        const mediaSoupClient = yield* MediaSoupClient
        const audioClient = yield* AudioClient
        const userAdapter = yield* UserAdapter
        
        // Set active state
        activeRole = O.some('listener' as UserRoleType)
        activeRoomId = O.some(roomId)
        userAdapter.setCurrentRole('listener')
        
        try {
          // 1. Connect WebSocket to room
          yield* wsClient.connectRoom(listenerWebSocketUrl)
          
          // 2. Initialize listener
          yield* wsClient.sendListenerCommand({ type: 'initListener' } as any)
          const joinReadyEvent = yield* wsClient.waitForListenerEvent('joinReady')
          
          // 3. Create MediaSoup device
          const device = yield* mediaSoupClient.createDevice(joinReadyEvent.rtpCapabilities)
          
          // 4. Create receive transport
          const transport = yield* mediaSoupClient.createReceiveTransport(device, joinReadyEvent.transportOptions)
          activeTransport = O.some(transport)
          
          // 5. Connect transport
          yield* wsClient.sendListenerCommand({ 
            type: 'connectListenerTransport',
            transportId: O.some(transport.id),
            dtlsParameters: transport.dtlsParameters
          } as any)
          yield* wsClient.waitForListenerEvent('transportConnected')
          
          // 6. Request consumer
          yield* wsClient.sendListenerCommand({ 
            type: 'requestConsumer',
            rtpCapabilities: device.rtpCapabilities
          } as any)
          const consumerEvent = yield* wsClient.waitForListenerEvent('consumerCreated')
          
          // 7. Create consumer
          const consumer = yield* mediaSoupClient.createConsumer(transport, {
            id: consumerEvent.consumerId,
            producerId: consumerEvent.producerId,
            kind: 'audio' as any,
            rtpParameters: consumerEvent.consumerParameters.rtpParameters
          })
          activeConsumer = O.some(consumer)
          
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
        } catch (error) {
          // Cleanup on error
          pipe(activeConsumer, O.map(c => c.close()))
          pipe(activeTransport, O.map(t => t.close()))
          activeConsumer = O.none()
          activeTransport = O.none()
          activeRole = O.none()
          activeRoomId = O.none()
          
          throw error
        }
      }) as Effect.Effect<ListenerJoinResultType, UserServiceError, UserAdapter | ConnectionAdapter | LobbyAdapter | WebSocketClientService | MediaSoupClient | AudioClient>,

    leaveListenerRoom: (listenerId: string) =>
      Effect.gen(function* () {
        const connectionAdapter = yield* ConnectionAdapter
        const wsClient = yield* WebSocketClientService
        const audioClient = yield* AudioClient

        // Clean up audio playback using AudioClient
        yield* audioClient.stopStream()

        // Clean up MediaSoup consumer using private field
        pipe(
          activeConsumer,
          O.map(consumer => {
            if (!consumer.closed) {
              consumer.close()
            }
          })
        )

        // Clean up transport using private field
        pipe(
          activeTransport,
          O.map(transport => {
            if (transport.connectionState !== 'closed') {
              transport.close()
            }
          })
        )

        // Disconnect WebSocket
        yield* wsClient.disconnectRoom()

        // Reset state
        connectionAdapter.resetRoom()
        
        // Clear private fields
        activeConsumer = O.none()
        activeTransport = O.none()
        activeRole = O.none()
        activeRoomId = O.none()
      }) as Effect.Effect<void, UserServiceError, ConnectionAdapter | WebSocketClientService | AudioClient>,


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
        activeRoomId = O.none()
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
