/**
 * Shared Schema Foundation
 * 
 * Centralized exports for all shared schemas and external type synchronizations.
 * These schemas eliminate duplication and provide strict typing with external libraries.
 * 
 * NOTE: WebSocket schemas are NOT exported here as they are internal to the infrastructure layer
 * for transforming backend WebSocket commands/events. Domain schemas should not depend on them.
 */

// External Library Type Synchronizations
export * from './mediasoup.schema'
export * from './webapi.schema'

// Domain-Specific Shared Patterns
export * from './dj-listener-flows.schema'
export * from './input-validation.schema'