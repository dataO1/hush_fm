/**
 * DJ Flows Service
 * 
 * Implements the exact 18-step DJ room creation flow from DJ_ROOM_CREATION_FLOW_HOW_ITS_SUPPOSED_TO_BE.md
 * Integrates with the room store to update DJ state with embedded MediaSoup state.
 * 
 * Flow Steps (18 total):
 * 1. Announce room creation in lobby websocket → DJ websocket (handled by lobby-flows.service)
 * 2. Connect to room, send room init → receive rtpCapabilities  
 * 3. Create device + call load() with received rtpCapabilities
 * 4. Call getUserMedia() and get audio track
 * 5. Request WebRTC transport from backend
 * 6-7. Backend creates transport + returns params
 * 8. Use device to create send transport
 * 9. Use send transport + call produce() (fires connect & produce events)
 * 10. Connect handler returns dtlsParams
 * 11. Send dtls to backend
 * 12. Backend calls connect() on send transport
 * 13. Produce handler returns parameters
 * 14. Send parameters to backend
 * 15. Backend calls produce() + creates server-side producer
 * 16. Backend saves producerId, marks room public, sends producerId to DJ
 * 17. Frontend calls callback with producerId (local producer ready)
 * 18. Handle errback for cleanup if errors
 */

import { Effect, pipe, Option } from 'effect'
import { Device, types } from 'mediasoup-client'
import { 
  sendDjCommand,
  connectToDjRoom
} from '../websocket/websocket.service'
import type { 
  DjCommand, 
  DjEvent, 
  DtlsParametersJson 
} from '../websocket/schemas/websocket'
import { 
  RtpCapabilitiesFromApi, 
  TransportOptionsFromApi 
} from '../websocket/schemas/websocket'
import {
  DJFlowError
} from '../../domain/errors'
import type { RoomStore } from '../../stores/room.store'
import type { DJState } from '../../domain/schemas/dj.schema'
import { ConnectionState } from '../../domain/schemas/room.schema'
import {
  createAndLoadDevice,
  MediaSoupDeviceServiceLive
} from '../mediasoup/device.service'
import {
  createSendTransportWithEvents,
  MediaSoupTransportServiceLive
} from '../mediasoup/transport.service'
import {
  createAudioProducer,
  MediaSoupProducerServiceLive
} from '../mediasoup/producer.service'

/**
 * DJ Room Publishing Result (after completing 18-step flow)
 */
export interface DJPublishResult {
  roomId: string
  producerId: string
  device: Device
  sendTransport: types.Transport
  producer: types.Producer
  audioTrack: MediaStreamTrack
}

/**
 * Audio constraints optimized for music streaming (no processing)
 */
const getAudioConstraints = (deviceId?: string): MediaStreamConstraints => ({
  audio: {
    deviceId: deviceId ? { exact: deviceId } : undefined,
    channelCount: { ideal: 2, min: 1 },
    // Disable all audio processing for music
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    googEchoCancellation: false,
    googAutoGainControl: false,
    googNoiseSuppression: false,
    googHighpassFilter: false
  } as MediaTrackConstraints,
  video: false
})

/**
 * Wait for specific DJ event with timeout
 */
