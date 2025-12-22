/**
 * Room Domain Schema
 * 
 * Pure state definitions for room functionality including participants,
 * streaming status, room WebSocket connections.
 * 
 * This schema uses Effect Schema for validation and type safety.
 * NO service calls or side effects - pure data models only.
 */

import { Schema as S, Option, Data } from 'effect'

/**
 * Room Connection States (unified across DJ/Listener domains)
 */
export const RoomConnectionState = S.Literal(
  'IDLE',
  'CONNECTING', 
  'CONNECTED',
  'STREAMING',
  'PAUSED',
  'DISCONNECTING',
  'DISCONNECTED',
  'ERROR'
)
export type RoomConnectionStateType = S.Schema.Type<typeof RoomConnectionState>

/**
 * Connection State schema for Effect validation
 */
export const ConnectionStateSchema = RoomConnectionState

/**
 * Connection State enum for easy reference
 */
export enum ConnectionState {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING', 
  CONNECTED = 'CONNECTED',
  STREAMING = 'STREAMING',
  PAUSED = 'PAUSED',
  DISCONNECTING = 'DISCONNECTING',
  DISCONNECTED = 'DISCONNECTED',
  ERROR = 'ERROR'
}

/**
 * Room streaming status
 */
export const StreamingStatus = S.Literal(
  'idle',      // Room exists but no streaming
  'starting',  // DJ is setting up stream
  'streaming', // Active streaming
  'paused',    // Stream paused
  'stopping',  // Shutting down
  'error'      // Stream error
)
export type StreamingStatus = S.Schema.Type<typeof StreamingStatus>

/**
 * Room participant information
 */
export const RoomParticipant = S.Struct({
  id: S.String,
  type: S.Literal('dj', 'listener'),
  name: S.String,
  joinedAt: S.Date,
  isConnected: S.Boolean
})
export type RoomParticipant = S.Schema.Type<typeof RoomParticipant>

/**
 * Room WebSocket connection state
 */
export const RoomConnectionStateSchema = S.Struct({
  state: ConnectionStateSchema, // Use unified connection state schema
  websocket: S.Option(S.Unknown), // WebSocket instance
  roomId: S.Option(S.String),
  connectionType: S.Option(S.Literal('dj', 'listener')),
  lastConnectedAt: S.Option(S.Date),
  connectionAttempts: S.Number,
  lastError: S.Option(S.String)
})
export type RoomConnectionStateSchemaType = S.Schema.Type<typeof RoomConnectionStateSchema>

/**
 * Room metadata and status
 */
export const RoomMetadata = S.Struct({
  id: S.String,
  name: S.String,
  description: S.Option(S.String),
  djName: S.String,
  isPublic: S.Boolean,
  createdAt: S.Date,
  tags: S.Array(S.String)
})
export type RoomMetadataType = S.Schema.Type<typeof RoomMetadata>

// Export RoomInfo as UI-friendly type (flattened from Option types)
export type RoomInfo = {
  id: string
  name: string
  description?: string | null
  djName: string
  createdAt: Date
  tags: string[]
  listenerCount: number
}


/**
 * WebRTC Connection Status
 * 
 * Unified status that encompasses transport and DTLS state
 */
export enum WebRTCConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting', 
  CONNECTED = 'connected',
  FAILED = 'failed'
}

export const WebRTCConnectionStateSchema = S.Literal(
  'disconnected',
  'connecting',
  'connected', 
  'failed'
)

export const WebRTCError = S.Struct({
  type: S.Literal('transport_connection', 'producer_creation', 'device_initialization', 'unknown'),
  message: S.String,
  originalError: S.Option(S.Unknown)
})
export type WebRTCError = S.Schema.Type<typeof WebRTCError>

export const WebRTCStatus = S.Struct({
  status: WebRTCConnectionStateSchema,
  lastConnectedAt: S.Option(S.Date),
  error: S.Option(WebRTCError)
})
export type WebRTCStatus = S.Schema.Type<typeof WebRTCStatus>

/**
 * Room participants with embedded domain state
 * 
 * Direct embedding of DJ and Listeners with their complete MediaSoup state
 * as specified: "each room in the store/schema should contain the dj and the listeners directly"
 */
