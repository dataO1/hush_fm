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
  LeaveRoomCommandSchema,
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
  type ListenerStreamResumedEvent,
  type ListenerNotFoundEvent,
  type ListenerRoomClosedEvent
} from '../../domain/schemas/shared/websocket.schema'

// Import domain schemas and types
import {
  UserServiceError,
  type UserRoleType,
  type DJPublishResultType
} from '../../domain/schemas/user.schema'
import { WebrtcConnectionState, WsConnectionState, WebSocketError, WebSocketOperation } from '../../domain/schemas/connection.schema'

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
    readonly joinRoomAsListener: (roomId: string, sessionId: string, meta?: { roomName?: string; djName?: string }, options?: { force?: boolean }) => Effect.Effect<{ readonly listenerId: string; readonly roomId: string; readonly sessionId: string; readonly joinedAt: Date }, UserServiceError, never>
    readonly leaveListenerRoom: (listenerId: string) => Effect.Effect<void, UserServiceError, never>

    /**
     * Start the listener recovery coordinator.
     * Registers visibilitychange / pageshow / online triggers and a listenerNotFound
     * subscription.  Returns a cleanup function (remove listeners + unsubscribe).
     * Must be called AFTER the initial joinRoomAsListener succeeds.
     */
    readonly startListenerRecovery: (config: {
      roomId: string
      sessionId: string
      meta?: { roomName?: string; djName?: string }
      onTerminal: () => void
      canRecover?: () => boolean
    }) => Effect.Effect<() => void, never, never>

    // Shared Operations
    readonly connect: (url: string) => Effect.Effect<void, UserServiceError, never>
    readonly disconnect: () => Effect.Effect<void, UserServiceError, never>
    readonly getCurrentRole: () => Effect.Effect<UserRoleType | null, never, never>

    /**
     * Full client-side teardown for page unmount (back-button / route change) — X3.
     * Role-aware, WS-polite, never fails:
     * - listener: best-effort LeaveRoom (short timeout, errors swallowed) so the
     *   server frees the slot immediately, then stop audio playback, close all
     *   MediaSoup resources, disconnect the WS.
     * - dj: deliberately NO CloseRoom — the server gives a disconnected DJ
     *   pause-then-grace semantics, so accidental navigation must not kill the
     *   party. But the local mic IS released (privacy light off), MediaSoup
     *   resources closed, WS disconnected.
     * Explicit Leave/Close buttons keep using leaveListenerRoom/closeDJRoom.
     */
    readonly teardownOnUnmount: () => Effect.Effect<void, never, never>

    /**
     * Register a window 'pagehide' handler that fire-and-forgets a LeaveRoom
     * command over the open WS (no await — the page is going away). Returns an
     * unregister function; the caller's onCleanup must invoke it.
     */
    readonly registerPagehideLeave: () => Effect.Effect<() => void, never, never>
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
          // Opus produce options — driven by build-time env (from the Nix flake
          // cfg.audio.*) so the browser DJ path (B) matches the line-in path (A).
          const env = (import.meta as any).env ?? {}
          const djCodecOptions = {
            opusStereo: true,
            opusFec: env.HUSHFM_OPUS_ENABLE_FEC === 'true', // match backend FEC setting
            opusDtx: false, // continuous music is never silent — DTX off
            opusMaxAverageBitrate: Number(env.HUSHFM_OPUS_BITRATE) || 160000
          }
          console.info('🎚️ DJ produce Opus options:', djCodecOptions)
          const producer = yield* mediaSoupClient.createProducer(audioTrack, {codecOptions: djCodecOptions}).pipe(
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

    joinRoomAsListener: (roomId: string, sessionId: string, meta?: { roomName?: string; djName?: string }, options?: { force?: boolean }) =>
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

        // Check if we already have an active WebRTC connection TO THIS ROOM (X3).
        // Bypassed when force=true (recovery re-join after mediaSoupClient.cleanup()).
        // cleanup() already calls connectionAdapter.resetRoom(), making isRoomConnected()
        // return false, but force ensures safety even if cleanup was partial.
        //
        // roomId-aware: a WS close only resets roomWsState — nothing resets
        // webrtcConnectionState (it can stay STREAMING from a previous room). A new
        // WS to a DIFFERENT room then makes isRoomConnected() true and the old
        // flag-based guard returned a fake join result (no consumer for the new
        // room → silence). Only short-circuit when the tracked roomId matches;
        // on mismatch/absence treat the state as stale: clean up and run the
        // FULL handshake.
        if (!options?.force && connectionAdapter.isRoomConnected()) {
          const sameRoom = pipe(
            connectionAdapter.getCurrentRoomId(),
            O.match({
              onNone: () => false,
              onSome: (currentId) => currentId === roomId
            })
          )
          if (sameRoom) {
            console.info('✅ UserService: Already connected to this room, skipping handshake')
            connectionAdapter.setCurrentRoomId(roomId)
            return { listenerId: sessionId, roomId, sessionId, joinedAt: new Date() }
          }

          console.warn('⚠️ UserService: Stale connected state (roomId mismatch/absent) — cleaning up and running full handshake', {
            requestedRoomId: roomId,
            trackedRoomId: O.getOrNull(connectionAdapter.getCurrentRoomId())
          })
          yield* mediaSoupClient.cleanup()
          // cleanup() resets roomWsState to DISCONNECTED, but the socket we just
          // connected is genuinely open — restore the truthful WS state.
          if (wsClient.isSocketOpen()) {
            connectionAdapter.setRoomWSState(WsConnectionState.CONNECTED)
          }
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
        yield* audioClient.connectRemoteStream(remoteStream, {
          roomName: meta?.roomName ?? `Room ${roomId}`,
          djName: meta?.djName ?? 'HushFM DJ'
        }).pipe(
          Effect.mapError((error) => new UserServiceError({
            cause: `Failed to connect remote stream: ${error}`,
            role: 'listener',
            operation: 'joinRoomAsListener',
            timestamp: new Date()
          }))
        )

        // 9. Resume consumer unconditionally — backend now creates consumers paused=true,
        //    so we must always send ResumeConsumer after attaching the track to prevent
        //    first-packet loss. Keep ordering: attach track first (step 8), then resume.
        console.info('▶️ UserService: Resuming consumer...')
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

        // Send LeaveRoom command to backend before disconnecting
        const makeLeaveRoomCommand = withSchemaLogging(LeaveRoomCommandSchema, 'LeaveRoomCommand')
        const leaveCommand = yield* makeLeaveRoomCommand({})
        
        // Send command without waiting for response (fire-and-forget)
        yield* wsClient.sendCommandFireForget(leaveCommand).pipe(
          Effect.catchAll((error) => {
            console.warn("Failed to send leave room command:", error)
            return Effect.succeed(void 0) // Continue with cleanup even if command fails
          }),
          Effect.mapError((error) => new UserServiceError({
            cause: `Failed to send leave room command: ${error}`,
            operation: 'leaveListenerRoom',
            role: 'listener',
            timestamp: new Date()
          }))
        )

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
      }).pipe(
        Effect.mapError(() => new UserServiceError({
          cause: 'Failed to disconnect',
          role: O.getOrNull(activeRole) || 'dj',
          operation: 'disconnect',
          timestamp: new Date()
        }))
      ) as Effect.Effect<void, UserServiceError, never>,

    getCurrentRole: () =>
      Effect.succeed(O.getOrNull(activeRole)) as Effect.Effect<UserRoleType | null, never, ConnectionAdapter>,

    // ============= Unmount teardown (X3) =============
    //
    // Role-aware full client-side teardown for back-button / route change.
    // Must NEVER fail or hang unmount: every step is best-effort with errors
    // swallowed (try/catch inside Effect.gen would NOT catch a failing yield* —
    // hence Effect.catchAll on every fallible step).
    teardownOnUnmount: () =>
      Effect.gen(function* () {
        const wsClient = yield* UserWebSocket
        const audioClient = yield* AudioClient
        const mediaSoupClient = yield* MediaSoupClient

        const role = O.getOrNull(activeRole)
        console.info(`🧹 UserService: Unmount teardown starting (role: ${role ?? 'none'})`)

        // Listener: best-effort LeaveRoom so the server frees the slot immediately.
        // DJ: deliberately NO CloseRoom — server-side a vanished DJ gets
        // pause-then-grace, so an accidental back-button must not kill the party.
        if (role === 'listener' && wsClient.isSocketOpen()) {
          const makeLeaveRoomCommand = withSchemaLogging(LeaveRoomCommandSchema, 'LeaveRoomCommand')
          yield* pipe(
            makeLeaveRoomCommand({}),
            Effect.andThen((command) => wsClient.sendCommandFireForget(command)),
            Effect.timeout('500 millis'),
            Effect.catchAll((error) => Effect.sync(() => {
              console.warn('⚠️ UserService: Best-effort LeaveRoom on unmount failed (ignoring):', error)
            }))
          )
        }

        // Stop local audio: listener playback element + anchor bed / AudioContext,
        // DJ captured getUserMedia mic tracks (releases the OS privacy indicator).
        yield* audioClient.stopStream().pipe(
          Effect.catchAll((error) => Effect.sync(() => {
            console.warn('⚠️ UserService: stopStream on unmount failed (ignoring):', error)
          }))
        )

        // Close producer/consumer/transport/device; also resets the connection
        // store's room state (webrtcConnectionState → DISCONNECTED, roomId cleared)
        // so a later join can never short-circuit on stale flags.
        yield* mediaSoupClient.cleanup()

        // WS last — the LeaveRoom frame (if any) was already handed to the socket.
        yield* wsClient.disconnect().pipe(
          Effect.catchAll(() => Effect.succeed(undefined))
        )

        activeRole = O.none()
        console.info('✅ UserService: Unmount teardown completed')
      }) as Effect.Effect<void, never, UserWebSocket | AudioClient | MediaSoupClient | AudioAdapter>
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
      joinRoomAsListener: (roomId: string, sessionId: string, meta?: { roomName?: string; djName?: string }, options?: { force?: boolean }) =>
        serviceImpl.joinRoomAsListener(roomId, sessionId, meta, options).pipe(
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
        ),

      teardownOnUnmount: () =>
        serviceImpl.teardownOnUnmount().pipe(
          Effect.provideService(UserWebSocket, userWebSocket),
          Effect.provideService(MediaSoupClient, mediaSoupClient),
          Effect.provideService(AudioClient, audioClient),
          Effect.provideService(AudioAdapter, audioAdapter)
        ),

      registerPagehideLeave: () =>
        Effect.sync(() => {
          // pagehide = tab close / swipe-away / bfcache navigation. Best-effort
          // LeaveRoom over the open WS — fire-and-forget, strictly synchronous
          // (runSync): pagehide gives no time for async work, and the encode +
          // ws.send path is fully synchronous.
          const onPageHide = () => {
            if (!userWebSocket.isSocketOpen()) return
            try {
              const makeLeaveRoomCommand = withSchemaLogging(LeaveRoomCommandSchema, 'LeaveRoomCommand')
              Effect.runSync(
                makeLeaveRoomCommand({}).pipe(
                  Effect.andThen((command) => userWebSocket.sendCommandFireForget(command))
                )
              )
            } catch {
              // best-effort only — never throw during pagehide
            }
          }
          window.addEventListener('pagehide', onPageHide)
          return () => window.removeEventListener('pagehide', onPageHide)
        }),

      startListenerRecovery: (config) =>
        Effect.gen(function* () {
          // ── Internal coordinator state ──────────────────────────────────────
          let terminal = false
          let recoveryInFlight = false
          let lastFullRejoinAt = 0
          let disconnectedSince: number | null = null
          let disconnectedDebounceTimer: ReturnType<typeof setTimeout> | null = null

          const clearDebounceTimer = () => {
            if (disconnectedDebounceTimer !== null) {
              clearTimeout(disconnectedDebounceTimer)
              disconnectedDebounceTimer = null
            }
          }

          // ── Terminal-state entry (shared by listenerNotFound + roomClosed) ──
          // MUST tear down the audio machinery: on Android the anchor noise bed
          // and the WebAudio pipeline keep playing (holding audio focus) unless
          // stopStream() runs — the room being gone doesn't silence them.
          const enterTerminal = (reason: string, userMessage: string) => {
            console.info(`Recovery: ${reason} — entering terminal state`)
            terminal = true
            clearDebounceTimer()
            // Full audio teardown: stream element, anchor bed, AudioContext
            Effect.runPromise(
              audioClient.stopStream().pipe(Effect.provideService(AudioAdapter, audioAdapter))
            ).catch(() => {})
            // Stop WS reconnection permanently (deliberate-leave semantics)
            Effect.runPromise(userWebSocket.disconnect()).catch(() => {})
            // Surface a user-facing error before navigating
            connectionAdapter.setConnectionError(
              new WebSocketError({
                cause: userMessage,
                operation: WebSocketOperation.RECEIVE,
                timestamp: new Date()
              })
            )
            config.onTerminal()
          }

          // ── listenerNotFound → terminal ────────────────────────────────────
          // Subscribe before registering DOM listeners so we never miss the event.
          const unsubListenerNotFound = yield* userWebSocket.subscribe<ListenerNotFoundEvent>(
            'listenerNotFound',
            (_event) => enterTerminal('listenerNotFound received', 'Session expired — rejoin from the lobby')
          )

          // ── roomClosed → terminal ──────────────────────────────────────────
          // The backend notifies every listener BEFORE ejecting them when the
          // DJ closes the room; without this subscription the client only sees
          // the subsequent transport death and shows a raw WebRTC error.
          const unsubRoomClosed = yield* userWebSocket.subscribe<ListenerRoomClosedEvent>(
            'roomClosed',
            (_event) => enterTerminal('roomClosed received', 'The DJ closed the room')
          )

          // ── Full re-join (single-flight, ≥10 s spacing) ───────────────────
          const performFullRejoin = async () => {
            if (recoveryInFlight) return
            const now = Date.now()
            if (now - lastFullRejoinAt < 10_000) {
              console.info('Recovery: Full re-join throttled (< 10 s since last attempt)')
              return
            }

            recoveryInFlight = true
            lastFullRejoinAt = now
            try {
              // Tear down stale MediaSoup resources (also calls connectionAdapter.resetRoom())
              await Effect.runPromise(mediaSoupClient.cleanup())
              // Re-join with force=true to bypass isRoomConnected() short-circuit
              await Effect.runPromise(
                serviceImpl.joinRoomAsListener(
                  config.roomId,
                  config.sessionId,
                  config.meta,
                  { force: true }
                ).pipe(
                  Effect.provideService(UserAdapter, userAdapter),
                  Effect.provideService(UserWebSocket, userWebSocket),
                  Effect.provideService(MediaSoupClient, mediaSoupClient),
                  Effect.provideService(AudioClient, audioClient),
                  Effect.provideService(AudioAdapter, audioAdapter),
                  Effect.provideService(ConnectionAdapter, connectionAdapter)
                )
              )
              console.info('Recovery: Full re-join succeeded')
            } catch (error) {
              console.error('Recovery: Full re-join failed (not terminal — will retry on next trigger):', error)
              // Not terminal: allow future evaluate() runs
            } finally {
              recoveryInFlight = false
            }
          }

          // ── evaluate() — the binding trigger matrix ────────────────────────
          //
          // State matrix (wsAlive × transportDead):
          //   true  × false  → NO-OP   (healthy — never touch; the iOS lock-screen case)
          //   false × false  → WS reconnect only (no mediasoup teardown)
          //   true  × true   → Full re-join
          //   false × true   → WS reconnect, poll until open, then full re-join
          //
          // transportDead: state ∈ {failed, closed} immediately;
          //                'disconnected' only after 4 s continuous (debounced).
          const evaluate = async () => {
            if (terminal || recoveryInFlight) return
            if (config.canRecover && !config.canRecover()) return

            const wsAlive = userWebSocket.isSocketOpen()
            const transportOpt = mediaSoupClient.getCurrentTransport()

            let transportDead = false
            if (O.isSome(transportOpt)) {
              const state = transportOpt.value.connectionState
              if (state === 'failed' || state === 'closed') {
                transportDead = true
                disconnectedSince = null
                clearDebounceTimer()
              } else if (state === 'disconnected') {
                if (disconnectedSince === null) {
                  // First observation — arm 4.5 s one-shot re-check
                  disconnectedSince = Date.now()
                  disconnectedDebounceTimer = setTimeout(() => {
                    disconnectedDebounceTimer = null
                    void evaluate().catch(e => console.error('Recovery: evaluate error after debounce:', e))
                  }, 4500)
                  // Not yet dead — wait for re-check
                } else if (Date.now() - disconnectedSince >= 4000) {
                  transportDead = true
                }
                // else: < 4 s elapsed — transportDead stays false
              } else {
                // 'new' | 'connecting' | 'connected' — clear debounce
                disconnectedSince = null
                clearDebounceTimer()
              }
            } else {
              // No transport after initial join → treat as dead
              transportDead = true
              disconnectedSince = null
              clearDebounceTimer()
            }

            // Matrix dispatch
            if (wsAlive && !transportDead) {
              // NO-OP — both signals healthy; do NOT touch a working session
              console.info('Recovery evaluate: WS alive + transport healthy — NO-OP')
              return
            }

            if (!wsAlive && !transportDead) {
              // WS-only reconnect — no mediasoup teardown
              console.info('Recovery evaluate: WS dead, transport ok — WS reconnect only')
              await Effect.runPromise(userWebSocket.forceReconnectNow())
              return
            }

            if (wsAlive && transportDead) {
              console.info('Recovery evaluate: WS alive, transport dead — FULL RE-JOIN')
              await performFullRejoin()
              return
            }

            // !wsAlive && transportDead
            console.info('Recovery evaluate: WS dead + transport dead — reconnect then FULL RE-JOIN')
            await Effect.runPromise(userWebSocket.forceReconnectNow())
            // Poll up to 10 s for socket to open
            let waited = 0
            while (waited < 10_000) {
              await new Promise<void>(resolve => setTimeout(resolve, 1000))
              waited += 1000
              if (userWebSocket.isSocketOpen()) {
                await performFullRejoin()
                return
              }
            }
            console.warn('Recovery: WS did not reconnect in 10 s — will retry on next trigger')
          }

          // ── DOM event handlers ─────────────────────────────────────────────
          // Both visibilitychange AND pageshow registered — iOS fires them unevenly.
          // On visibility resume: kick notifyVisibilityResume() (immediate ping/reconnect),
          // then run evaluate().
          const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
              void Effect.runPromise(userWebSocket.notifyVisibilityResume()).catch(() => {})
              void evaluate().catch(e => console.error('Recovery: evaluate error on visibilitychange:', e))
            }
          }

          const onPageShow = (_e: Event) => {
            void Effect.runPromise(userWebSocket.notifyVisibilityResume()).catch(() => {})
            void evaluate().catch(e => console.error('Recovery: evaluate error on pageshow:', e))
          }

          const onOnline = () => {
            void evaluate().catch(e => console.error('Recovery: evaluate error on online:', e))
          }

          window.addEventListener('visibilitychange', onVisibilityChange)
          window.addEventListener('pageshow', onPageShow)
          window.addEventListener('online', onOnline)

          // ── Return cleanup function ────────────────────────────────────────
          return () => {
            // Setting terminal prevents any in-progress or future evaluate() from acting
            terminal = true
            clearDebounceTimer()
            window.removeEventListener('visibilitychange', onVisibilityChange)
            window.removeEventListener('pageshow', onPageShow)
            window.removeEventListener('online', onOnline)
            unsubListenerNotFound()
            unsubRoomClosed()
          }
        })
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
