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
 * Complete Lobby Domain State
 *
 * Uses S.Schema.Type<> pattern for store inference.
 * Store will use: createStore<LobbyStateType>(createInitialLobbyState())
 */
export const LobbyState = S.Struct({
  rooms: S.Array(LobbyRoomInfo),
  loading: S.Boolean,
  creatingRoom: S.Boolean,
  creationError: S.Option(S.String),
  lastCreatedRoomId: S.Option(S.String)
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
  rooms: [],
  loading: false,
  creatingRoom: false,
  creationError: Option.none(),
  lastCreatedRoomId: Option.none()
})


export class RoomCreationError extends Data.TaggedError('RoomCreationError')<{
  readonly cause: string
  readonly roomName?: string
  readonly operation: string
  readonly timestamp: Date
}> {}