const waitForDjEvent = <T extends DjEvent>(
  ws: WebSocket,
  eventType: T['type'],
  timeoutMs: number = 10000
): Effect.Effect<T, Error> =>
  Effect.async<T, Error>((resume) => {
    const handler = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data)
        
        // 🔍 Comprehensive WebSocket message logging for debugging
        console.log(`🔍 DJ WebSocket Message Received:`, {
          type: data.type,
          expectedType: eventType,
          fullMessage: JSON.stringify(data, null, 2)
        })
        
        // Special logging for roomInitialized to debug RTP capabilities
        if (data.type === 'roomInitialized') {
          console.log(`🎵 RTP Capabilities Debug:`, {
            hasRtpCapabilities: !!data.rtpCapabilities,
            rtpCapabilitiesType: typeof data.rtpCapabilities,
            hasCodecs: !!(data.rtpCapabilities && data.rtpCapabilities.codecs),
            codecsType: data.rtpCapabilities && typeof data.rtpCapabilities.codecs,
            codecsLength: data.rtpCapabilities && data.rtpCapabilities.codecs && data.rtpCapabilities.codecs.length,
            hasHeaderExtensions: !!(data.rtpCapabilities && data.rtpCapabilities.headerExtensions),
            headerExtensionsType: data.rtpCapabilities && typeof data.rtpCapabilities.headerExtensions,
            fullRtpCapabilities: data.rtpCapabilities ? JSON.stringify(data.rtpCapabilities, null, 2) : 'undefined'
          })
        }
        
        if (data.type === eventType) {
          ws.removeEventListener('message', handler)
          resume(Effect.succeed(data as T))
        }
      } catch (error) {
        console.error(`❌ Failed to parse WebSocket message:`, error, event.data)
        ws.removeEventListener('message', handler)
        resume(Effect.fail(new Error(`Failed to parse ${eventType} event: ${error}`)))
      }
    }
    
    ws.addEventListener('message', handler)
    
    setTimeout(() => {
      ws.removeEventListener('message', handler)
      resume(Effect.fail(new Error(`Timeout waiting for ${eventType}`)))
    }, timeoutMs)
    
    return Effect.sync(() => ws.removeEventListener('message', handler))
  })

/**
 * Convert DTLS parameters to JSON format
 */
const dtlsParamsToJson = (params: any): DtlsParametersJson => ({
  fingerprints: params.fingerprints,
  role: params.role
})

/**
 * Device Preview Flow - Create preview stream for device selection
 * 
 * Creates a getUserMedia stream for the selected device and stores it in DJ state
 * so the oscilloscope can show audio input before going live.
 */
export const previewAudioDevice = (
  roomStore: RoomStore,
  deviceId: string
): Effect.Effect<MediaStream, DJFlowError> =>
  pipe(
    Effect.gen(function* (_) {
      console.info(`🎤 Starting device preview for device: ${deviceId}`)
      
      try {
        // Clean up any existing preview stream first
        const currentDJ = roomStore.djState as any
        if (currentDJ && currentDJ.streams && Option.isSome(currentDJ.streams)) {
          const streams = currentDJ.streams.value as any
          if (streams.localStream && Option.isSome(streams.localStream)) {
            const localStream = streams.localStream.value as MediaStream
            console.info('🧹 Cleaning up existing preview stream')
            localStream.getTracks().forEach(track => track.stop())
          }
        }
        
        // Create new stream with selected device
        const stream = yield* _(Effect.tryPromise({
          try: () => navigator.mediaDevices.getUserMedia(getAudioConstraints(deviceId)),
          catch: (error: unknown) => new DJFlowError({
            cause: `Failed to get user media for device ${deviceId}: ${String(error)}`,
            step: 'device_preview',
            stepNumber: 0,
            recoverable: true,
            context: {
              timestamp: new Date(),
              operation: 'preview_audio_device',
              details: { deviceId }
            }
          })
        }))
        
        console.info(`✅ Device preview stream created for device: ${deviceId}`)
        
        // Update store with preview stream using updateDJState for partial updates
        roomStore.actions.updateDJState({
          streams: Option.some({
            localStream: Option.some(stream as any),
            audioTrack: Option.some(stream.getAudioTracks()[0] as any),
            streamId: Option.some(stream.id),
            createdAt: Option.some(new Date())
          } as any)
        })
        
        return stream
        
      } catch (error) {
        console.error(`❌ Device preview failed for device ${deviceId}:`, error)
        throw new DJFlowError({
          cause: `Device preview failed: ${String(error)}`,
          step: 'device_preview',
          stepNumber: 0,
          recoverable: true,
          context: {
            timestamp: new Date(),
            operation: 'preview_audio_device',
            details: { deviceId }
          }
        })
      }
    })
  )

/**
 * Stop Device Preview Flow
 * 
 * Stops and cleans up the preview stream
 */
export const stopDevicePreview = (
  roomStore: RoomStore
): Effect.Effect<void, DJFlowError> =>
  pipe(
    Effect.gen(function* (_) {
      console.info('🛑 Stopping device preview')
      
      const currentDJ = roomStore.djState as any
      if (currentDJ && currentDJ.streams && Option.isSome(currentDJ.streams)) {
        const streams = currentDJ.streams.value as any
        if (streams.localStream && Option.isSome(streams.localStream)) {
          const localStream = streams.localStream.value as MediaStream
          console.info('🧹 Stopping preview stream tracks')
          localStream.getTracks().forEach(track => track.stop())
        }
      }
      
      // Clear streams from store
      roomStore.actions.updateDJState({
        streams: Option.none()
      })
      
      console.info('✅ Device preview stopped')
    })
  )

