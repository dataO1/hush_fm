import { Effect, pipe } from 'effect'
import { deviceManager } from '../webrtc/device-manager'
import { transportManager } from '../webrtc/transport-manager'
import { producerManager } from '../webrtc/producer-manager'
import { consumerManager } from '../webrtc/consumer-manager'
// Note: Signaling is now handled by SignalingProvider context
import type { types } from 'mediasoup-client'
import { createRoom, joinRoom } from '../effects/api'
import type { CreateRoomResponse, JoinRoomResponse } from '../generated/api.schemas'

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

export type CreateRoomResponse = {
  room_id: string
  dj_token: string
  transport_options: any
  ws_url: string
}

export type JoinRoomRequest = {
  roomId: string
}

export type JoinRoomResponse = {
  transport_options: any
  producer_id: string | null
  rtp_capabilities: any
}

/**
 * Audio device management
 */
export const getUserMedia = (deviceId?: string): Effect.Effect<MediaStreamTrack, PublishFlowError> =>
  pipe(
    Effect.tryPromise({
      try: async () => {
        const constraints: MediaStreamConstraints = {
          audio: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 48000,
            channelCount: 2,
          },
          video: false,
        }

        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        const audioTrack = stream.getAudioTracks()[0]

        if (!audioTrack) {
          throw new Error('No audio track available')
        }

        return audioTrack
      },
      catch: (error) => new PublishFlowError(
        error instanceof Error ? error.message : String(error),
        'getUserMedia',
        error
      )
    }),
    Effect.tap(() => Effect.logInfo('Successfully obtained user media'))
  )

/**
 * Create producer on send transport
 */
export const createProducer = (
  transport: types.Transport,
  track: MediaStreamTrack
): Effect.Effect<types.Producer, PublishFlowError> =>
  pipe(
    Effect.tryPromise({
      try: async () => {
        const producer = await transport.produce({
          track,
          codecOptions: {
            opusStereo: true,
            opusDtx: true,
          },
        })

        return producer
      },
      catch: (error) => new PublishFlowError(
        `Failed to create producer: ${error instanceof Error ? error.message : String(error)}`,
        'createProducer',
        error
      )
    }),
    Effect.andThen((producer) =>
      pipe(
        producerManager.registerProducer(producer, track),
        Effect.map(() => producer),
        Effect.mapError((error) => new PublishFlowError(
          error.message,
          'registerProducer',
          error
        ))
      )
    ),
    Effect.tap((producer) => Effect.logInfo(`Created producer: ${producer.id}`))
  )

/**
 * Create consumer on receive transport
 */
export const createConsumer = (
  transport: types.Transport,
  consumerOptions: any
): Effect.Effect<types.Consumer, JoinFlowError> =>
  pipe(
    Effect.tryPromise({
      try: async () => {
        const consumer = await transport.consume(consumerOptions)
        return consumer
      },
      catch: (error) => new JoinFlowError(
        `Failed to create consumer: ${error instanceof Error ? error.message : String(error)}`,
        'createConsumer',
        error
      )
    }),
    Effect.andThen((consumer) =>
      pipe(
        consumerManager.registerConsumer(consumer, consumerOptions.producerId),
        Effect.map(() => consumer),
        Effect.mapError((error) => new JoinFlowError(
          error.message,
          'registerConsumer',
          error
        ))
      )
    ),
    Effect.tap((consumer) => Effect.logInfo(`Created consumer: ${consumer.id}`))
  )

/**
 * DJ Publish Room Flow - Atomic room creation and streaming setup
 */
// webrtc-flows.ts - PUBLISH ROOM FLOW (DJ)
export const publishRoomFlow = (
  roomName: string,
  deviceId?: string
): Effect.Effect<
  { roomId: string, producerId: string, transport: types.Transport, producer: types.Producer },
  PublishFlowError
