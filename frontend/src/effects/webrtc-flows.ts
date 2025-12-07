import { Effect, pipe } from 'effect'
import { deviceManager } from '../webrtc/device-manager'
import { transportManager } from '../webrtc/transport-manager'
import { producerManager } from '../webrtc/producer-manager'
import { consumerManager } from '../webrtc/consumer-manager'
// Note: Signaling is now handled by SignalingProvider context
import type { types } from 'mediasoup-client'

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
export const publishRoomFlow = (
  roomName: string,
  deviceId?: string
): Effect.Effect<{
  roomId: string
  producerId: string
  transport: types.Transport
  producer: types.Producer
}, PublishFlowError> =>
  pipe(
    Effect.void,
    Effect.tap(() => Effect.logInfo('Starting publish room flow')),
    
    // Step 1: Create room on backend
    Effect.andThen(() =>
      Effect.tryPromise({
        try: async () => {
          // This will be replaced with generated API call
          const response = await fetch('/api/rooms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: roomName }),
          })
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }
          
          return response.json() as Promise<CreateRoomResponse>
        },
        catch: (error) => new PublishFlowError(
          error instanceof Error ? error.message : String(error),
          'createRoom',
          error
        )
      })
    ),

    // Step 2: Initialize device with router capabilities
    Effect.andThen((roomResponse) =>
      pipe(
        deviceManager.initializeDevice({}), // Router capabilities from backend
        Effect.map((device) => ({ device, roomResponse })),
        Effect.mapError((error) => new PublishFlowError(
          error.message,
          'initializeDevice',
          error
        ))
      )
    ),

    // Step 3: Create send transport
    Effect.andThen(({ device, roomResponse }) =>
      pipe(
        transportManager.createSendTransport(device, {
          id: roomResponse.room_id + '_send',
          dtlsParameters: roomResponse.transport_options.dtlsParameters,
          iceParameters: roomResponse.transport_options.iceParameters,
          iceCandidates: roomResponse.transport_options.iceCandidates || [],
          sctpParameters: roomResponse.transport_options.sctpParameters,
        }),
        Effect.map((transport) => ({ device, roomResponse, transport })),
        Effect.mapError((error) => new PublishFlowError(
          error.message,
          'createTransport',
          error
        ))
      )
    ),

    // Step 4: Connect transport
    Effect.andThen(({ device, roomResponse, transport }) =>
      pipe(
        transportManager.connectTransport(transport, roomResponse.transport_options.dtlsParameters),
        Effect.map(() => ({ device, roomResponse, transport })),
        Effect.mapError((error) => new PublishFlowError(
          error.message,
          'connectTransport',
          error
        ))
      )
    ),

    // Step 5: Get user media
    Effect.andThen(({ device, roomResponse, transport }) =>
      pipe(
        getUserMedia(deviceId),
        Effect.map((track) => ({ device, roomResponse, transport, track }))
      )
    ),

    // Step 6: Signaling is now handled by SignalingProvider context
    // The provider should already be connected to the room WebSocket
    Effect.andThen(({ device, roomResponse, transport, track }) =>
      pipe(
        Effect.logInfo(`DJ room signaling handled by provider for room: ${roomResponse.room_id}`),
        Effect.andThen(() => ({ device, roomResponse, transport, track }))
      )
    ),

    // Step 7: Create producer (this makes the room public)
    Effect.andThen(({ roomResponse, transport, track }) =>
      pipe(
        createProducer(transport, track),
        Effect.map((producer) => ({
          roomId: roomResponse.room_id,
          producerId: producer.id,
          transport,
          producer,
        }))
      )
    ),

    Effect.tap(() => Effect.logInfo('Publish room flow completed successfully')),
    
    // Error handling with cleanup
    Effect.tapError((error) =>
      Effect.all([
        Effect.logError(`Publish flow failed at step ${error.step}: ${error.message}`),
        // TODO: Send AbortRoom command to backend for cleanup
      ])
    )
  )

