/**
 * Listener Domain Schema
 * 
 * Pure state definitions for Listener functionality following the 10-step listener connection flow.
 * Includes embedded MediaSoup state: Device, Receive Transport, Consumer, and audio elements.
 * 
 * This schema uses Effect Schema for validation and type safety.
 * NO service calls or side effects - pure data models only.
 * 
 * References: DJ_ROOM_CREATION_FLOW_HOW_ITS_SUPPOSED_TO_BE.md (Steps 1-10a, 6b-7b)
 */

import { Schema as S } from 'effect'
import { Option } from 'effect'
import { Device, types } from 'mediasoup-client'
import type { 
  RtpCapabilitiesWrapper, 
  TransportOptions
} from '../../services/generated/hushFMAPI.schemas'

/**
 * MediaSoup type schemas using proper type guards (like in DJ schema)
 */
const MediaSoupDevice = S.instanceOf(Device)
const MediaSoupTransport = S.Unknown.pipe(S.filter((value): value is types.Transport => 
  value != null && typeof value === 'object' && 'id' in value && 'connectionState' in value
))
const MediaSoupConsumer = S.Unknown.pipe(S.filter((value): value is types.Consumer => 
  value != null && typeof value === 'object' && 'id' in value && 'kind' in value && 'paused' in value
))

/**
 * Web API type schemas  
 */
const MediaStreamTrackSchema = S.instanceOf(MediaStreamTrack)
const HTMLAudioElementSchema = S.instanceOf(HTMLAudioElement)

/**
 * Wrapper type schemas (for API data structures)
 * These represent data from the backend API, not runtime objects
 */
const RtpCapabilitiesWrapperSchema = S.Unknown.pipe(S.filter((value): value is RtpCapabilitiesWrapper =>
  value != null && typeof value === 'object' && 'codecs' in value && 'headerExtensions' in value
))
const TransportOptionsSchema = S.Unknown.pipe(S.filter((value): value is TransportOptions =>
  value != null && typeof value === 'object' && 'id' in value && 'dtlsParameters' in value
))

/**
 * MediaSoup native type schemas (for runtime MediaSoup objects)
 * These use type guards since they're complex objects without instanceof
 */
const RtpCapabilitiesSchema = S.Unknown.pipe(S.filter((value): value is types.RtpCapabilities =>
  value != null && typeof value === 'object' && 'codecs' in value && 'headerExtensions' in value
))
const RtpParametersSchema = S.Unknown.pipe(S.filter((value): value is types.RtpParameters =>
  value != null && typeof value === 'object' && 'codecs' in value
))
const DtlsParametersSchema = S.Unknown.pipe(S.filter((value): value is types.DtlsParameters =>
  value != null && typeof value === 'object' && 'fingerprints' in value
))

/**
 * Listener Flow Steps (tracking progress through 10-step flow)
 */
export const ListenerFlowStep = S.Literal(
  'idle',                // Not started
  'requesting_join',     // Step 1: Request joining room from lobby
  'connecting',          // Step 1: Connecting to listener WebSocket
  'requesting_capabilities', // Step 2: Request router RTP capabilities from backend
  'waiting_transport',   // Step 4: Waiting for transport params from backend
  'creating_transport',  // Step 6: Create receive transport locally
  'validating_connection', // Step 6.5: Validate WebRTC connection before consumer creation
  'device_loading',      // Step 6: Loading MediaSoup device with RTP capabilities
  'sending_capabilities', // Step 7: Send device RTP capabilities to backend
  'waiting_consumer',    // Step 8: Backend checking canConsume
  'creating_consumer',   // Step 9a: Create consumer from params
  'connecting_transport', // Step 10a: Transport connect flow with DTLS
  'streaming',           // Step 11a: Media streaming successfully
  'error',               // Step 6b-7b: Router compatibility or other error
  'cleanup'              // Cleaning up after error or leave
)
export type ListenerFlowStep = S.Schema.Type<typeof ListenerFlowStep>

/**
 * MediaSoup Device State for Listener (Step 3: Create and load device with router capabilities)
 */
