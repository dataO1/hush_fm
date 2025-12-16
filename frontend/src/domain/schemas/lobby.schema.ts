/**
 * Lobby Domain Schema
 * 
 * Pure state definitions for lobby functionality including room listings,
 * lobby WebSocket connections, and room discovery.
 * 
 * This schema uses Effect Schema for validation and type safety.
 * NO service calls or side effects - pure data models only.
 */

import { Schema as S } from 'effect'
import { Option } from 'effect'

/**
 * WebSocket connection states
 */
export const WSConnectionState = S.Literal(
  'disconnected',
  'connecting', 
  'connected',
  'error',
  'reconnecting'
)
export type WSConnectionState = S.Schema.Type<typeof WSConnectionState>

/**
 * Lobby WebSocket connection state
 */
export const LobbyConnectionState = S.Struct({
  state: WSConnectionState,
  websocket: S.Option(S.instanceOf(WebSocket)), // WebSocket instance
  lastConnectedAt: S.Option(S.Date),
  connectionAttempts: S.Number,
  lastError: S.Option(S.String)
})
export type LobbyConnectionState = S.Schema.Type<typeof LobbyConnectionState>

/**
 * Room discovery and listings state
 */
export const RoomDiscoveryState = S.Struct({
  availableRooms: S.Array(S.Unknown), // RoomInfo[] - using unknown to avoid circular import
  loading: S.Boolean,
  lastRefreshAt: S.Option(S.Date),
  refreshError: S.Option(S.String)
})
export type RoomDiscoveryState = S.Schema.Type<typeof RoomDiscoveryState>

/**
 * Room creation state
 */
export const RoomCreationState = S.Struct({
  creating: S.Boolean,
  creationError: S.Option(S.String),
  lastCreatedRoomId: S.Option(S.String)
})
export type RoomCreationState = S.Schema.Type<typeof RoomCreationState>

/**
 * Complete Lobby Domain State
 * 
 * Contains all state related to lobby functionality:
 * - WebSocket connection to lobby
 * - Room discovery and listings  
 * - Room creation flow
 * - Message history for debugging
 */
export const LobbyState = S.Struct({
  // Connection state
  connection: LobbyConnectionState,
  
  // Room discovery
  discovery: RoomDiscoveryState,
  
  // Room creation
  creation: RoomCreationState,
  
  // Message history (for debugging)
  messageHistory: S.Array(S.Struct({
    timestamp: S.Date,
    type: S.String,
    message: S.Unknown
  })),
  
  // Last activity tracking
  lastActivityAt: S.Date
})
export type LobbyState = S.Schema.Type<typeof LobbyState>

/**
 * Initial lobby state factory
 */
export const createInitialLobbyState = (): LobbyState => ({
  connection: {
    state: 'disconnected',
    websocket: Option.none(),
    lastConnectedAt: Option.none(),
    connectionAttempts: 0,
    lastError: Option.none()
  },
  discovery: {
    availableRooms: [],
    loading: false,
    lastRefreshAt: Option.none(),
    refreshError: Option.none()
  },
  creation: {
    creating: false,
    creationError: Option.none(),
    lastCreatedRoomId: Option.none()
  },
  messageHistory: [],
  lastActivityAt: new Date()
})

/**
 * Lobby state validators
 */
export const LobbyStateValidators = {
  /**
   * Validate complete lobby state
   */
  validateLobbyState: S.decodeUnknown(LobbyState),
  
  /**
   * Validate connection state only
   */
  validateConnectionState: S.decodeUnknown(LobbyConnectionState),
  
  /**
   * Validate room discovery state only  
   */
  validateDiscoveryState: S.decodeUnknown(RoomDiscoveryState),
  
  /**
   * Validate room creation state only
   */
  validateCreationState: S.decodeUnknown(RoomCreationState)
}