/**
 * DJ Room Publishing Flow (18 Steps) - follows specification exactly
 * 
 * Prerequisites: Room already announced in lobby (Step 1 done by lobby-flows.service)
 * 
 * Integrates with room store to update DJ state throughout the flow.
 */
export const publishDJRoom = (
  roomStore: RoomStore,
  roomId: string,
  deviceId?: string
): Effect.Effect<DJPublishResult, DJFlowError> =>
  pipe(
    Effect.gen(function* (_) {
      console.info('🎤 Starting DJ Room Publishing Flow (18 steps)')
      
      // Set selected device ID in store first
      if (deviceId) {
        roomStore.actions.setSelectedDeviceId(deviceId)
      }
      
      // Step 1: Already done - room announced in lobby, returns DJ WebSocket URL
      console.info('✅ Step 1: Room announced (prerequisites met)')
      
      // Connect to DJ WebSocket using centralized WebSocket service
      console.info('🔄 Connecting to DJ WebSocket...')
      roomStore.actions.setDJFlowStep('connecting')
      
      const djWebSocket = yield* _(pipe(
        connectToDjRoom(roomId),
        Effect.mapError(error => new DJFlowError({
          cause: `Failed to connect to DJ WebSocket: ${error.message}`,
          step: 'connecting',
          stepNumber: 1,
          recoverable: false,
          context: { timestamp: new Date(), operation: 'websocket_connect', details: { roomId, error } }
        }))
      ))
      
      // Store DJ WebSocket in room store via service action
      roomStore.actions.updateDJState({
        flowStartedAt: Option.some(new Date()),
        websocket: {
          websocket: Option.some(djWebSocket),
          connectionState: 'connected',
          url: Option.some(`wss://${window.location.hostname}:3443/ws/room/${roomId}`),
          connectedAt: Option.some(new Date()),
          lastMessageAt: Option.none(),
          messageCount: 0,
          connectionError: Option.none()
        }
      })
      
      console.info('✅ Connected to DJ WebSocket')
      
      // Step 2: Send room init message, receive rtpCapabilities
      console.info('🔄 Step 2: Sending room init message...')
      roomStore.actions.setDJFlowStep('initializing')
      
      const initCommand: DjCommand = {
        type: 'initRoom',
        roomId: roomId
      }
      
      yield* _(sendDjCommand(djWebSocket, initCommand))
      
      const roomInitResponse = yield* _(
        waitForDjEvent<DjEvent & { type: 'roomInitialized' }>(djWebSocket, 'roomInitialized', 10000).pipe(
          Effect.mapError(error => new DJFlowError({
            cause: error.message,
            step: 'connecting',
            stepNumber: 2,
            recoverable: false,
            context: { timestamp: new Date(), operation: 'room_init', details: { error } }
          }))
        )
      )
      
      console.info('✅ Step 2: Room initialized, RTP capabilities received')
      
      // Step 3: Create new device and call load() with received rtpCapabilities
      console.info('🔄 Step 3: Creating MediaSoup device and loading capabilities...')
      roomStore.actions.setDJFlowStep('device_loading')
      
      const rtpCapabilities = RtpCapabilitiesFromApi.decode(roomInitResponse.rtpCapabilities)
      const device = yield* _(pipe(
        createAndLoadDevice(rtpCapabilities),
        Effect.provide(MediaSoupDeviceServiceLive),
        Effect.mapError(error => {
          // Enhanced error context for device loading failures
          const deviceErrorMessage = error instanceof Error ? error.message : String(error)
          const isPermissionError = deviceErrorMessage.toLowerCase().includes('permission') || 
                                   deviceErrorMessage.toLowerCase().includes('denied') ||
                                   deviceErrorMessage.toLowerCase().includes('getusermedia')
          const isBrowserError = deviceErrorMessage.toLowerCase().includes('webrtc') ||
                                deviceErrorMessage.toLowerCase().includes('browser') ||
                                deviceErrorMessage.toLowerCase().includes('unsupported')
          
          console.error('❌ Device loading failed in DJ flow:', {
            original_error: deviceErrorMessage,
            error_type: error.constructor.name,
            is_permission_error: isPermissionError,
            is_browser_error: isBrowserError,
            room_id: roomId,
            step: 'device_load',
            step_number: 3
          })
          
          return new DJFlowError({
            cause: `Failed to load MediaSoup device: ${deviceErrorMessage}`,
            step: 'device_load',
            stepNumber: 3,
            recoverable: false, // Device loading failures typically require user action
            context: { 
              timestamp: new Date(),
              operation: 'device_load',
              details: { 
                roomId, 
                originalError: deviceErrorMessage,
                errorType: error.constructor.name,
                isPermissionError,
                isBrowserError,
                rtpCapabilitiesSummary: {
                  codecCount: rtpCapabilities.codecs?.length || 0,
                  headerExtCount: rtpCapabilities.headerExtensions?.length || 0
                }
              }
            }
          })
        })
      ))
      
      // Update room store with device state
      roomStore.actions.updateDJState({
        device: {
          device: Option.some(device),
          loaded: true,
          rtpCapabilities: Option.some(device.rtpCapabilities),
          loadError: Option.none(),
          handlerName: Option.some(device.handlerName)
        }
      })
      
      console.info('✅ Step 3: Device loaded with RTP capabilities')
      
      // Step 4: Get audio track (reuse existing preview stream if available)
      console.info('🔄 Step 4: Getting audio track for production...')
      roomStore.actions.setDJFlowStep('requesting_media')
      
      let stream: MediaStream
      let audioTrack: MediaStreamTrack
      
      // Try to reuse existing preview stream first
      const currentDJ = roomStore.djState as any
      const hasExistingStream = currentDJ && 
        currentDJ.streams && 
        Option.isSome(currentDJ.streams) &&
        currentDJ.streams.value.localStream &&
        Option.isSome(currentDJ.streams.value.localStream)
      
      if (hasExistingStream) {
        console.info('✅ Step 4: Reusing existing preview stream for production')
        stream = currentDJ.streams.value.localStream.value as MediaStream
        audioTrack = stream.getAudioTracks()[0]
        
        if (!audioTrack) {
          console.warn('⚠️ Preview stream has no audio track, creating new stream')
          // Fall back to creating new stream
          stream = yield* _(Effect.tryPromise({
            try: () => navigator.mediaDevices.getUserMedia(getAudioConstraints(deviceId)),
            catch: (error) => new DJFlowError({
              cause: 'Failed to get user media (fallback)',
              step: 'get_user_media',
              stepNumber: 4,
              recoverable: true,
              context: { 
                timestamp: new Date(),
                operation: 'get_user_media_fallback',
                details: { roomId, deviceId, error }
              }
            })
          }))
          audioTrack = stream.getAudioTracks()[0]
        }
      } else {
        console.info('📡 Step 4: Creating new stream for production (no preview stream found)')
        // Create new stream
        stream = yield* _(Effect.tryPromise({
          try: () => navigator.mediaDevices.getUserMedia(getAudioConstraints(deviceId)),
          catch: (error) => new DJFlowError({
            cause: 'Failed to get user media',
            step: 'get_user_media',
            stepNumber: 4,
            recoverable: true,
            context: { 
              timestamp: new Date(),
              operation: 'get_user_media',
              details: { roomId, deviceId, error }
            }
          })
        }))
        audioTrack = stream.getAudioTracks()[0]
        
        if (!audioTrack) {
          yield* _(Effect.fail(new DJFlowError({
            cause: 'No audio track in media stream',
            step: 'get_user_media',
            stepNumber: 4,
            recoverable: true,
            context: { 
              timestamp: new Date(),
              operation: 'get_user_media',
              details: { roomId, deviceId }
            }
          })))
        }
      }
      
      // Update room store with audio track state
      roomStore.actions.updateDJState({
        audioTrack: {
          track: Option.some(audioTrack),
          stream: Option.some(stream),
          deviceId: Option.fromNullable(deviceId),
          constraints: Option.some(getAudioConstraints(deviceId)),
          acquiredAt: Option.some(new Date()),
          error: Option.none()
        },
        streams: Option.some({
          localStream: Option.some(stream),
          audioTrack: Option.some(audioTrack),
          streamId: Option.some(stream.id),
          createdAt: Option.some(new Date())
        })
      })
      
      console.info('✅ Step 4: Audio track acquired')
      
      // Step 5: Request WebRTC transport from backend
      console.info('🔄 Step 5: Requesting DJ transport...')
      roomStore.actions.setDJFlowStep('requesting_transport')
      
      const transportCommand: DjCommand = {
        type: 'requestDjTransport'
      }
      
      yield* _(sendDjCommand(djWebSocket, transportCommand))
      
      // Step 6-7: Backend creates transport and returns params
      const transportResponse = yield* _(
        waitForDjEvent<DjEvent & { type: 'djTransportReady' }>(djWebSocket, 'djTransportReady', 10000).pipe(
          Effect.mapError(error => new DJFlowError({
            cause: error.message,
            step: 'creating_transport',
            stepNumber: 6,
            recoverable: false,
            context: { timestamp: new Date(), operation: 'transport_ready', details: { error } }
          }))
        )
      )
      
      console.info('✅ Steps 6-7: DJ transport ready, parameters received')
      
      // Step 8: Use device to create send transport
      console.info('🔄 Step 8: Creating send transport...')
      roomStore.actions.setDJFlowStep('creating_transport')
      
      const transportOptions = TransportOptionsFromApi.decode(transportResponse.transportOptions)
      
      const sendTransport = yield* _(pipe(
        createSendTransportWithEvents(device, transportResponse.transportOptions, {
          // Step 10-12: Connect event handler (dtls flow)
          onConnect: async (dtlsParameters) => {
            console.info('🔄 Steps 10-11: Transport connect event, sending DTLS params...')
            roomStore.actions.setDJFlowStep('connecting_transport')
            
            const dtlsCommand: DjCommand = {
              type: 'connectDjTransport',
              transportId: transportOptions.id,
              dtlsParameters: dtlsParamsToJson(dtlsParameters)
            }
            
            // Step 11: Send dtls to backend
            await Effect.runPromise(sendDjCommand(djWebSocket, dtlsCommand))
            console.info('✅ Steps 11-12: DTLS parameters sent, backend connecting transport')
          },
          
          // Step 13-17: Produce event handler
          onProduce: (parameters, callback, _errback) => {
            console.info('🔄 Steps 13-14: Produce event, sending RTP parameters...')
            roomStore.actions.setDJFlowStep('creating_producer')
            
            // Step 14: Send parameters to backend
            const produceCommand: DjCommand = {
              type: 'produce',
              rtpParameters: parameters.rtpParameters as any
            }
            
            Effect.runSync(sendDjCommand(djWebSocket, produceCommand))
            
            // Step 15-16: Backend will create producer and send producerId back
            // We'll handle the response in a separate listener
            
            // Step 17: Will be called when we receive producerId from backend
            callback({ id: 'temp-id' }) // Temporary ID until backend responds
          }
        }),
        Effect.provide(MediaSoupTransportServiceLive),
        Effect.mapError(error => new DJFlowError({
          cause: 'Failed to create send transport',
          step: 'create_transport',
          stepNumber: 8,
          recoverable: false,
          context: { 
            timestamp: new Date(),
            operation: 'create_transport',
            details: { roomId, error }
          }
        }))
      ))
      
      // Update room store with transport state
      roomStore.actions.updateDJState({
        sendTransport: Option.some({
          transport: Option.some(sendTransport),
          id: Option.some(transportOptions.id),
          connectionState: 'new',
          iceGatheringState: Option.none(),
          iceConnectionState: Option.none(),
          dtlsState: Option.none(),
          transportOptions: Option.some(transportOptions),
          dtlsParameters: Option.none(),
          connected: false,
          connectError: Option.none()
        })
      })
      
      console.info('✅ Step 8: Send transport created')
      
      // Step 9: Use send transport and call produce() (which fires connect & produce events)
      console.info('🔄 Step 9: Calling produce() - will trigger connect and produce events...')
      roomStore.actions.setDJFlowStep('creating_producer')
      
      const producer = yield* _(pipe(
        createAudioProducer(sendTransport, audioTrack, {
          onTrackEnded: (_producer) => {
            console.error('❌ Producer track ended - audio source stopped')
            roomStore.actions.setDJError('Audio track ended', 'error')
          },
          onTransportClose: (_producer) => {
            console.error('❌ Producer transport closed')
            roomStore.actions.setDJError('Transport closed', 'error')
          }
        }),
        Effect.provide(MediaSoupProducerServiceLive),
        Effect.mapError(error => new DJFlowError({
          cause: 'Failed to create producer',
          step: 'create_producer',
          stepNumber: 15,
          recoverable: false,
          context: { 
            timestamp: new Date(),
            operation: 'create_producer',
            details: { roomId, error }
          }
        }))
      ))
      
      // Update room store with producer state
      roomStore.actions.updateDJState({
        producer: Option.some({
          producer: Option.some(producer),
          id: Option.some(producer.id),
          kind: 'audio',
          paused: producer.paused,
          rtpParameters: Option.some(producer.rtpParameters),
          track: Option.some(audioTrack),
          appData: Option.some(producer.appData),
          stats: Option.none(),
          createdAt: Option.some(new Date()),
          error: Option.none()
        })
      })
      
      // Wait for backend to confirm producer creation and send final producerId
      console.info('🔄 Step 16: Waiting for backend producer confirmation...')
      const producerCreatedResponse = yield* _(
        waitForDjEvent<DjEvent & { type: 'producerCreated' }>(djWebSocket, 'producerCreated', 10000).pipe(
          Effect.mapError(error => new DJFlowError({
            cause: error.message,
            step: 'publishing',
            stepNumber: 16,
            recoverable: false,
            context: { timestamp: new Date(), operation: 'producer_created', details: { error } }
          }))
        )
      )
      
      // Step 16-18: Room is now public and streaming
      console.info('✅ Steps 16-18: Producer created, room is public and streaming!')
      roomStore.actions.setDJFlowStep('streaming')
      roomStore.actions.updateDJState({
        flowCompletedAt: Option.some(new Date()),
        lastError: Option.none()
      })
      
      // Update room streaming status
      roomStore.actions.startStreaming()
      
      return {
        roomId,
        producerId: producerCreatedResponse.producerId,
        device,
        sendTransport,
        producer,
        audioTrack
      }
    }),
    
    // Step 18: Error handling and cleanup
    Effect.catchAll((error) => {
      console.error('❌ DJ Flow Error - Step 18: Cleanup required', error)
      roomStore.actions.setDJFlowStep('error')
      roomStore.actions.setDJError(
        error instanceof Error ? error.message : String(error),
        'error'
      )
      
      // Send cleanup command if needed
      if (roomStore.roomId) {
        const djState = roomStore.djState as DJState | null
        if (djState) {
          Option.match(djState.websocket.websocket, {
            onSome: (ws: WebSocket) => {
              const cleanupCommand: DjCommand = {
                type: 'closeRoom'
              }
              Effect.runSync(sendDjCommand(ws, cleanupCommand))
            },
            onNone: () => {}
          })
        }
      }
      
      return Effect.fail(error instanceof DJFlowError ? error : new DJFlowError({
        cause: error instanceof Error ? error.message : String(error),
        step: 'error',
        stepNumber: 18,
        recoverable: false,
        context: { timestamp: new Date(), operation: 'cleanup', details: { error } }
      }))
    })
  )

