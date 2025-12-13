import { Effect, pipe, Option } from 'effect'
import { WebRTCService, WebRTCServiceLive } from '../services/webrtc-service'
import { createRoom } from '../effects/api'
import { createRootSpan } from '../telemetry'
import type { ConsumerParameters as ApiConsumerParameters } from '../generated/api.schemas'


/**
 * Flow-specific error types
 */
export class PublishFlowError extends Error {
  constructor(message: string, public step: string, public cause?: unknown) {
    super(message)
    this.name = 'PublishFlowError'
  }
}

export class JoinFlowError extends Error {
  constructor(message: string, public step: string, public cause?: unknown) {
    super(message)
    this.name = 'JoinFlowError'
  }
}

// Simple request types for flows
export type CreateRoomRequest = {
  name: string
  description?: string
  tags?: string[]
  djName: string
}

export type JoinRoomRequest = {
  roomId: string
}

/**
 * Get user media using WebRTC service
 */
export const getUserMedia = (deviceId?: string): Effect.Effect<MediaStreamTrack, PublishFlowError> =>
  pipe(
    WebRTCService,
    Effect.andThen(service => {
      const constraints: MediaStreamConstraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        video: false
      }
      return service.getUserMedia(constraints)
    }),
    Effect.mapError(error => new PublishFlowError(
      error.message,
      'getUserMedia',
      error
    )),
    Effect.tap(() => Effect.logInfo('Successfully obtained user media')),
    Effect.provide(WebRTCServiceLive)
  )

/**
 * Create producer using WebRTC service
 */
export const createProducer = (
  track: MediaStreamTrack
): Effect.Effect<string, PublishFlowError> =>
  pipe(
    WebRTCService,
    Effect.andThen(service => service.produce(track)),
    Effect.mapError(error => new PublishFlowError(
      error.message,
      'createProducer',
      error
    )),
    Effect.tap((producerId) => Effect.logInfo(`Created producer: ${producerId}`)),
    Effect.provide(WebRTCServiceLive)
  )

/**
 * Create consumer using WebRTC service (service handles type conversion)
 */
export const createConsumer = (
  consumerOptions: ApiConsumerParameters
): Effect.Effect<string, JoinFlowError> =>
  pipe(
    WebRTCService,
    Effect.andThen(service => service.consume(consumerOptions)),
    Effect.mapError(error => new JoinFlowError(
      error.message,
      'createConsumer',
      error
    )),
    Effect.tap((consumerId) => Effect.logInfo(`Created consumer: ${consumerId}`)),
    Effect.provide(WebRTCServiceLive)
  )

/**
 * DJ Publish Room Flow - Atomic room creation and streaming setup
 */
// webrtc-flows.ts - PUBLISH ROOM FLOW (DJ)
export const publishRoomFlow = (
  roomName: string,
  roomWebSocket: WebSocket,
  deviceId: string
): Effect.Effect<
  { roomId: string, producerId: string },
  PublishFlowError
> => {
  // Create root span for the entire publish flow
  const rootSpan = createRootSpan('publish_room_flow', {
    'room.name': roomName,
    'user.role': 'dj',
    'audio.device_id': deviceId
  })

  return Effect.gen(function* (_) {
      // ✅ Step 0: Validate required parameters
      if (!deviceId) {
          return yield* _(Effect.fail(new PublishFlowError(
              'Device ID is required for publishing',
              'validateInput'
          )))
      }
      // ✅ Step 1: Create room using Effect API
      const roomResponse = yield* _(
          pipe(
              createRoom({
                  name: roomName,
                  djName: `DJ ${Date.now()}`
              }),
              Effect.mapError(error => new PublishFlowError(
                  error.message || 'Failed to create room',
                  'createRoom',
                  error
              ))
          )
      )

      // ✅ Step 2: Set WebSocket connection on service
      yield* _(
          pipe(
              WebRTCService,
              Effect.andThen(service => service.setDjWebSocket(roomWebSocket)),
              Effect.mapError(error => new PublishFlowError('Failed to set DJ WebSocket', 'setDjWebSocket', error))
          )
      )

      // ✅ Step 3: Initialize device with router RTP capabilities
      yield* _(
          pipe(
              WebRTCService,
              Effect.andThen(service => service.initializeDevice(roomResponse.rtpCapabilities)),
              Effect.mapError(error => new PublishFlowError(error.message, 'initializeDevice', error))
          )
      )

      // ✅ Step 4: Set room ID and create send transport
      yield* _(
          pipe(
              WebRTCService,
              Effect.andThen(service => service.setRoomId(roomResponse.room.id))
          )
      )

      yield* _(
          pipe(
              WebRTCService,
              Effect.andThen(service => service.createSendTransport(
                roomResponse.transportOptions
              )),
              Effect.mapError(error => new PublishFlowError(error.message, 'createSendTransport', error))
          )
      )

      // ✅ Step 5: Get user media
      const track = yield* _(
          getUserMedia(deviceId)
      )

      // ✅ Step 6: Create producer (this will trigger transport connect event)
      const producerId = yield* _(
          createProducer(track)
      )

      return {
          roomId: roomResponse.room.id,
          producerId
      }
  }).pipe(Effect.tap(() => {
      rootSpan.setStatus()
      rootSpan.end()
      return Effect.logInfo('Publish room flow completed successfully')
  }),
      Effect.tapError(error => {
          // Cleanup on error handled by service
          rootSpan.recordException()
          rootSpan.setStatus()
          rootSpan.end()
          return Effect.logError(`Publish flow failed at step ${error.step}: ${error.message}`)
      }),
      Effect.provide(WebRTCServiceLive))
}

/**
 * Listener Join Room Flow - Connect to existing stream via WebSocket
 * Uses WebSocket for real-time signaling instead of REST API
 */
