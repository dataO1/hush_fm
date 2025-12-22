/**
 * DJ Domain Schema
 * 
 * Pure state definitions for DJ functionality following the 18-step DJ room creation flow.
 * Uses shared schema patterns and proper external type synchronization.
 * 
 * Pattern: S.Schema.Type<> for store inference, S.Encoded vs S.Type for API boundaries
 * 
 * References: DJ_ROOM_CREATION_FLOW_HOW_ITS_SUPPOSED_TO_BE.md (Steps 1-18)
 */

import { Schema as S, Option, Data } from 'effect'
import { Device } from 'mediasoup-client'
import { 
  WebAPISchemas,
  MultiStepFlowSchemas
} from './shared'
import {
  RtpCapabilitiesSchema,
  RtpParametersSchema,
  DtlsParametersSchema,
  MediaSoupTransportSchema,
  MediaSoupProducerSchema
} from './shared/mediasoup.schema'
// Import TransportOptionsSchema directly from websocket schema (infrastructure layer)
import { TransportOptionsSchema, WebSocketSchemas } from './shared/websocket.schema'

/**
 * DJ Flow Steps (18-step flow progression)
 */
export const DJFlowStep = S.Literal(
  'idle',                   // Not started
  'announcing',             // Step 1: Announcing room in lobby
  'connecting',             // Step 2: Connecting to DJ WebSocket
  'initializing',           // Step 2: Receiving RTP capabilities
  'device_loading',         // Step 3: Loading MediaSoup device
  'requesting_media',       // Step 4: getUserMedia for audio track
  'requesting_transport',   // Step 5: Request WebRTC transport
  'creating_transport',     // Step 8: Create send transport locally  
  'connecting_transport',   // Steps 9-12: Transport connect flow
  'creating_producer',      // Steps 13-15: Producer creation
  'validating_connection',  // Step 15a: WebRTC connection validation
  'publishing',             // Step 16: Room published and producer ID received
  'streaming',              // Step 17: Successfully streaming
  'error',                  // Step 18: Error occurred, cleanup needed
  'cleanup'                 // Cleaning up after error or stop
)
export type DJFlowStepType = S.Schema.Type<typeof DJFlowStep>

/**
 * DJ MediaSoup Device State (Step 3: Create and load device)
 */
export const DJDeviceState = S.Struct({
  device: S.Option(S.instanceOf(Device)),
  loaded: S.Boolean,
  rtpCapabilities: S.Option(RtpCapabilitiesSchema),
  loadError: S.Option(S.String),
  handlerName: S.Option(S.String),
  routerCompatible: S.Boolean
})
export type DJDeviceStateType = S.Schema.Type<typeof DJDeviceState>

/**
 * DJ Audio Track State (Step 4: getUserMedia)
 */
export const DJAudioTrackState = S.Struct({
  track: S.Option(WebAPISchemas.MediaStreamTrack),
  stream: S.Option(WebAPISchemas.MediaStream),
  deviceId: S.Option(S.String),
  constraints: S.Option(WebAPISchemas.MediaTrackConstraints),
  acquiredAt: S.Option(S.DateFromString),
  error: S.Option(S.String)
})
export type DJAudioTrackStateType = S.Schema.Type<typeof DJAudioTrackState>

/**
 * DJ Send Transport State (Steps 5-8: Request and create send transport)
 */
export const DJSendTransportState = S.Struct({
  transport: S.Option(MediaSoupTransportSchema),
  id: S.Option(S.String),
  connectionState: S.Literal('new', 'connecting', 'connected', 'disconnecting', 'disconnected', 'failed'),
  iceGatheringState: S.Option(S.String),
  iceConnectionState: S.Option(S.String),
  dtlsState: S.Option(S.String),
  transportOptions: S.Option(TransportOptionsSchema), // Use our shared TransportOptions schema
  dtlsParameters: S.Option(DtlsParametersSchema),
  connected: S.Boolean,
  connectError: S.Option(S.String)
})
export type DJSendTransportStateType = S.Schema.Type<typeof DJSendTransportState>

/**
 * DJ Producer State (Steps 13-17: Create and manage producer)
 */
export const DJProducerState = S.Struct({
  producer: S.Option(MediaSoupProducerSchema),
  id: S.Option(S.String),
  kind: S.Literal('audio', 'video'),
  paused: S.Boolean,
  rtpParameters: S.Option(RtpParametersSchema),
  track: S.Option(WebAPISchemas.MediaStreamTrack),
  appData: S.Option(S.Record({ key: S.String, value: S.String })), // Structured app data
  // Stats removed - not needed
  createdAt: S.Option(S.DateFromString),
  error: S.Option(S.String)
})
export type DJProducerStateType = S.Schema.Type<typeof DJProducerState>

/**
 * DJ Media Streams State (local streams from getUserMedia)
 */
