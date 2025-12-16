/**
 * Stores Index
 * 
 * Centralized exports for the 2 main reactive stores.
 * These stores bridge between pure domain schemas and the UI.
 * 
 * Architecture:
 * - Lobby Store: Lobby WebSocket + room discovery (basic RoomInfo[])
 * - Room Store: Current room with DJ + Listeners (embedded MediaSoup state)
 */

// Main stores (only 2)
export * from './lobby.store'
export * from './room.store'