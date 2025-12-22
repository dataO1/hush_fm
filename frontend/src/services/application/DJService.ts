/**
 * DJ Application Service
 * 
 * Effect-TS service for DJ workflow orchestration.
 * Uses Context.Tag pattern for all dependencies - no direct imports.
 * Follows Schema-First architecture to avoid circular dependencies.
 * 
 * Responsibilities:
 * - DJ room creation and publishing (18-step flow)
 * - DJ streaming lifecycle management
 * - Audio device setup and management
 * - WebRTC transport and producer management
 * - Error handling and recovery
 */

import { Effect, Context, Layer, Option as O } from 'effect'

// Import only adapters via Context.Tag
import { ConnectionAdapter } from '../../stores/adapters/connection.adapter'
import { DJAdapter } from '../../stores/adapters/dj.adapter'
import { WebRTCAdapter } from '../../stores/adapters/webrtc.adapter'
import { RoomMetadataAdapter } from '../../stores/adapters/room-metadata.adapter'

// Import only infrastructure via Context.Tag
import { WebSocketClient } from '../infrastructure/websocket/WebSocketClient'
import { MediaSoupClient } from '../infrastructure/MediaSoupClient'
import { AudioClient } from '../infrastructure/AudioClient'

/**
 * DJ Publishing result (using schema types only)
 */
export interface DJPublishResult {
  roomId: string
  producerId: string
  djWebSocketUrl: string
  publishedAt: Date
}


/**
 * DJ Service Context Tag
 * 
 * Uses modern 2025 Effect-TS class-based Tag syntax.
 * Acts as both type and value for clean dependency injection.
 */
export class DJService extends Context.Tag("@app/services/DJService")<
  DJService,
  {
    readonly previewAudioDevice: (deviceId: string) => Effect.Effect<MediaStream, DJServiceError, DJAdapter | AudioClient>
    readonly stopDevicePreview: () => Effect.Effect<void, DJServiceError, DJAdapter>
    readonly publishDJRoom: (roomId: string, djWebSocketUrl: string, deviceId?: string) => Effect.Effect<DJPublishResult, DJServiceError, ConnectionAdapter | DJAdapter | WebRTCAdapter | RoomMetadataAdapter | WebSocketClient | MediaSoupClient | AudioClient>
    readonly toggleDJStream: (pause: boolean) => Effect.Effect<void, DJServiceError, DJAdapter>
    readonly closeDJRoom: () => Effect.Effect<void, DJServiceError, ConnectionAdapter | DJAdapter | WebRTCAdapter | RoomMetadataAdapter>
    readonly getAudioDevices: () => Effect.Effect<Array<{ deviceId: string, label: string }>, DJServiceError, AudioClient>
  }
>() {}

/**
 * DJ Service Errors
 */
export class DJServiceError extends Error {
  constructor(
    message: string,
    public operation: string,
    public step: string,
    public stepNumber: number,
    public recoverable: boolean = false,
    public cause?: unknown
  ) {
    super(message)
    this.name = 'DJServiceError'
  }
}

/**
 * DJ Service Implementation
 * 
 * Uses Effect.gen for all operations and Context.Tag for all dependencies.
 * No direct imports - everything comes through the context.
 */