/**
 * Pause DJ stream (control flow)
 */
export const pauseDJStream = (
  roomStore: RoomStore,
  djWebSocket: WebSocket
): Effect.Effect<void, DJFlowError> =>
  pipe(
    Effect.gen(function* (_) {
      console.info('⏸️ Pausing DJ stream')
      
      // Update room store
      roomStore.actions.pauseStreaming()
      
      // Send pause command to backend
      const pauseCommand: DjCommand = {
        type: 'pauseStream'
      }
      
      yield* _(sendDjCommand(djWebSocket, pauseCommand).pipe(
        Effect.mapError(error => new DJFlowError({
          cause: error.message || 'Failed to pause stream',
          step: 'streaming',
          stepNumber: 0,
          recoverable: true,
          context: { timestamp: new Date(), operation: 'pause_stream', details: { error } }
        }))
      ))
      
      console.info('✅ DJ stream paused')
    })
  )

/**
 * Resume DJ stream (control flow)
 */
export const resumeDJStream = (
  roomStore: RoomStore,
  djWebSocket: WebSocket
): Effect.Effect<void, DJFlowError> =>
  pipe(
    Effect.gen(function* (_) {
      console.info('▶️ Resuming DJ stream')
      
      // Update room store
      roomStore.actions.resumeStreaming()
      
      // Send resume command to backend
      const resumeCommand: DjCommand = {
        type: 'resumeStream'
      }
      
      yield* _(sendDjCommand(djWebSocket, resumeCommand).pipe(
        Effect.mapError(error => new DJFlowError({
          cause: error.message || 'Failed to resume stream',
          step: 'streaming',
          stepNumber: 0,
          recoverable: true,
          context: { timestamp: new Date(), operation: 'resume_stream', details: { error } }
        }))
      ))
      
      console.info('✅ DJ stream resumed')
    })
  )

