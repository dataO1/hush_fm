/**
 * Listener Domain Schema
 * 
 * Pure state definitions for Listener functionality following the 10-step listener connection flow.
 * Uses shared schema patterns and proper external type synchronization.
 * 
 * Pattern: S.Schema.Type<> for store inference, S.Encoded vs S.Type for API boundaries
 * 
 * References: DJ_ROOM_CREATION_FLOW_HOW_ITS_SUPPOSED_TO_BE.md (Steps 1-10a, 6b-7b)
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
  MediaSoupConsumerSchema
} from './shared/mediasoup.schema'
// Import TransportOptionsSchema directly from websocket schema (infrastructure layer)
import { TransportOptionsSchema, WebSocketSchemas } from './shared/websocket.schema'


/**
 * Listener Flow Steps (10-step flow progression)
 */
export const ListenerFlowStep = S.Literal(
  'idle',                   // Not started
  'requesting_join',        // Step 1: Request joining room from lobby
  'connecting',             // Step 1: Connecting to listener WebSocket
  'requesting_capabilities', // Step 2: Request router RTP capabilities from backend
  'device_loading',         // Step 3: Loading MediaSoup device with capabilities
  'waiting_transport',      // Step 4: Waiting for transport params from backend
  'creating_transport',     // Step 6: Create receive transport locally
  'validating_connection',  // Step 6.5: Validate WebRTC connection
  'sending_capabilities',   // Step 7: Send device RTP capabilities to backend
  'waiting_consumer',       // Step 8: Backend checking canConsume
  'creating_consumer',      // Step 9a: Create consumer from params
  'connecting_transport',   // Step 10a: Transport connect flow with DTLS
  'streaming',              // Step 11a: Media streaming successfully
  'error',                  // Step 6b-7b: Router compatibility or other error
  'cleanup'                 // Cleaning up after error or leave
)
export type ListenerFlowStepType = S.Schema.Type<typeof ListenerFlowStep>

/**
 * Listener MediaSoup Device State (Step 3: Create and load device with router capabilities)
 */
export const ListenerDeviceState = S.Struct({
  device: S.Option(S.instanceOf(Device)),
  loaded: S.Boolean,
  rtpCapabilities: S.Option(RtpCapabilitiesSchema),
  routerRtpCapabilities: S.Option(RtpCapabilitiesSchema),
  loadError: S.Option(S.String),
  handlerName: S.Option(S.String),
  canProduce: S.Boolean,
  canConsume: S.Boolean
})
export type ListenerDeviceStateType = S.Schema.Type<typeof ListenerDeviceState>

/**
 * Listener Receive Transport State (Steps 2-3: Receive transport params and create transport)
 */
export const ListenerReceiveTransportState = S.Struct({
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
export type ListenerReceiveTransportStateType = S.Schema.Type<typeof ListenerReceiveTransportState>

/**
 * Listener Consumer State (Steps 5-7a: Consumer creation and management)
 */
export const ListenerConsumerState = S.Struct({
  consumer: S.Option(MediaSoupConsumerSchema),
  id: S.Option(S.String),
  producerId: S.Option(S.String),
  kind: S.Literal('audio', 'video'),
  paused: S.Boolean,
  rtpParameters: S.Option(RtpParametersSchema),
  track: S.Option(WebAPISchemas.MediaStreamTrack),
  appData: S.Option(S.Record({ key: S.String, value: S.String })),
  // Stats removed - not needed
  createdAt: S.Option(S.DateFromString),
  error: S.Option(S.String)
})
export type ListenerConsumerStateType = S.Schema.Type<typeof ListenerConsumerState>

/**
 * Listener Audio Playback State (for consumer audio)
 */
export const ListenerAudioPlaybackState = S.Struct({
  audioElement: S.Option(WebAPISchemas.HTMLAudioElement),
  mediaStream: S.Option(WebAPISchemas.MediaStream),
  volume: S.Number,
  muted: S.Boolean,
  playing: S.Boolean,
  autoplayBlocked: S.Boolean,
  lastPlayAttempt: S.Option(S.DateFromString),
  playbackError: S.Option(S.String)
})
export type ListenerAudioPlaybackStateType = S.Schema.Type<typeof ListenerAudioPlaybackState>

/**
 * Listener Media Streams State (remote streams from consumer)
 */
export const ListenerMediaStreamsState = S.Struct({
  remoteStream: S.Option(WebAPISchemas.MediaStream),
  audioTrack: S.Option(WebAPISchemas.MediaStreamTrack),
  streamId: S.Option(S.String),
  createdAt: S.Option(S.DateFromString)
})
export type ListenerMediaStreamsStateType = S.Schema.Type<typeof ListenerMediaStreamsState>

/**
 * Listener WebSocket Connection State (extends shared WebSocket pattern)
 */
export const ListenerWebSocketState = WebSocketSchemas.BaseConnection.pipe(
  S.extend(WebSocketSchemas.ListenerExtension)
)
export type ListenerWebSocketStateType = S.Schema.Type<typeof ListenerWebSocketState>

/**
 * Listener Router Compatibility State (Steps 6b-7b: Error handling)
 */
export const ListenerRouterCompatibility = S.Struct({
  compatible: S.Boolean,
  checkedAt: S.Option(S.DateFromString),
  incompatibilityReason: S.Option(S.String),
  canRetry: S.Boolean
})
export type ListenerRouterCompatibilityType = S.Schema.Type<typeof ListenerRouterCompatibility>

/**
 * Complete Listener Domain State
 * 
 * Uses S.Schema.Type<> pattern for store inference.
 * Store will use: createStore<ListenerStateType>(createInitialListenerState())
 */
export const ListenerState = MultiStepFlowSchemas.State.pipe(
  S.extend(S.Struct({
    // Override currentStep with Listener-specific steps
    currentStep: ListenerFlowStep,
    
    // Listener-specific embedded state
    device: ListenerDeviceState,
    receiveTransport: S.Option(ListenerReceiveTransportState),
    consumer: S.Option(ListenerConsumerState),
    audioPlayback: S.Option(ListenerAudioPlaybackState),
    streams: S.Option(ListenerMediaStreamsState),
    websocket: ListenerWebSocketState,
    
    // Router compatibility (Steps 6b-7b)
    routerCompatibility: ListenerRouterCompatibility,
    
    // Note: Connection quality removed - not needed
  }))
)
export type ListenerStateType = S.Schema.Type<typeof ListenerState>
export type ListenerStateEncoded = S.Schema.Encoded<typeof ListenerState>

/**
 * Initial Listener state factory for stores
 * 
 * Returns clean application state (S.Schema.Type<> format)
 * Store pattern: const [listenerState, setListenerState] = createStore<ListenerStateType>(createInitialListenerState())
 */
export const createInitialListenerState = (): ListenerStateType => ({
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
    routerRtpCapabilities: Option.none(),
    loadError: Option.none(),
    handlerName: Option.none(),
    canProduce: false,
    canConsume: false
  },
  
  receiveTransport: Option.none(),
  consumer: Option.none(),
  audioPlayback: Option.none(),
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
    sessionId: '',
    listeningStartedAt: Option.none(),
    consumerIds: []
  },
  
  routerCompatibility: {
    compatible: true,
    checkedAt: Option.none(),
    incompatibilityReason: Option.none(),
    canRetry: true
  },
  
  // Connection quality removed - not needed
})

