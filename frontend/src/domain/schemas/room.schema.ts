/**
 * Room Domain Schema
 * 
 * Pure state definitions for room functionality including participants,
 * streaming status, room WebSocket connections.
 * 
 * This schema uses Effect Schema for validation and type safety.
 * NO service calls or side effects - pure data models only.
 */

import { Schema as S } from 'effect'
import { Option } from 'effect'
import { DJState } from './dj.schema'
import { ListenerState } from './listener.schema'

/**
 * Unified Connection State for Room
 * 
 * Replaces complex state derivation from DJ/Listener flow steps.
 * Single source of truth for all connection status display.
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
 * Connection State schema for Effect validation
 */
export const ConnectionStateSchema = S.Literal(
  'IDLE',
  'CONNECTING', 
  'CONNECTED',
  'STREAMING',
  'PAUSED',
  'DISCONNECTED',
  'ERROR'
)

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
export const RoomConnectionState = S.Struct({
  state: ConnectionStateSchema, // Use unified connection state schema
  websocket: S.Option(S.Unknown), // WebSocket instance
  roomId: S.Option(S.String),
  connectionType: S.Option(S.Literal('dj', 'listener')),
  lastConnectedAt: S.Option(S.Date),
  connectionAttempts: S.Number,
  lastError: S.Option(S.String)
})
export type RoomConnectionState = S.Schema.Type<typeof RoomConnectionState>

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
export type RoomMetadata = S.Schema.Type<typeof RoomMetadata>

/**
 * Room participants with embedded domain state
 * 
 * Direct embedding of DJ and Listeners with their complete MediaSoup state
 * as specified: "each room in the store/schema should contain the dj and the listeners directly"
 */
export const RoomParticipants = S.Struct({
  // Single DJ with complete MediaSoup state (device, transport, producer, streams, websocket)
  dj: S.Option(DJState),
  
  // List of listeners with complete MediaSoup state (device, transport, consumer, streams, websocket)
  listeners: S.Array(ListenerState),
  
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
  connection: RoomConnectionState,
  
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
  validateConnectionState: S.decodeUnknown(RoomConnectionState),
  
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