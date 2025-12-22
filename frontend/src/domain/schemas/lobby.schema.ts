/**
 * Lobby Domain Schema
 * 
 * Pure state definitions for lobby functionality including room listings,
 * lobby WebSocket connections, and room discovery.
 * Uses shared schema patterns and proper external type synchronization.
 * 
 * Pattern: S.Schema.Type<> for store inference, S.Encoded vs S.Type for API boundaries
 */

import { Schema as S, Option, Data } from 'effect'
// Import WebSocketSchemas directly from websocket schema (infrastructure layer)
import { WebSocketSchemas } from './shared/websocket.schema'

/**
 * Lobby WebSocket Connection State (extends shared WebSocket pattern)
 */
export const LobbyWebSocketState = WebSocketSchemas.BaseConnection.pipe(
  S.extend(WebSocketSchemas.LobbyExtension)
)
export type LobbyWebSocketStateType = S.Schema.Type<typeof LobbyWebSocketState>

/**
 * Lobby Room Info (for room listings)
 */
export const LobbyRoomInfo = S.Struct({
  id: S.String,
  name: S.String,
  djName: S.String,
  description: S.Option(S.String),
  tags: S.Array(S.String),
  listenerCount: S.Number,
  isPublic: S.Boolean,
  isStreaming: S.Boolean,
  createdAt: S.DateFromString
})
export type LobbyRoomInfoType = S.Schema.Type<typeof LobbyRoomInfo>

/**
 * Room Discovery and Listings State
 */
export const LobbyRoomDiscoveryState = S.Struct({
  availableRooms: S.Record({ key: S.String, value: LobbyRoomInfo }),
  loading: S.Boolean,
  lastRefreshAt: S.Option(S.DateFromString),
  refreshError: S.Option(S.String),
  filters: S.Struct({
    searchTerm: S.Option(S.String),
    tags: S.Array(S.String),
    showOnlyStreaming: S.Boolean
  })
})
export type LobbyRoomDiscoveryStateType = S.Schema.Type<typeof LobbyRoomDiscoveryState>

/**
 * Room Creation State
 */
export const LobbyRoomCreationState = S.Struct({
  creating: S.Boolean,
  creationError: S.Option(S.String),
  lastCreatedRoomId: S.Option(S.String),
  formData: S.Option(S.Struct({
    name: S.String,
    description: S.Option(S.String),
    tags: S.Array(S.String),
    isPublic: S.Boolean
  }))
})
export type LobbyRoomCreationStateType = S.Schema.Type<typeof LobbyRoomCreationState>

/**
 * Complete Lobby Domain State
 * 
 * Uses S.Schema.Type<> pattern for store inference.
 * Store will use: createStore<LobbyStateType>(createInitialLobbyState())
 */
export const LobbyState = S.Struct({
  // WebSocket connection state
  websocket: LobbyWebSocketState,
  
  // Room discovery
  discovery: LobbyRoomDiscoveryState,
  
  // Room creation
  creation: LobbyRoomCreationState,
  
  // Message history (for debugging)
  messageHistory: S.Array(S.Struct({
    timestamp: S.DateFromString,
    type: S.String,
    direction: S.Literal('incoming', 'outgoing'),
    message: S.Record({ key: S.String, value: S.String })
  })),
  
  // Last activity tracking
  lastActivityAt: S.DateFromString
})
export type LobbyStateType = S.Schema.Type<typeof LobbyState>
export type LobbyStateEncoded = S.Schema.Encoded<typeof LobbyState>

/**
 * Initial Lobby state factory for stores
 * 
 * Returns clean application state (S.Schema.Type<> format)
 * Store pattern: const [lobbyState, setLobbyState] = createStore<LobbyStateType>(createInitialLobbyState())
 */
export const createInitialLobbyState = (): LobbyStateType => ({
  websocket: {
    websocket: Option.none(),
    connectionState: 'disconnected',
    url: Option.none(),
    connectedAt: Option.none(),
    lastMessageAt: Option.none(),
    messageCount: 0,
    connectionError: Option.none(),
    lastRoomListUpdate: Option.none(),
    subscriptionFilters: []
  },
  
  discovery: {
    availableRooms: {},
    loading: false,
    lastRefreshAt: Option.none(),
    refreshError: Option.none(),
    filters: {
      searchTerm: Option.none(),
      tags: [],
      showOnlyStreaming: false
    }
  },
  
  creation: {
    creating: false,
    creationError: Option.none(),
    lastCreatedRoomId: Option.none(),
    formData: Option.none()
  },
  
  messageHistory: [],
  lastActivityAt: new Date()
})

/**
 * Lobby State Decoders for Infrastructure Services
 * 
 * Use at API/WebSocket boundaries to validate incoming data
 */
export const LobbyStateDecoders = {
  /**
   * Decode complete Lobby state from API
   */
  decodeLobbyState: S.decodeUnknown(LobbyState),
  
  /**
   * Decode room info from room list updates
   */
  decodeLobbyRoomInfo: S.decodeUnknown(LobbyRoomInfo),
  
  /**
   * Decode discovery state from API
   */
  decodeDiscoveryState: S.decodeUnknown(LobbyRoomDiscoveryState),
  
  /**
   * Decode creation state updates
   */
  decodeCreationState: S.decodeUnknown(LobbyRoomCreationState)
}

/**
 * Lobby State Validators for runtime checks
 */
export const LobbyStateValidators = {
  /**
   * Validate lobby room info
   */
  validateRoomInfo: (info: unknown): info is LobbyRoomInfoType => 
    S.is(LobbyRoomInfo)(info),
  
  /**
   * Validate discovery state
   */
  validateDiscoveryState: (state: unknown): state is LobbyRoomDiscoveryStateType => 
    S.is(LobbyRoomDiscoveryState)(state),
  
  /**
   * Validate complete Lobby state
   */
  validateLobbyState: (state: unknown): state is LobbyStateType => 
    S.is(LobbyState)(state)
}

/**
 * Lobby Domain Errors
 */
export class LobbyConnectionError extends Data.TaggedError('LobbyConnectionError')<{
  readonly cause: string
  readonly operation: string
  readonly timestamp: Date
}> {}

export class RoomDiscoveryError extends Data.TaggedError('RoomDiscoveryError')<{
  readonly cause: string
  readonly operation: string
  readonly timestamp: Date
}> {}

export class RoomCreationError extends Data.TaggedError('RoomCreationError')<{
  readonly cause: string
  readonly roomName?: string
  readonly operation: string
  readonly timestamp: Date
}> {}