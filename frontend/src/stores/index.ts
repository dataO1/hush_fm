/**
 * Stores Index
 * 
 * Centralized exports for domain-separated reactive stores.
 * Each store manages a single domain with focused responsibilities.
 * 
 * New Architecture (Domain-Driven Design):
 * - Connection Store: Pure connection state management
 * - WebRTC Store: WebRTC transport status and errors
 * - Room Metadata Store: Room information and streaming status
 * - DJ Store: Self-contained DJ state with MediaSoup
 * - Listeners Store: Collection of listener states with MediaSoup
 * - Lobby Store: Lobby WebSocket + room discovery
 * - User Store: User session and authentication state
 * 
 * Benefits:
 * - Fine-grained reactivity per domain
 * - No cross-references between stores
 * - Better performance through focused updates
 * - Easier testing and maintenance
 */

// Domain-separated stores
export * from './connection.store'
export * from './webrtc.store'
export * from './room-metadata.store'
export * from './dj.store'
export * from './listeners.store'

// Existing stores (to be migrated)
export * from './lobby.store'
export * from './user.store'

// Legacy room store removed - migration complete