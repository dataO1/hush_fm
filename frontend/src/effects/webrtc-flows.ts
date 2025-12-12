import { Effect, pipe, Option } from 'effect'
import { WebRTCService, WebRTCServiceLive } from '../services/webrtc-service'
import { createRoom, getRoomInfo, joinRoom } from '../effects/api'
import { createRootSpan } from '../telemetry'
import type { TransportOptions as ApiTransportOptions } from '../generated/api.schemas'
import type { TransportOptions } from '../services/webrtc-service'

/**
 * Convert API transport options to internal transport options (MediaSoup format)
 */
function convertApiTransportOptions(apiOptions: ApiTransportOptions): TransportOptions {
  return {
    id: apiOptions.id,
    dtlsParameters: apiOptions.dtlsParameters as any,  // MediaSoup will handle the format
    iceParameters: apiOptions.iceParameters as any,    // MediaSoup will handle the format
    iceCandidates: apiOptions.iceCandidates as any,    // MediaSoup will handle the format
    sctpParameters: apiOptions.sctpParameters as any   // MediaSoup will handle the format
  }
}

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
              Effect.andThen(service => service.createSendTransport(
                convertApiTransportOptions(roomResponse.transportOptions)
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
      // ✅ Step 1: Get room info and router RTP capabilities
      const roomInfo = yield* _(
        pipe(
          getRoomInfo(roomId),
          Effect.mapError(error => new JoinFlowError(
            error.message || 'Failed to get room info',
            'getRoomInfo',
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

      // ✅ Step 3: Initialize device with router RTP capabilities
      yield* _(
        pipe(
          WebRTCService,
          Effect.andThen(service => service.initializeDevice(roomInfo.rtpCapabilities)),
          Effect.mapError(error => new JoinFlowError(error.message, 'initializeDevice', error))
        )
      )

      // ✅ Step 4: Get device RTP capabilities
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

      // ✅ Step 5: Join room with device RTP capabilities
      const joinResponse = yield* _(
        pipe(
          joinRoom(roomId, { rtpCapabilities: deviceRtpCapabilities }),
          Effect.mapError(error => new JoinFlowError(
            error.message || 'Failed to join room',
            'joinRoom',
            error
          ))
        )
      )

      // ✅ Step 6: Set room ID and create receive transport
      yield* _(
        pipe(
          WebRTCService,
          Effect.andThen(service => service.setRoomId(roomId))
        )
      )

      yield* _(
        pipe(
          WebRTCService,
          Effect.andThen(service => service.createReceiveTransport(
            convertApiTransportOptions(joinResponse.transportOptions)
          )),
          Effect.mapError(error => new JoinFlowError(error.message, 'createReceiveTransport', error))
        )
      )

      // ✅ Step 7: Create consumer if producer exists and backend provided consumer parameters
      if (!joinResponse.producerId) {
        return yield* _(Effect.fail(new JoinFlowError('No producer available in room', 'checkProducer')))
      }

      if (!joinResponse.consumerParameters) {
        return yield* _(Effect.fail(new JoinFlowError('Consumer parameters not available from backend', 'checkConsumerParameters')))
      }

      const consumerId = yield* _(
        createConsumer({
          id: joinResponse.consumerParameters!.id,
          producerId: joinResponse.consumerParameters!.producerId,
          kind: joinResponse.consumerParameters!.kind as 'audio' | 'video',
          rtpParameters: joinResponse.consumerParameters!.rtpParameters
        })
      )

      // ✅ Step 8: Create audio element
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