/**
 * Listener Join Room Flow - Connect to existing stream
 */
export const joinRoomFlow = (
  roomId: string
): Effect.Effect<{
  consumer: types.Consumer
  transport: types.Transport
  audioElement: HTMLAudioElement
}, JoinFlowError> =>
  pipe(
    Effect.void,
    Effect.tap(() => Effect.logInfo(`Starting join room flow for room: ${roomId}`)),

    // Step 1: Join room on backend
    Effect.andThen(() => Effect.tryPromise({
      try: async () => {
        const response = await fetch(`/api/rooms/${roomId}/join`, {
          method: 'POST',
        })
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }
        
        return response.json() as Promise<JoinRoomResponse>
      },
      catch: (error) => new JoinFlowError(
        error instanceof Error ? error.message : String(error),
        'joinRoom',
        error
      )
    })),

    // Step 2: Initialize lobby signaling
    // Step 2: Signaling is now handled by SignalingProvider context
    // The provider should already be connected for listening
    Effect.andThen((joinResponse) =>
      pipe(
        Effect.logInfo('Listener signaling handled by SignalingProvider'),
        Effect.andThen(() => joinResponse)
      )
    ),

    // Step 3: Initialize device with server capabilities
    Effect.andThen((joinResponse) =>
      pipe(
        deviceManager.initializeDevice(joinResponse.rtp_capabilities),
        Effect.map((device) => ({ device, joinResponse })),
        Effect.mapError((error) => new JoinFlowError(
          error.message,
          'initializeDevice',
          error
        ))
      )
    ),

    // Step 4: Create receive transport
    Effect.andThen(({ device, joinResponse }) =>
      pipe(
        transportManager.createReceiveTransport(device, {
          id: roomId + '_receive',
          dtlsParameters: joinResponse.transport_options.dtlsParameters,
          iceParameters: joinResponse.transport_options.iceParameters,
          iceCandidates: joinResponse.transport_options.iceCandidates || [],
          sctpParameters: joinResponse.transport_options.sctpParameters,
        }),
        Effect.map((transport) => ({ device, joinResponse, transport })),
        Effect.mapError((error) => new JoinFlowError(
          error.message,
          'createTransport',
          error
        ))
      )
    ),

    // Step 5: Connect transport
    Effect.andThen(({ device, joinResponse, transport }) =>
      pipe(
        transportManager.connectTransport(transport, joinResponse.transport_options.dtlsParameters),
        Effect.map(() => ({ device, joinResponse, transport })),
        Effect.mapError((error) => new JoinFlowError(
          error.message,
          'connectTransport',
          error
        ))
      )
    ),

    // Step 6: Create consumer (if producer exists)
    Effect.andThen(({ joinResponse, transport }) => {
      if (!joinResponse.producer_id) {
        return Effect.fail(new JoinFlowError(
          'No producer available in room',
          'checkProducer'
        ))
      }

      return pipe(
        createConsumer(transport, {
          id: joinResponse.producer_id + '_consumer',
          producerId: joinResponse.producer_id,
          kind: 'audio',
          rtpParameters: {}, // Will be provided by backend
        }),
        Effect.map((consumer) => ({ transport, consumer })),
        Effect.mapError((error) => new JoinFlowError(
          error.message,
          'createConsumer',
          error
        ))
      )
    }),

    // Step 7: Create audio element and play
    Effect.andThen(({ transport, consumer }) =>
      pipe(
        consumerManager.createAudioElement(consumer.id, true),
        Effect.map((audioElement) => ({ consumer, transport, audioElement })),
        Effect.mapError((error) => new JoinFlowError(
          error.message,
          'createAudioElement',
          error
        )),
        Effect.tap(() => Effect.logInfo('Audio element created and configured'))
      )
    ),

    Effect.tap(() => Effect.logInfo('Join room flow completed successfully')),
    
    // Error handling
    Effect.tapError((error) =>
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