export const ListenerMediaSoupDeviceState = S.Struct({
  device: S.Option(MediaSoupDevice), // mediasoup-client Device instance
  loaded: S.Boolean,
  rtpCapabilities: S.Option(RtpCapabilitiesSchema), // Device RTP capabilities (native MediaSoup)
  routerRtpCapabilities: S.Option(RtpCapabilitiesWrapperSchema), // Router capabilities from API
  loadError: S.Option(S.String),
  handlerName: S.Option(S.String),
  canProduce: S.Boolean,
  canConsume: S.Boolean
})
export type ListenerMediaSoupDeviceState = S.Schema.Type<typeof ListenerMediaSoupDeviceState>

/**
 * Receive Transport State (Steps 2-3: Receive transport params and create transport)
 */
export const ReceiveTransportState = S.Struct({
  transport: S.Option(MediaSoupTransport), // mediasoup-client Transport instance
  id: S.Option(S.String),
  connectionState: S.Literal('new', 'connecting', 'connected', 'disconnecting', 'disconnected', 'failed'),
  iceGatheringState: S.Option(S.String),
  iceConnectionState: S.Option(S.String),
  dtlsState: S.Option(S.String),
  transportOptions: S.Option(TransportOptionsSchema), // Transport params from API
  dtlsParameters: S.Option(DtlsParametersSchema), // DTLS params (native MediaSoup)
  connected: S.Boolean,
  connectError: S.Option(S.String)
})
export type ReceiveTransportState = S.Schema.Type<typeof ReceiveTransportState>

/**
 * Consumer State (Steps 5-7a: Consumer creation and management)
 */
export const ConsumerState = S.Struct({
  consumer: S.Option(MediaSoupConsumer), // mediasoup-client Consumer instance
  id: S.Option(S.String),
  producerId: S.Option(S.String), // Producer ID from room
  kind: S.Literal('audio', 'video'),
  paused: S.Boolean,
  rtpParameters: S.Option(RtpParametersSchema), // RTP params (native MediaSoup)
  track: S.Option(MediaStreamTrackSchema), // MediaStreamTrack from consumer
  appData: S.Option(S.Record({ key: S.String, value: S.Any })), // Generic app data object
  stats: S.Option(S.Struct({
    timestamp: S.Date,
    bytesReceived: S.Number,
    packetsReceived: S.Number,
    packetsLost: S.Number,
    jitter: S.Number
  })),
  createdAt: S.Option(S.Date),
  error: S.Option(S.String)
})
export type ConsumerState = S.Schema.Type<typeof ConsumerState>

/**
 * Audio Playback State (for consumer audio)
 */
export const AudioPlaybackState = S.Struct({
  audioElement: S.Option(HTMLAudioElementSchema), // HTMLAudioElement instance
  mediaStream: S.Option(S.instanceOf(MediaStream)), // MediaStream from consumer
  volume: S.Number,
  muted: S.Boolean,
  playing: S.Boolean,
  autoplayBlocked: S.Boolean,
  lastPlayAttempt: S.Option(S.Date),
  playbackError: S.Option(S.String)
})
export type AudioPlaybackState = S.Schema.Type<typeof AudioPlaybackState>

/**
 * Connection Quality Metrics for Listener (includes packetsReceived)
 */
export const ListenerConnectionQuality = S.Struct({
  rtt: S.Number,
  packetsLost: S.Number,
  packetsReceived: S.Number,
  jitter: S.Number,
  timestamp: S.Date,
  quality: S.Literal('excellent', 'good', 'fair', 'poor')
})
export type ListenerConnectionQuality = S.Schema.Type<typeof ListenerConnectionQuality>

/**
 * WebSocket Connection State for Listener
 */
export const ListenerWebSocketState = S.Struct({
  websocket: S.Option(S.instanceOf(WebSocket)), // Listener WebSocket connection instance
  connectionState: S.Literal('disconnected', 'connecting', 'connected', 'error', 'reconnecting'),
  roomId: S.Option(S.String), // Room ID the listener is connected to
  url: S.Option(S.String),
  connectedAt: S.Option(S.Date),
  lastMessageAt: S.Option(S.Date),
  messageCount: S.Number,
  connectionError: S.Option(S.String)
})
export type ListenerWebSocketState = S.Schema.Type<typeof ListenerWebSocketState>

/**
 * Router Compatibility State (Steps 6b-7b: Error handling)
 */
export const RouterCompatibility = S.Struct({
  compatible: S.Boolean,
  checkedAt: S.Option(S.Date),
  incompatibilityReason: S.Option(S.String),
  canRetry: S.Boolean
})
export type RouterCompatibility = S.Schema.Type<typeof RouterCompatibility>

