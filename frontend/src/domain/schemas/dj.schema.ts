/**
 * DJ Domain Schema
 * 
 * Pure state definitions for DJ functionality following the 18-step DJ room creation flow.
 * Includes embedded MediaSoup state: Device, Send Transport, Producer, and audio tracks.
 * 
 * This schema uses Effect Schema for validation and type safety.
 * NO service calls or side effects - pure data models only.
 * 
 * References: DJ_ROOM_CREATION_FLOW_HOW_ITS_SUPPOSED_TO_BE.md (Steps 1-18)
 */

import { Schema as S } from 'effect'
import { Option } from 'effect'

/**
 * DJ Flow Steps (tracking progress through 18-step flow)
 */
export const DJFlowStep = S.Literal(
  'idle',              // Not started
  'announcing',        // Step 1: Announcing room in lobby
  'connecting',        // Step 2: Connecting to DJ WebSocket
  'initializing',      // Step 2: Receiving RTP capabilities
  'device_loading',    // Step 3: Loading MediaSoup device
  'requesting_media',  // Step 4: getUserMedia for audio track
  'requesting_transport', // Step 5: Request WebRTC transport
  'creating_transport', // Step 8: Create send transport locally  
  'connecting_transport', // Steps 9-12: Transport connect flow
  'creating_producer', // Steps 13-15: Producer creation
  'publishing',        // Step 16: Room published and producer ID received
  'streaming',         // Step 17: Successfully streaming
  'error',             // Step 18: Error occurred, cleanup needed
  'cleanup'            // Cleaning up after error or stop
)
export type DJFlowStep = S.Schema.Type<typeof DJFlowStep>

/**
 * MediaSoup Device State (Step 3: Create and load device)
 */
export const MediaSoupDeviceState = S.Struct({
  device: S.Option(S.Unknown), // mediasoup-client Device instance
  loaded: S.Boolean,
  rtpCapabilities: S.Option(S.Unknown), // Received in Step 2
  loadError: S.Option(S.String),
  handlerName: S.Option(S.String)
})
export type MediaSoupDeviceState = S.Schema.Type<typeof MediaSoupDeviceState>

/**
 * Audio Track State (Step 4: getUserMedia)
 */
export const AudioTrackState = S.Struct({
  track: S.Option(S.Unknown), // MediaStreamTrack instance
  stream: S.Option(S.Unknown), // MediaStream instance
  deviceId: S.Option(S.String),
  constraints: S.Option(S.Unknown), // MediaTrackConstraints used
  acquiredAt: S.Option(S.Date),
  error: S.Option(S.String)
})
export type AudioTrackState = S.Schema.Type<typeof AudioTrackState>

/**
 * Send Transport State (Steps 5-8: Request and create send transport)
 */
export const SendTransportState = S.Struct({
  transport: S.Option(S.Unknown), // mediasoup-client Transport instance
  id: S.Option(S.String),
  connectionState: S.Literal('new', 'connecting', 'connected', 'disconnecting', 'disconnected', 'failed'),
  iceGatheringState: S.Option(S.String),
  iceConnectionState: S.Option(S.String),
  dtlsState: S.Option(S.String),
  transportOptions: S.Option(S.Unknown), // Transport params from backend (Step 7)
  dtlsParameters: S.Option(S.Unknown), // DTLS params for connection (Step 10)
  connected: S.Boolean,
  connectError: S.Option(S.String)
})
export type SendTransportState = S.Schema.Type<typeof SendTransportState>

/**
 * Producer State (Steps 13-17: Create and manage producer)
 */
export const ProducerState = S.Struct({
  producer: S.Option(S.Unknown), // mediasoup-client Producer instance
  id: S.Option(S.String), // Producer ID from backend (Step 16)
  kind: S.Literal('audio', 'video'),
  paused: S.Boolean,
  rtpParameters: S.Option(S.Unknown), // RTP params sent to backend (Step 14)
  track: S.Option(S.Unknown), // Associated MediaStreamTrack
  appData: S.Option(S.Unknown),
  stats: S.Option(S.Struct({
    timestamp: S.Date,
    bytesTransmitted: S.Number,
    packetsTransmitted: S.Number,
    roundTripTime: S.Option(S.Number)
  })),
  createdAt: S.Option(S.Date),
  error: S.Option(S.String)
})
export type ProducerState = S.Schema.Type<typeof ProducerState>

/**
 * Connection Quality Metrics
 */
export const ConnectionQuality = S.Struct({
  rtt: S.Number,
  packetsLost: S.Number,
  jitter: S.Number,
  timestamp: S.Date,
  quality: S.Literal('excellent', 'good', 'fair', 'poor')
})
export type ConnectionQuality = S.Schema.Type<typeof ConnectionQuality>