export const DJMediaStreamsState = S.Struct({
  localStream: S.Option(WebAPISchemas.MediaStream),
  audioTrack: S.Option(WebAPISchemas.MediaStreamTrack),
  streamId: S.Option(S.String),
  createdAt: S.Option(S.DateFromString)
})
export type DJMediaStreamsStateType = S.Schema.Type<typeof DJMediaStreamsState>

/**
 * DJ WebSocket Connection State (extends shared WebSocket pattern)
 */
export const DJWebSocketState = WebSocketSchemas.BaseConnection.pipe(
  S.extend(WebSocketSchemas.DJExtension)
)
export type DJWebSocketStateType = S.Schema.Type<typeof DJWebSocketState>

/**
 * Complete DJ Domain State
 * 
 * Uses S.Schema.Type<> pattern for store inference.
 * Store will use: createStore<DJStateType>(createInitialDJState())
 */
export const DJState = MultiStepFlowSchemas.State.pipe(
  S.extend(S.Struct({
    // Override currentStep with DJ-specific steps
    currentStep: DJFlowStep,
    
    // DJ-specific embedded state
    device: DJDeviceState,
    audioTrack: DJAudioTrackState,
    sendTransport: S.Option(DJSendTransportState),
    producer: S.Option(DJProducerState),
    streams: S.Option(DJMediaStreamsState),
    websocket: DJWebSocketState,
    
    // Note: Connection quality removed - not needed
  }))
)
export type DJStateType = S.Schema.Type<typeof DJState>
export type DJStateEncoded = S.Schema.Encoded<typeof DJState>

/**
 * Initial DJ state factory for stores
 * 
 * Returns clean application state (S.Schema.Type<> format)
 * Store pattern: const [djState, setDJState] = createStore<DJStateType>(createInitialDJState())
 */
export const createInitialDJState = (): DJStateType => ({
  currentStep: 'idle',
  stepStartedAt: Option.none(),
  stepError: Option.none(),
  flowStartedAt: Option.none(),
  flowCompletedAt: Option.none(),
  lastError: Option.none(),
  
  device: {
    device: Option.none(),
    loaded: false,
    rtpCapabilities: Option.none(),
    loadError: Option.none(),
    handlerName: Option.none(),
    routerCompatible: false
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
    connectionError: Option.none(),
    roomId: Option.none(),
    streamingStartedAt: Option.none(),
    producerIds: []
  },
  
  // Connection quality removed - not needed
})

/**
 * DJ State Decoders for Infrastructure Services
 * 
 * Use at API/WebSocket boundaries to validate incoming data
 */
export const DJStateDecoders = {
  /**
   * Decode complete DJ state from API
   */
  decodeDJState: S.decodeUnknown(DJState),
  
  /**
   * Decode device state from MediaSoup API
   */
  decodeDeviceState: S.decodeUnknown(DJDeviceState),
  
  /**
   * Decode transport state from MediaSoup API  
   */
  decodeTransportState: S.decodeUnknown(DJSendTransportState),
  
  /**
   * Decode producer state from MediaSoup API
   */
  decodeProducerState: S.decodeUnknown(DJProducerState),
  
  /**
   * Decode flow step updates
   */
  decodeFlowStep: S.decodeUnknown(DJFlowStep)
}

/**
 * DJ State Validators for runtime checks
 */
export const DJStateValidators = {
  /**
   * Validate DJ flow step
   */
  validateFlowStep: (step: unknown): step is DJFlowStepType => 
    S.is(DJFlowStep)(step),
  
  /**
   * Validate device state
   */
  validateDeviceState: (state: unknown): state is DJDeviceStateType => 
    S.is(DJDeviceState)(state),
  
  /**
   * Validate complete DJ state
   */
  validateDJState: (state: unknown): state is DJStateType => 
    S.is(DJState)(state)
}

/**
 * DJ Domain Errors (18-step flow)
 */
export class DJFlowError extends Data.TaggedError('DJFlowError')<{
  readonly cause: string
  readonly step: string
  readonly stepNumber: number
  readonly recoverable: boolean
  readonly operation: string
  readonly timestamp: Date
}> {}

export class MediaSoupDeviceError extends Data.TaggedError('MediaSoupDeviceError')<{
  readonly cause: string
  readonly operation: 'create' | 'load' | 'capabilities'
  readonly timestamp: Date
}> {}

export class AudioTrackError extends Data.TaggedError('AudioTrackError')<{
  readonly cause: string
  readonly operation: 'getUserMedia' | 'constraints' | 'track'
  readonly timestamp: Date
}> {}

export class TransportError extends Data.TaggedError('TransportError')<{
  readonly cause: string
  readonly transportId?: string
  readonly direction: 'send' | 'receive'
  readonly operation: 'create' | 'connect' | 'close'
  readonly timestamp: Date
}> {}

export class ProducerError extends Data.TaggedError('ProducerError')<{
  readonly cause: string
  readonly producerId?: string
  readonly operation: 'create' | 'pause' | 'resume' | 'close'
  readonly timestamp: Date
}> {}