/**
 * Complete Listener Domain State
 * 
 * Contains all state for Listener functionality following the 10-step flow:
 * - Flow progress tracking
 * - MediaSoup Device (embedded)
 * - Receive Transport (embedded)
 * - Consumer (embedded) 
 * - Audio playback (embedded)
 * - WebSocket connection state
 * - Connection quality metrics
 * - Router compatibility tracking
 */
export const ListenerState = S.Struct({
  // Flow progress
  currentStep: ListenerFlowStep,
  stepStartedAt: S.Option(S.Date),
  stepError: S.Option(S.String),
  
  // MediaSoup Device (Step 3)
  device: ListenerMediaSoupDeviceState,
  
  // Receive Transport (Steps 2-3)
  receiveTransport: ReceiveTransportState,
  
  // Consumer (Steps 5-7a)
  consumer: ConsumerState,
  
  // Audio Playback (Step 10a)
  audioPlayback: AudioPlaybackState,
  
  // WebSocket connection state
  websocket: ListenerWebSocketState,
  
  // Router compatibility (Steps 6b-7b)
  routerCompatibility: RouterCompatibility,
  
  // Connection quality
  connectionQuality: S.Option(ListenerConnectionQuality),
  
  // Flow timing
  flowStartedAt: S.Option(S.Date),
  flowCompletedAt: S.Option(S.Date),
  
  // Error tracking
  lastError: S.Option(S.Struct({
    step: ListenerFlowStep,
    error: S.String,
    timestamp: S.Date,
    recoverable: S.Boolean
  }))
})
export type ListenerState = S.Schema.Type<typeof ListenerState>

/**
 * Initial Listener state factory
 */
export const createInitialListenerState = (): ListenerState => ({
  currentStep: 'idle',
  stepStartedAt: Option.none(),
  stepError: Option.none(),
  
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
  
  receiveTransport: {
    transport: Option.none(),
    id: Option.none(),
    connectionState: 'new',
    iceGatheringState: Option.none(),
    iceConnectionState: Option.none(),
    dtlsState: Option.none(),
    transportOptions: Option.none(),
    dtlsParameters: Option.none(),
    connected: false,
    connectError: Option.none()
  },
  
  consumer: {
    consumer: Option.none(),
    id: Option.none(),
    producerId: Option.none(),
    kind: 'audio',
    paused: false,
    rtpParameters: Option.none(),
    track: Option.none(),
    appData: Option.none(),
    stats: Option.none(),
    createdAt: Option.none(),
    error: Option.none()
  },
  
  audioPlayback: {
    audioElement: Option.none(),
    mediaStream: Option.none(),
    volume: 0.8,
    muted: false,
    playing: false,
    autoplayBlocked: false,
    lastPlayAttempt: Option.none(),
    playbackError: Option.none()
  },
  
  websocket: {
    websocket: Option.none(),
    connectionState: 'disconnected',
    roomId: Option.none(),
    url: Option.none(),
    connectedAt: Option.none(),
    lastMessageAt: Option.none(),
    messageCount: 0,
    connectionError: Option.none()
  },
  
  routerCompatibility: {
    compatible: true,
    checkedAt: Option.none(),
    incompatibilityReason: Option.none(),
    canRetry: true
  },
  
  connectionQuality: Option.none(),
  flowStartedAt: Option.none(),
  flowCompletedAt: Option.none(),
  lastError: Option.none()
})

/**
 * Listener state validators
 */
export const ListenerStateValidators = {
  /**
   * Validate complete Listener state
   */
  validateListenerState: S.decodeUnknown(ListenerState),
  
  /**
   * Validate device state only
   */
  validateDeviceState: S.decodeUnknown(ListenerMediaSoupDeviceState),
  
  /**
   * Validate receive transport state only
   */
  validateReceiveTransportState: S.decodeUnknown(ReceiveTransportState),
  
  /**
   * Validate consumer state only
   */
  validateConsumerState: S.decodeUnknown(ConsumerState),
  
  /**
   * Validate audio playback state only
   */
  validateAudioPlaybackState: S.decodeUnknown(AudioPlaybackState),
  
  /**
   * Validate flow step
   */
  validateFlowStep: S.decodeUnknown(ListenerFlowStep),
  
  /**
   * Validate router compatibility
   */
  validateRouterCompatibility: S.decodeUnknown(RouterCompatibility)
}