/**
 * Media Streams State (local streams from getUserMedia)
 */
export const MediaStreamsState = S.Struct({
  localStream: S.Option(S.Unknown), // MediaStream instance from getUserMedia
  audioTrack: S.Option(S.Unknown),  // MediaStreamTrack instance
  streamId: S.Option(S.String),
  createdAt: S.Option(S.Date)
})
export type MediaStreamsState = S.Schema.Type<typeof MediaStreamsState>

/**
 * WebSocket Connection State for DJ
 */
export const DJWebSocketState = S.Struct({
  websocket: S.Option(S.Unknown), // DJ WebSocket connection instance
  connectionState: S.Literal('disconnected', 'connecting', 'connected', 'error', 'reconnecting'),
  url: S.Option(S.String),
  connectedAt: S.Option(S.Date),
  lastMessageAt: S.Option(S.Date),
  messageCount: S.Number,
  connectionError: S.Option(S.String)
})
export type DJWebSocketState = S.Schema.Type<typeof DJWebSocketState>

/**
 * Complete DJ Domain State
 * 
 * Contains all state for DJ functionality following the 18-step flow:
 * - Flow progress tracking
 * - MediaSoup Device (embedded)
 * - Audio track from getUserMedia (embedded) 
 * - Send Transport (optional - created during flow)
 * - Producer (optional - created during flow)
 * - Media Streams (optional - created during flow)
 * - WebSocket connection state
 * - Connection quality metrics
 */
export const DJState = S.Struct({
  // Flow progress
  currentStep: DJFlowStep,
  stepStartedAt: S.Option(S.Date),
  stepError: S.Option(S.String),
  
  // MediaSoup Device (Step 3)
  device: MediaSoupDeviceState,
  
  // Audio Track (Step 4) 
  audioTrack: AudioTrackState,
  
  // Send Transport (Steps 5-8) - Optional, created during flow
  sendTransport: S.Option(SendTransportState),
  
  // Producer (Steps 13-17) - Optional, created during flow
  producer: S.Option(ProducerState),
  
  // Media Streams - Optional, created during flow
  streams: S.Option(MediaStreamsState),
  
  // WebSocket connection state
  websocket: DJWebSocketState,
  
  // Connection quality
  connectionQuality: S.Option(ConnectionQuality),
  
  // Flow timing
  flowStartedAt: S.Option(S.Date),
  flowCompletedAt: S.Option(S.Date),
  
  // Error tracking
  lastError: S.Option(S.Struct({
    step: DJFlowStep,
    error: S.String,
    timestamp: S.Date
  }))
})
export type DJState = S.Schema.Type<typeof DJState>

/**
 * Initial DJ state factory
 */
export const createInitialDJState = (): DJState => ({
  currentStep: 'idle',
  stepStartedAt: Option.none(),
  stepError: Option.none(),
  
  device: {
    device: Option.none(),
    loaded: false,
    rtpCapabilities: Option.none(),
    loadError: Option.none(),
    handlerName: Option.none()
  },
  
  audioTrack: {
    track: Option.none(),
    stream: Option.none(),
    deviceId: Option.none(),
    constraints: Option.none(),
    acquiredAt: Option.none(),
    error: Option.none()
  },
  
  sendTransport: Option.none(),
  
  producer: Option.none(),
  
  streams: Option.none(),
  
  websocket: {
    websocket: Option.none(),
    connectionState: 'disconnected',
    url: Option.none(),
    connectedAt: Option.none(),
    lastMessageAt: Option.none(),
    messageCount: 0,
    connectionError: Option.none()
  },
  
  connectionQuality: Option.none(),
  flowStartedAt: Option.none(),
  flowCompletedAt: Option.none(),
  lastError: Option.none()
})

/**
 * DJ state validators
 */
export const DJStateValidators = {
  /**
   * Validate complete DJ state
   */
  validateDJState: S.decodeUnknown(DJState),
  
  /**
   * Validate device state only
   */
  validateDeviceState: S.decodeUnknown(MediaSoupDeviceState),
  
  /**
   * Validate audio track state only
   */
  validateAudioTrackState: S.decodeUnknown(AudioTrackState),
  
  /**
   * Validate send transport state only
   */
  validateSendTransportState: S.decodeUnknown(SendTransportState),
  
  /**
   * Validate producer state only
   */
  validateProducerState: S.decodeUnknown(ProducerState),
  
  /**
   * Validate flow step
   */
  validateFlowStep: S.decodeUnknown(DJFlowStep)
}