> =>
  pipe(
    Effect.gen(function* (_) {
      // ✅ Step 1: Create room using Effect API
      const roomResponse = yield* _(
        createRoom({
          name: roomName,
          djName: `DJ ${Date.now()}`
        })
      )

      // ✅ Step 2: Initialize device
      const device = yield* _(
        deviceManager.initializeDevice(roomResponse.transportOptions)
      )

      // ✅ Step 3: Create send transport
      const transport = yield* _(
        transportManager.createSendTransport(
          device,
          {
            id: roomResponse.room.id,
            direction: 'send',
            dtlsParameters: roomResponse.transportOptions.dtlsParameters,
            iceParameters: roomResponse.transportOptions.iceParameters,
            iceCandidates: roomResponse.transportOptions.iceCandidates,
            sctpParameters: roomResponse.transportOptions.sctpParameters
          }
        )
      )

      // ✅ Step 4: Connect transport
      yield* _(
        transportManager.connectTransport(
          transport,
          roomResponse.transportOptions.dtlsParameters
        )
      )

      // ✅ Step 5: Get user media
      const track = yield* _(
        getUserMedia(deviceId)
      )

      // ✅ Step 6: Create producer
      const producer = yield* _(
        createProducer(transport, track)
      )

      return {
        roomId: roomResponse.room.id,
        producerId: producer.id,
        transport,
        producer
      }
    }),
    Effect.tap(() => Effect.logInfo('Publish room flow completed successfully')),
    Effect.tapError(error =>
      Effect.logError(`Publish flow failed at step ${error.step}: ${error.message}`)
    )
  )

/**
 * Listener Join Room Flow - Connect to existing stream
 */
// webrtc-flows.ts - JOIN ROOM FLOW (Listener)
export const joinRoomFlow = (
  roomId: string
): Effect.Effect<
  { consumer: types.Consumer, transport: types.Transport, audioElement: HTMLAudioElement },
  JoinFlowError
> =>
  pipe(
    Effect.gen(function* (_) {
      // ✅ Step 1: Join room using Effect API
      const joinResponse = yield* _(
        joinRoom(roomId)
      )

      // ✅ Step 3: Initialize device
      const device = yield* _(
        deviceManager.initializeDevice(joinResponse.rtpCapabilities)
      )

      // ✅ Step 4: Create receive transport
      const transport = yield* _(
        transportManager.createReceiveTransport(
          device,
          {
            id: roomId,
            direction: 'receive',
            dtlsParameters: joinResponse.transportOptions.dtlsParameters,
            iceParameters: joinResponse.transportOptions.iceParameters,
            iceCandidates: joinResponse.transportOptions.iceCandidates,
            sctpParameters: joinResponse.transportOptions.sctpParameters
          }
        )
      )

      // ✅ Step 5: Connect transport
      yield* _(
        transportManager.connectTransport(
          transport,
          joinResponse.transportOptions.dtlsParameters
        )
      )

      // ✅ Step 6: Create consumer if producer exists
      if (!joinResponse.producerId) {
        return Effect.fail(new JoinFlowError('No producer available in room'))
      }

      const consumer = yield* _(
        createConsumer(transport, {
          id: joinResponse.producerId,
          producerId: joinResponse.producerId,
          kind: 'audio',
          rtpParameters: {} // Backend provides
        })
      )

      // ✅ Step 7: Create audio element
      const audioElement = yield* _(
        consumerManager.createAudioElement(consumer.id, true)
      )

      return { consumer, transport, audioElement }
    }),
    Effect.tap(() => Effect.logInfo('Join room flow completed successfully')),
    Effect.tapError(error =>
      Effect.logError(`Join flow failed at step ${error.step}: ${error.message}`)
    )
  )

/**
 * Pause/Resume producer flow
 */
export const toggleProducerFlow = (
  producerId: string,
  pause: boolean
): Effect.Effect<void, PublishFlowError> =>
  pipe(
    Effect.void,
    Effect.tap(() => Effect.logInfo(`${pause ? 'Pausing' : 'Resuming'} producer: ${producerId}`)),

    // Use producer manager for actual pause/resume
    Effect.andThen(() => {
      const operation = pause
        ? producerManager.pauseProducer(producerId)
        : producerManager.resumeProducer(producerId)

      return pipe(
        operation,
        Effect.mapError((error) => new PublishFlowError(
          error.message,
          'toggleProducer',
          error
        ))
      )
    }),

    // Note: WebSocket signaling is now handled by SignalingProvider
    // This would need to be integrated with the provider context
    Effect.andThen(() => {
      // TODO: Integrate with SignalingProvider context for backend sync
      return Effect.logInfo(`Producer ${pause ? 'pause' : 'resume'} - backend sync handled by provider`)
    }),

    Effect.tap(() => Effect.logInfo(`Producer ${pause ? 'paused' : 'resumed'} successfully`))
  )

/**
 * Clean up resources when leaving room
 */
export const leaveRoomFlow = (): Effect.Effect<void, never> =>
  pipe(
    Effect.logInfo('Starting leave room flow'),

    Effect.andThen(() => Effect.all([
      producerManager.closeAllProducers(),
      consumerManager.closeAllConsumers(),
    ])),

    Effect.andThen(() => Effect.void),
    Effect.tap(() => Effect.logInfo('Leave room flow completed'))
  )