/**
 * Close DJ room with comprehensive cleanup following listener cleanup pattern
 */
export const closeDJRoom = (
  roomStore: RoomStore,
  djWebSocket: WebSocket
): Effect.Effect<void, DJFlowError> =>
  pipe(
    Effect.gen(function* (_) {
      console.info('🚪 Starting DJ room closure process')

      // Step 1: Update flow step to cleanup
      roomStore.actions.setDJFlowStep('cleanup')
      console.info('📊 DJ flow step set to cleanup')

      // Step 2: Send close room command to backend if WebSocket is open
      if (djWebSocket && djWebSocket.readyState === WebSocket.OPEN) {
        console.info('📡 Sending closeRoom command to backend')
        try {
          const closeCommand: DjCommand = { type: 'closeRoom' }
          
          yield* _(sendDjCommand(djWebSocket, closeCommand).pipe(
            Effect.tapBoth({
              onFailure: (error) => Effect.sync(() => {
                console.warn('Failed to send closeRoom command, continuing with cleanup:', error)
              }),
              onSuccess: () => Effect.sync(() => {
                console.info('✅ CloseRoom command sent to backend')
              })
            }),
            // Don't fail the entire close flow if command sending fails
            Effect.catchAll(() => Effect.void),
            Effect.mapError(error => new DJFlowError({
              cause: (error as any)?.message || 'Failed to send close room command',
              step: 'cleanup',
              stepNumber: 1,
              recoverable: false,
              context: { timestamp: new Date(), operation: 'send_close_command', details: { error } }
            }))
          ))
        } catch (error) {
          console.warn('Error sending close room command:', error)
        }
      } else {
        console.info('WebSocket not available or not open, skipping backend notification')
      }

      // Step 3: Clean up local MediaSoup resources
      console.info('🧹 Starting DJ MediaSoup resource cleanup')
      yield* _(cleanupDJMediaSoupResources(roomStore).pipe(
        Effect.catchAll((error) => {
          console.warn('⚠️ DJ MediaSoup cleanup failed, continuing:', error)
          return Effect.void
        })
      ))

      // Step 4: Close WebSocket with store updates
      console.info('🔌 Closing DJ WebSocket connection')
      if (djWebSocket && djWebSocket.readyState === WebSocket.OPEN) {
        try {
          djWebSocket.close()
          console.info('✅ DJ WebSocket closed')
        } catch (error) {
          console.warn('⚠️ Failed to close DJ WebSocket:', error)
        }
      }

      // Step 5: Update store state - disconnect from room and reset
      console.info('🔄 Updating room state to DISCONNECTED')
      roomStore.actions.setConnectionState(ConnectionState.DISCONNECTED)
      roomStore.actions.disconnectFromRoom()
      
      console.info('✅ DJ room closure completed successfully')
    }),
    // Add timeout protection for the entire cleanup process
    Effect.timeout(30000),
    Effect.mapError(error => {
      if (error._tag === 'TimeoutException') {
        return new DJFlowError({
          cause: 'Room closure timed out after 30 seconds',
          step: 'cleanup',
          stepNumber: 0,
          recoverable: false,
          context: { timestamp: new Date(), operation: 'close_room_timeout' }
        })
      }
      return error instanceof DJFlowError ? error : new DJFlowError({
        cause: (error as any)?.message || 'Unknown error during room closure',
        step: 'cleanup',
        stepNumber: 0,
        recoverable: false,
        context: { timestamp: new Date(), operation: 'close_room_error', details: { error } }
      })
    })
  )

