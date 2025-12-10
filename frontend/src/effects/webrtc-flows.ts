import { Effect, pipe } from 'effect'
import { WebRTCService, WebRTCServiceLive } from '../services/webrtc-service'
import { createRoom, joinRoom } from '../effects/api'
import { createRootSpan } from '../telemetry'

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

/**
 * Request types for the flows
 */
export type CreateRoomRequest = {
  name: string
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
 * Create consumer using WebRTC service
 */
export const createConsumer = (
  consumerOptions: { id: string; producerId: string; kind: 'audio' | 'video'; rtpParameters: any }
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

  return pipe(
    Effect.gen(function* (_) {
      // ✅ Step 0: Validate required parameters
      if (!deviceId) {
        yield* _(Effect.fail(new PublishFlowError(
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
          Effect.andThen(service => service.setWebSocket(roomWebSocket)),
          Effect.mapError(error => new PublishFlowError('Failed to set WebSocket', 'setWebSocket', error))
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
          Effect.andThen(service => service.createSendTransport({
            id: roomResponse.transportOptions.id,
            dtlsParameters: roomResponse.transportOptions.dtlsParameters,
            iceParameters: roomResponse.transportOptions.iceParameters,
            iceCandidates: roomResponse.transportOptions.iceCandidates,
            sctpParameters: roomResponse.transportOptions.sctpParameters
          })),
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
    }),
    Effect.tap(() => {
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
    Effect.provide(WebRTCServiceLive)
  )
}

/**
 * Listener Join Room Flow - Connect to existing stream
 */
// webrtc-flows.ts - JOIN ROOM FLOW (Listener)
export const joinRoomFlow = (
  roomId: string,
  roomWebSocket: WebSocket
): Effect.Effect<
  { consumerId: string, audioElement: HTMLAudioElement },
  JoinFlowError
> =>
  pipe(
    Effect.gen(function* (_) {
      // ✅ Step 1: Join room using Effect API
      const joinResponse = yield* _(
        pipe(
          joinRoom(roomId),
          Effect.mapError(error => new JoinFlowError(
            error.message || 'Failed to join room',
            'joinRoom',
            error
          ))
        )
      )

      // ✅ Step 2: Set WebSocket connection on service
      yield* _(
        pipe(
          WebRTCService,
          Effect.andThen(service => service.setWebSocket(roomWebSocket)),
          Effect.mapError(error => new JoinFlowError('Failed to set WebSocket', 'setWebSocket', error))
        )
      )

      // ✅ Step 3: Initialize device
      yield* _(
        pipe(
          WebRTCService,
          Effect.andThen(service => service.initializeDevice(joinResponse.rtpCapabilities)),
          Effect.mapError(error => new JoinFlowError(error.message, 'initializeDevice', error))
        )
      )

      // ✅ Step 4: Set room ID and create receive transport
      yield* _(
        pipe(
          WebRTCService,
          Effect.andThen(service => service.setRoomId(roomId))
        )
      )

      yield* _(
        pipe(
          WebRTCService,
          Effect.andThen(service => service.createReceiveTransport({
            id: roomId,
            dtlsParameters: joinResponse.transportOptions.dtlsParameters,
            iceParameters: joinResponse.transportOptions.iceParameters,
            iceCandidates: joinResponse.transportOptions.iceCandidates,
            sctpParameters: joinResponse.transportOptions.sctpParameters
          })),
          Effect.mapError(error => new JoinFlowError(error.message, 'createReceiveTransport', error))
        )
      )

      // ✅ Step 5: Create consumer if producer exists
      if (!joinResponse.producerId) {
        yield* _(Effect.fail(new JoinFlowError('No producer available in room', 'checkProducer')))
      }

      const consumerId = yield* _(
        createConsumer({
          id: `consumer-${joinResponse.producerId || 'unknown'}-${Date.now()}`,
          producerId: joinResponse.producerId || 'unknown',
          kind: 'audio',
          rtpParameters: {} // Backend provides
        })
      )

      // ✅ Step 6: Create audio element
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
  producerId: string,
  pause: boolean
): Effect.Effect<void, PublishFlowError> =>
  pipe(
    Effect.logInfo(`${pause ? 'Pausing' : 'Resuming'} producer: ${producerId}`),
    Effect.andThen(() => 
      pipe(
        WebRTCService,
        Effect.andThen(service => 
          pause 
            ? service.pauseProducer(producerId)
            : service.resumeProducer(producerId)
        ),
        Effect.mapError(error => new PublishFlowError(
          error.message,
          'toggleProducer',
          error
        ))
      )
    ),
    Effect.tap(() => Effect.logInfo(`Producer ${pause ? 'paused' : 'resumed'} successfully`)),
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