/**
 * Listener State Decoders for Infrastructure Services
 * 
 * Use at API/WebSocket boundaries to validate incoming data
 */
export const ListenerStateDecoders = {
  /**
   * Decode complete Listener state from API
   */
  decodeListenerState: S.decodeUnknown(ListenerState),
  
  /**
   * Decode device state from MediaSoup API
   */
  decodeDeviceState: S.decodeUnknown(ListenerDeviceState),
  
  /**
   * Decode receive transport state from MediaSoup API
   */
  decodeReceiveTransportState: S.decodeUnknown(ListenerReceiveTransportState),
  
  /**
   * Decode consumer state from MediaSoup API
   */
  decodeConsumerState: S.decodeUnknown(ListenerConsumerState),
  
  /**
   * Decode audio playback state
   */
  decodeAudioPlaybackState: S.decodeUnknown(ListenerAudioPlaybackState),
  
  /**
   * Decode flow step updates
   */
  decodeFlowStep: S.decodeUnknown(ListenerFlowStep)
}

/**
 * Listener State Validators for runtime checks
 */
export const ListenerStateValidators = {
  /**
   * Validate Listener flow step
   */
  validateFlowStep: (step: unknown): step is ListenerFlowStepType => 
    S.is(ListenerFlowStep)(step),
  
  /**
   * Validate device state
   */
  validateDeviceState: (state: unknown): state is ListenerDeviceStateType => 
    S.is(ListenerDeviceState)(state),
  
  /**
   * Validate complete Listener state
   */
  validateListenerState: (state: unknown): state is ListenerStateType => 
    S.is(ListenerState)(state)
}

/**
 * Listener Domain Errors (10-step flow)
 */
export class ListenerFlowError extends Data.TaggedError('ListenerFlowError')<{
  readonly cause: string
  readonly step: string
  readonly stepNumber: number
  readonly recoverable: boolean
  readonly operation: string
  readonly timestamp: Date
}> {}

export class ConsumerError extends Data.TaggedError('ConsumerError')<{
  readonly cause: string
  readonly consumerId?: string
  readonly producerId?: string
  readonly operation: 'create' | 'pause' | 'resume' | 'close'
  readonly timestamp: Date
}> {}

export class AudioPlaybackError extends Data.TaggedError('AudioPlaybackError')<{
  readonly cause: string
  readonly operation: 'play' | 'pause' | 'volume' | 'autoplay'
  readonly autoplayBlocked: boolean
  readonly timestamp: Date
}> {}

export class RouterCompatibilityError extends Data.TaggedError('RouterCompatibilityError')<{
  readonly cause: string
  readonly deviceCapabilities?: unknown
  readonly routerCapabilities?: unknown
  readonly timestamp: Date
}> {}

