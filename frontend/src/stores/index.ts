/**
 * Store Adapters Index
 * 
 * Central export point for all store adapters.
 * Services and UI components import adapters through this index.
 * Store implementations remain encapsulated within their folders.
 */

// Re-export all adapters and their live layers
export { AudioAdapter, AudioAdapterLive } from './audio'
export { ConnectionAdapter, ConnectionAdapterLive } from './connection'
export { LobbyAdapter, LobbyAdapterLive } from './lobby'
export { UserAdapter, UserAdapterLive } from './user'