export const joinRoomFlow = (
  roomId: string,
  listenerWebSocket: WebSocket
): Effect.Effect<
  { consumerId: string, audioElement: HTMLAudioElement },
  JoinFlowError
> =>
  pipe(
    Effect.gen(function* (_) {
      // ✅ Step 1: Set WebSocket connection on service
      yield* _(
        pipe(
          WebRTCService,
          Effect.andThen(service => service.setListenerWebSocket(listenerWebSocket)),
          Effect.mapError(error => new JoinFlowError('Failed to set Listener WebSocket', 'setListenerWebSocket', error))
        )
      )

      // ✅ Step 2: Get router RTP capabilities from backend
      const routerRtpCapabilities = yield* _(
        pipe(
          WebRTCService,
          Effect.andThen(service => service.getRouterCapabilities(roomId)),
          Effect.mapError(error => new JoinFlowError('Failed to get router capabilities', 'getRouterCapabilities', error))
        )
      )

      // ✅ Step 3: Initialize device with router RTP capabilities
      yield* _(
        pipe(
          WebRTCService,
          Effect.andThen(service => service.initializeDevice(routerRtpCapabilities)),
          Effect.mapError(error => new JoinFlowError(error.message, 'initializeDevice', error))
        )
      )

      // ✅ Step 4: Set room ID and get device RTP capabilities (now properly initialized)
      yield* _(
        pipe(
          WebRTCService,
          Effect.andThen(service => service.setRoomId(roomId))
        )
      )

      const deviceRtpCapabilities = yield* _(
        pipe(
          WebRTCService,
          Effect.andThen(service => service.getRtpCapabilities()),
          Effect.andThen(capabilities =>
            Option.match(capabilities, {
              onNone: () => Effect.fail(new JoinFlowError('Device RTP capabilities not available', 'getDeviceCapabilities')),
              onSome: (caps) => Effect.succeed(caps)
            })
          )
        )
      )

      // ✅ Step 5: Send requestJoin WebSocket message
      yield* _(
        pipe(
          WebRTCService,
          Effect.andThen(service => service.sendWebSocketMessage({
            type: 'requestJoin',
            roomId: roomId,
            rtpCapabilities: deviceRtpCapabilities,
            _traceContext: { traceparent: 'dummy', tracestate: null, metadata: null }
          })),
          Effect.mapError(error => new JoinFlowError('Failed to send requestJoin', 'sendRequestJoin', error))
        )
      )

      // ✅ Step 6: Wait for joinReady response (handled by WebSocket service)
      // The service will handle the joinReady message and create the receive transport
      const joinReadyData = yield* _(
        pipe(
          WebRTCService,
          Effect.andThen(service => service.waitForJoinReady(roomId)),
          Effect.mapError(error => new JoinFlowError('Failed to receive joinReady', 'waitForJoinReady', error))
        )
      )

      // ✅ Step 7: Create receive transport with received transport options
      yield* _(
        pipe(
          WebRTCService,
          Effect.andThen(service => service.createReceiveTransport(joinReadyData.transportOptions)),
          Effect.mapError(error => new JoinFlowError(error.message, 'createReceiveTransport', error))
        )
      )

      // ✅ Step 8: Transport connection handled automatically by transport 'connect' event
      // When consumer is created, MediaSoup triggers transport's 'connect' event
      // which sends DTLS parameters to backend via connectListenerTransport command

      // ✅ Step 9: Create consumer with the producer ID from joinReady
      const consumerId = yield* _(
        pipe(
          WebRTCService,
          Effect.andThen(service => service.createConsumerFromProducer(joinReadyData.producerId)),
          Effect.mapError(error => new JoinFlowError(error.message, 'createConsumer', error))
        )
      )

      // ✅ Step 10: Create audio element
      const audioElement = yield* _(
        pipe(
          WebRTCService,
          Effect.andThen(service => service.createAudioElement(consumerId)),
          Effect.mapError(error => new JoinFlowError(error.message, 'createAudioElement', error))
        )
      )

      return { consumerId, audioElement }
    }),
    Effect.tap(() => Effect.logInfo('Join room flow completed successfully')),
    Effect.tapError(error => {
      // Cleanup on error handled by service
      return Effect.logError(`Join flow failed at step ${error.step}: ${error.message}`)
    }),
    Effect.provide(WebRTCServiceLive)
  )

/**
 * Pause/Resume producer flow using WebRTC service
 */
export const toggleProducerFlow = (
  pause: boolean
): Effect.Effect<void, PublishFlowError> =>
  pipe(
    Effect.logInfo(`${pause ? 'Pausing' : 'Resuming'} stream`),
    Effect.andThen(() =>
      pipe(
        WebRTCService,
        Effect.andThen(service =>
          pause
            ? service.pauseStream()
            : service.resumeStream()
        ),
        Effect.mapError(error => new PublishFlowError(
          error.message,
          'toggleProducer',
          error
        ))
      )
    ),
    Effect.tap(() => Effect.logInfo(`Stream ${pause ? 'paused' : 'resumed'} successfully`)),
    Effect.provide(WebRTCServiceLive)
  )

/**
 * Clean up resources when leaving room using WebRTC service
 */
export const leaveRoomFlow = (): Effect.Effect<void, never> =>
  pipe(
    Effect.logInfo('Starting leave room flow'),
    Effect.andThen(() =>
      pipe(
        WebRTCService,
        Effect.andThen(service => service.cleanup()),
        Effect.catchAll(() => Effect.void) // Never fail
      )
    ),
    Effect.tap(() => Effect.logInfo('Leave room flow completed')),
    Effect.provide(WebRTCServiceLive)
  )