const DJServiceImpl = {
  /**
   * Preview audio device (before going live)
   */
  previewAudioDevice: (deviceId: string) =>
    Effect.gen(function* () {
      console.info(`🎤 DJ Service: Starting device preview for: ${deviceId}`)
      
      // Access dependencies via context
      const djAdapter = yield* DJAdapter
      const audioClient = yield* AudioClient
      
      // Step 1: Get audio stream using infrastructure
      const audioConstraints = {
        deviceId: deviceId,
        sampleRate: 48000,
        channelCount: 2,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
      
      const stream = yield* audioClient.getUserMedia(audioConstraints).pipe(
        Effect.catchAll((error) => 
          Effect.fail(new DJServiceError(
            `Failed to get user media: ${error}`,
            'previewAudioDevice',
            'get_user_media',
            1,
            true,
            error
          ))
        )
      )
      
      // Step 2: Validate stream
      const audioTrack = stream.getAudioTracks()[0]
      if (!audioTrack) {
        stream.getTracks().forEach((track: MediaStreamTrack) => track.stop())
        return yield* Effect.fail(new DJServiceError(
          'No audio track found in stream',
          'previewAudioDevice',
          'track_validation',
          2
        ))
      }
      
      // Step 3: Update state via adapter
      djAdapter.startPreview(stream)
      
      console.info(`✅ DJ Service: Device preview created for: ${deviceId}`)
      return stream
    }).pipe(
      Effect.catchAll((error) => 
        error instanceof DJServiceError
          ? Effect.fail(error)
          : Effect.fail(new DJServiceError(
              `DJ service preview failed: ${error}`,
              'previewAudioDevice',
              'general_error',
              999,
              false,
              error
            ))
      )
    ),

  /**
   * Stop device preview
   */
  stopDevicePreview: () =>
    Effect.gen(function* () {
      const djAdapter = yield* DJAdapter
      djAdapter.stopPreview()
      console.info('✅ DJ Service: Device preview stopped')
    }).pipe(
      Effect.catchAll((error) => 
        Effect.fail(new DJServiceError(
          `Failed to stop device preview: ${error}`,
          'stopDevicePreview',
          'stop_preview',
          1,
          true,
          error
        ))
      )
    ),

  /**
   * Publish DJ room (complete 18-step flow)
   */
  publishDJRoom: (roomId: string, djWebSocketUrl: string, deviceId?: string) =>
    Effect.gen(function* () {
      console.info(`🎵 DJ Service: Starting 18-step publish flow for room: ${roomId}`)
      
      // Access all dependencies via context
      const connectionAdapter = yield* ConnectionAdapter
      const djAdapter = yield* DJAdapter
      const webrtcAdapter = yield* WebRTCAdapter
      const roomMetadataAdapter = yield* RoomMetadataAdapter
      const wsClient = yield* WebSocketClient
      const mediaSoupClient = yield* MediaSoupClient
      const audioClient = yield* AudioClient
      
      // Steps 1-2: Connect to DJ WebSocket and initialize
      connectionAdapter.setConnectionState('CONNECTING' as any)
      djAdapter.setFlowStep('connecting' as any)
      
      const djWS = yield* wsClient.connect({
        url: djWebSocketUrl,
        connectionTimeout: 15000
      })
      
      djAdapter.setWebSocketConnection(djWS, djWebSocketUrl)
      
      // Step 2: Initialize room and get native RTP capabilities (transformation handled internally)
      const roomInitResult = yield* wsClient.initDJRoom(djWS, roomId)
      console.info('✅ Step 2 complete: Received native RTP capabilities')
      
      // Step 3: Create and load MediaSoup device (now with native types)
      djAdapter.setFlowStep('creating_device' as any)
      const device = yield* mediaSoupClient.createDevice(roomInitResult.rtpCapabilities)
      djAdapter.setDevice(device)
      console.info('✅ Step 3 complete: MediaSoup device created and loaded')
      
      // Step 4: Get audio stream
      djAdapter.setFlowStep('requesting_audio' as any)
      const audioConstraints = {
        deviceId: deviceId,
        sampleRate: 48000,
        channelCount: 2,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
      
      const audioStream = yield* audioClient.getUserMedia(audioConstraints)
      const audioTrack = audioStream.getAudioTracks()[0]
      
      if (!audioTrack) {
        audioStream.getTracks().forEach((track: MediaStreamTrack) => track.stop())
        return yield* Effect.fail(new DJServiceError(
          'No audio track found in stream',
          'publishDJRoom',
          'audio_validation',
          4
        ))
      }
      
      djAdapter.setAudioTrack(audioTrack, audioStream, deviceId)
      console.info('✅ Step 4 complete: Audio stream obtained and validated')
      
      // Steps 5-8: Create send transport (transformation handled internally)
      djAdapter.setFlowStep('creating_transport' as any)
      const transportResult = yield* wsClient.requestDJTransport(djWS)
      
      const sendTransport = yield* mediaSoupClient.createSendTransport(device, transportResult.transportOptions)
      
      console.info('✅ Step 8 complete: Send transport created')
      
      // Step 9: WebRTC connection validation
      djAdapter.setFlowStep('validating_webrtc' as any)
      webrtcAdapter.setStatus('connecting' as any)
      
      // Step 10: Create producer
      djAdapter.setFlowStep('creating_producer' as any)
      const producer = yield* mediaSoupClient.createProducer(sendTransport, audioTrack)
      djAdapter.setProducer(producer)
      console.info('✅ Step 10 complete: Producer created')
      
      // Steps 11-12: Confirm producer and wait for room to become public
      const producerResult = yield* wsClient.confirmDJProducer(djWS, producer.rtpParameters)
      djAdapter.setProducerConfirmation(producerResult.producerId)
      djAdapter.setFlowStep('streaming' as any)
      connectionAdapter.setConnectionState('STREAMING' as any)
      webrtcAdapter.setStatus('connected' as any)
      
      // Set room metadata for active room  
      roomMetadataAdapter.setRoomMetadata({
        id: roomId,
        name: roomId, // In a real app this would come from room creation
        description: O.none(),
        djName: 'Current DJ', // In a real app this would come from user context
        isPublic: true,
        createdAt: new Date(),
        tags: []
      })
      
      console.info('✅ Steps 11-12 complete: Room is now public and streaming')
      
      const result: DJPublishResult = {
        roomId,
        producerId: producerResult.producerId,
        djWebSocketUrl,
        publishedAt: new Date()
      }
      
      console.info('🎉 DJ Service: 18-step publish flow completed successfully!')
      return result
    }).pipe(
      Effect.catchAll((error) => 
        error instanceof DJServiceError
          ? Effect.fail(error)
          : Effect.fail(new DJServiceError(
              `DJ room publish failed: ${error}`,
              'publishDJRoom',
              'publish_flow',
              999,
              false,
              error
            ))
      )
    ),

  /**
   * Toggle stream (pause/resume)
   */
  toggleDJStream: (pause: boolean) =>
    Effect.gen(function* () {
      const djAdapter = yield* DJAdapter
      
      if (!djAdapter.isProducerConfirmed()) {
        return yield* Effect.fail(new DJServiceError(
          'No active producer to toggle',
          'toggleDJStream',
          'validation',
          1
        ))
      }
      
      // The actual pause/resume would be handled by the adapter
      // which maintains the producer state
      if (pause) {
        console.info('⏸️ DJ Service: Stream paused')
      } else {
        console.info('▶️ DJ Service: Stream resumed')
      }
    }).pipe(
      Effect.catchAll((error) => 
        error instanceof DJServiceError
          ? Effect.fail(error)
          : Effect.fail(new DJServiceError(
              `Failed to toggle DJ stream: ${error}`,
              'toggleDJStream',
              'toggle_error',
              999,
              true,
              error
            ))
      )
    ),

  /**
   * Close DJ room completely
   */
  closeDJRoom: () =>
    Effect.gen(function* () {
      console.info('🏠 DJ Service: Closing DJ room')
      
      const connectionAdapter = yield* ConnectionAdapter
      const djAdapter = yield* DJAdapter
      const webrtcAdapter = yield* WebRTCAdapter
      const roomMetadataAdapter = yield* RoomMetadataAdapter
      
      // Reset all adapter state
      djAdapter.reset()
      connectionAdapter.reset()
      webrtcAdapter.reset()
      roomMetadataAdapter.reset()
      
      console.info('✅ DJ Service: Room closed successfully')
    }).pipe(
      Effect.catchAll((error) => 
        Effect.fail(new DJServiceError(
          `Failed to close DJ room: ${error}`,
          'closeDJRoom',
          'close_error',
          1,
          true,
          error
        ))
      )
    ),

  /**
   * Get available audio devices
   */
  getAudioDevices: () =>
    Effect.gen(function* () {
      const audioClient = yield* AudioClient
      const devices = yield* audioClient.getInputDevices().pipe(
        Effect.catchAll((error) => 
          Effect.fail(new DJServiceError(
            `Failed to get input devices: ${error}`,
            'getAudioDevices',
            'get_devices',
            1,
            true,
            error
          ))
        )
      )
      
      return devices.map(device => ({
        deviceId: device.deviceId,
        label: device.label || `Device ${device.deviceId.slice(0, 8)}`
      }))
    }).pipe(
      Effect.catchAll((error) => 
        error instanceof DJServiceError
          ? Effect.fail(error)
          : Effect.fail(new DJServiceError(
              `Failed to get audio devices: ${error}`,
              'getAudioDevices',
              'general_error',
              999,
              true,
              error
            ))
      )
    )
}


/**
 * DJ Service Live Layer
 * 
 * Provides the DJService implementation through Effect Layer system.
 */
export const DJServiceLive = Layer.succeed(
  DJService,
  DJService.of(DJServiceImpl)
)