export const RoomParticipants = S.Struct({
  // Single DJ with complete MediaSoup state (device, transport, producer, streams, websocket)
  dj: S.Option(S.Unknown),
  
  // List of listeners with complete MediaSoup state (device, transport, consumer, streams, websocket)
  listeners: S.Array(S.Unknown),
  
  // Aggregate counts for UI display
  totalCount: S.Number,
  maxListeners: S.Option(S.Number)
})
export type RoomParticipants = S.Schema.Type<typeof RoomParticipants>

/**
 * Complete Room Domain State
 * 
 * Contains all state related to room functionality:
 * - WebSocket connection to room (includes unified connection state)
 * - Room metadata and status
 * - Participants tracking
 * - Streaming status
 * - Message history for debugging
 */
export const RoomState = S.Struct({
  // Connection state (includes unified ConnectionState in connection.state)
  connection: RoomConnectionStateSchema,
  
  // Room information
  metadata: S.Option(RoomMetadata),
  
  // Participants
  participants: RoomParticipants,
  
  // Streaming status
  streaming: S.Struct({
    status: StreamingStatus,
    startedAt: S.Option(S.Date),
    pausedAt: S.Option(S.Date),
    lastError: S.Option(S.String)
  }),
  
  // WebRTC connection status
  webrtcStatus: WebRTCStatus,
  
  // Active WebRTC connection timeout ID (only one per room)
  activeWebRTCTimeoutId: S.Option(S.Number),
  
  // Message history (for debugging)
  messageHistory: S.Array(S.Struct({
    timestamp: S.Date,
    type: S.String,
    message: S.Unknown
  })),
  
  // Last activity tracking
  lastActivityAt: S.Date
})
export type RoomState = S.Schema.Type<typeof RoomState>

/**
 * Initial room state factory
 */
export const createInitialRoomState = (): RoomState => ({
  connection: {
    state: ConnectionState.IDLE,
    websocket: Option.none(),
    roomId: Option.none(),
    connectionType: Option.none(),
    lastConnectedAt: Option.none(),
    connectionAttempts: 0,
    lastError: Option.none()
  },
  metadata: Option.none(),
  participants: {
    dj: Option.none(),
    listeners: [], // Array of ListenerState objects
    totalCount: 0,
    maxListeners: Option.none()
  },
  streaming: {
    status: 'idle',
    startedAt: Option.none(),
    pausedAt: Option.none(),
    lastError: Option.none()
  },
  webrtcStatus: {
    status: WebRTCConnectionState.DISCONNECTED,
    lastConnectedAt: Option.none(),
    error: Option.none()
  },
  activeWebRTCTimeoutId: Option.none(),
  messageHistory: [],
  lastActivityAt: new Date()
})

/**
 * Room state validators
 */
export const RoomStateValidators = {
  /**
   * Validate complete room state
   */
  validateRoomState: S.decodeUnknown(RoomState),
  
  /**
   * Validate connection state only
   */
  validateConnectionState: S.decodeUnknown(RoomConnectionStateSchema),
  
  /**
   * Validate room metadata only
   */
  validateMetadata: S.decodeUnknown(RoomMetadata),
  
  /**
   * Validate participants state only
   */
  validateParticipants: S.decodeUnknown(RoomParticipants),
  
  /**
   * Validate streaming status only
   */
  validateStreamingStatus: S.decodeUnknown(StreamingStatus)
}

/**
 * Room Domain Errors  
 */
export class RoomConnectionError extends Data.TaggedError('RoomConnectionError')<{
  readonly cause: string
  readonly roomId?: string
  readonly operation: string
  readonly timestamp: Date
}> {}

export class RoomJoinError extends Data.TaggedError('RoomJoinError')<{
  readonly cause: string
  readonly roomId: string
  readonly operation: string
  readonly timestamp: Date
}> {}

export class StreamingError extends Data.TaggedError('StreamingError')<{
  readonly cause: string
  readonly roomId?: string
  readonly operation: string
  readonly timestamp: Date
}> {}