/**
 * Clean up DJ MediaSoup resources (producer, transport)
 * Similar to listener cleanup but for DJ resources
 */
const cleanupDJMediaSoupResources = (roomStore: RoomStore): Effect.Effect<void, DJFlowError> =>
  pipe(
    Effect.gen(function* (_) {
      console.info('🧹 Starting DJ MediaSoup resource cleanup')

      const djState = roomStore.djState as DJState | null
      if (!djState) {
        console.info('ℹ️ No DJ state to clean up')
        return
      }

      // Clean up producer if exists
      Option.match(djState.producer, {
        onSome: (producerState) => {
          Option.match(producerState.producer, {
            onSome: (producer) => {
              console.info('🛑 Closing DJ producer')
              try {
                (producer as any).close()
                console.info('✅ DJ producer closed')
              } catch (error) {
                console.warn('⚠️ Failed to close DJ producer:', error)
              }
            },
            onNone: () => console.info('ℹ️ No producer instance to clean up')
          })
        },
        onNone: () => console.info('ℹ️ No producer state to clean up')
      })

      // Clean up transport if exists  
      Option.match(djState.sendTransport, {
        onSome: (transportState) => {
          Option.match(transportState.transport, {
            onSome: (transport) => {
              console.info('🛑 Closing DJ transport')
              try {
                (transport as any).close()
                console.info('✅ DJ transport closed')
              } catch (error) {
                console.warn('⚠️ Failed to close DJ transport:', error)
              }
            },
            onNone: () => console.info('ℹ️ No transport instance to clean up')
          })
        },
        onNone: () => console.info('ℹ️ No send transport state to clean up')
      })

      // Update store to reflect cleanup - clear producer and transport references
      roomStore.actions.updateDJState({
        producer: Option.none(),
        sendTransport: Option.none()
      })

      console.info('✅ DJ MediaSoup resource cleanup completed')
    }),
    Effect.mapError(error => new DJFlowError({
      cause: (error as any)?.message || 'Failed to cleanup DJ MediaSoup resources',
      step: 'cleanup',
      stepNumber: 3,
      recoverable: false,
      context: { timestamp: new Date(), operation: 'cleanup_mediasoup', details: { error } }
    }))
  )

