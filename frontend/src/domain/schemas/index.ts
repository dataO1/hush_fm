/**
 * Domain Schemas Index
 * 
 * Centralized exports for all domain schemas and their validators.
 */

// Shared Foundation Schemas
export * from './shared'

// User Domain
export * from './user.schema'

// Lobby Domain
export * from './lobby.schema'

// Room Domain  
export * from './room.schema'

// DJ Domain (18-step flow)
export * from './dj.schema'

// Listener Domain (10-step flow)
export * from './listener.schema'