/**
 * Toggle DJ stream pause/resume based on current state
 * Checks store for current status and toggles appropriately
 */
export const toggleDJStream = (
  roomStore: RoomStore
): Effect.Effect<void, DJFlowError> =>
  pipe(
    Effect.gen(function* (_) {
      // Check if DJ is currently streaming
      if (!roomStore.isDJStreaming) {
        return yield* _(Effect.fail(new DJFlowError({
          cause: 'Cannot toggle stream - DJ is not currently streaming',
          step: 'streaming',
          stepNumber: 17,
          recoverable: true,
          context: { timestamp: new Date(), operation: 'toggle_stream_not_streaming' }
        })))
      }

      // Get DJ WebSocket from store
      const djState = roomStore.djState as any
      const djWebSocket = Option.getOrNull(djState?.websocket?.websocket)
      
      if (!djWebSocket) {
        return yield* _(Effect.fail(new DJFlowError({
          cause: 'DJ WebSocket not available for stream toggle',
          step: 'streaming',
          stepNumber: 17,
          recoverable: true,
          context: { timestamp: new Date(), operation: 'toggle_stream_no_websocket' }
        })))
      }

      // Toggle based on current paused state
      if (roomStore.isPaused) {
        console.info('🔄 Toggling DJ stream: resuming (was paused)')
        yield* _(resumeDJStream(roomStore, djWebSocket as WebSocket))
      } else {
        console.info('🔄 Toggling DJ stream: pausing (was playing)')
        yield* _(pauseDJStream(roomStore, djWebSocket as WebSocket))
      }
    })
  )