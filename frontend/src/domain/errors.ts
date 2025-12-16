/**
 * Domain-Specific Errors
 * 
 * Tagged errors for different domain areas using Effect's error handling patterns.
 * These errors provide structured error handling across the application.
 */

import { Data } from 'effect'

/**
 * Base domain error with context
 */
export interface DomainErrorContext {
  timestamp: Date
  operation: string
  details?: Record<string, unknown>
}

/**
 * Lobby Domain Errors
 */
export class LobbyConnectionError extends Data.TaggedError('LobbyConnectionError')<{
  readonly cause: string
  readonly context: DomainErrorContext
}> {}

export class RoomDiscoveryError extends Data.TaggedError('RoomDiscoveryError')<{
  readonly cause: string
  readonly context: DomainErrorContext
}> {}

export class RoomCreationError extends Data.TaggedError('RoomCreationError')<{
  readonly cause: string
  readonly roomName?: string
  readonly context: DomainErrorContext
}> {}

/**
 * Room Domain Errors  
 */
export class RoomConnectionError extends Data.TaggedError('RoomConnectionError')<{
  readonly cause: string
  readonly roomId?: string
  readonly context: DomainErrorContext
}> {}

export class RoomJoinError extends Data.TaggedError('RoomJoinError')<{
  readonly cause: string
  readonly roomId: string
  readonly context: DomainErrorContext
}> {}

export class StreamingError extends Data.TaggedError('StreamingError')<{
  readonly cause: string
  readonly roomId?: string
  readonly context: DomainErrorContext
}> {}

/**
 * DJ Domain Errors (18-step flow)
 */
export class DJFlowError extends Data.TaggedError('DJFlowError')<{
  readonly cause: string
  readonly step: string
  readonly stepNumber: number
  readonly recoverable: boolean
  readonly context: DomainErrorContext
}> {}

export class MediaSoupDeviceError extends Data.TaggedError('MediaSoupDeviceError')<{
  readonly cause: string
  readonly operation: 'create' | 'load' | 'capabilities'
  readonly context: DomainErrorContext
}> {}

export class AudioTrackError extends Data.TaggedError('AudioTrackError')<{
  readonly cause: string
  readonly operation: 'getUserMedia' | 'constraints' | 'track'
  readonly context: DomainErrorContext
}> {}

export class TransportError extends Data.TaggedError('TransportError')<{
  readonly cause: string
  readonly transportId?: string
  readonly direction: 'send' | 'receive'
  readonly operation: 'create' | 'connect' | 'close'
  readonly context: DomainErrorContext
}> {}

export class ProducerError extends Data.TaggedError('ProducerError')<{
  readonly cause: string
  readonly producerId?: string
  readonly operation: 'create' | 'pause' | 'resume' | 'close'
  readonly context: DomainErrorContext
}> {}

/**
 * Listener Domain Errors (10-step flow)
 */
export class ListenerFlowError extends Data.TaggedError('ListenerFlowError')<{
  readonly cause: string
  readonly step: string
  readonly stepNumber: number
  readonly recoverable: boolean
  readonly context: DomainErrorContext
}> {}

export class ConsumerError extends Data.TaggedError('ConsumerError')<{
  readonly cause: string
  readonly consumerId?: string
  readonly producerId?: string
  readonly operation: 'create' | 'pause' | 'resume' | 'close'
  readonly context: DomainErrorContext
}> {}

export class AudioPlaybackError extends Data.TaggedError('AudioPlaybackError')<{
  readonly cause: string
  readonly operation: 'play' | 'pause' | 'volume' | 'autoplay'
  readonly autoplayBlocked: boolean
  readonly context: DomainErrorContext
}> {}

export class RouterCompatibilityError extends Data.TaggedError('RouterCompatibilityError')<{
  readonly cause: string
  readonly deviceCapabilities?: unknown
  readonly routerCapabilities?: unknown
  readonly context: DomainErrorContext
}> {}

/**
 * WebSocket Domain Errors
 */
export class WebSocketConnectionError extends Data.TaggedError('WebSocketConnectionError')<{
  readonly cause: string
  readonly url: string
  readonly connectionType: 'lobby' | 'room'
  readonly context: DomainErrorContext
}> {}

export class WebSocketMessageError extends Data.TaggedError('WebSocketMessageError')<{
  readonly cause: string
  readonly messageType?: string
  readonly direction: 'send' | 'receive'
  readonly context: DomainErrorContext
}> {}

/**
 * Validation Errors
 */
export class StateValidationError extends Data.TaggedError('StateValidationError')<{
  readonly cause: string
  readonly schema: string
  readonly invalidData?: unknown
  readonly context: DomainErrorContext
}> {}

/**
 * Network Errors
 */
export class NetworkError extends Data.TaggedError('NetworkError')<{
  readonly cause: string
  readonly operation: string
  readonly url?: string
  readonly statusCode?: number
  readonly context: DomainErrorContext
}> {}

/**
 * Error factory functions for common error creation patterns
 */
export const ErrorFactories = {
  /**
   * Create lobby connection error
   */
  lobbyConnectionError: (cause: string, operation: string, details?: Record<string, unknown>) =>
    new LobbyConnectionError({
      cause,
      context: {
        timestamp: new Date(),
        operation,
        details
      }
    }),

  /**
   * Create DJ flow error
   */
  djFlowError: (cause: string, step: string, stepNumber: number, recoverable: boolean = true, details?: Record<string, unknown>) =>
    new DJFlowError({
      cause,
      step,
      stepNumber,
      recoverable,
      context: {
        timestamp: new Date(),
        operation: `dj_flow_step_${stepNumber}`,
        details
      }
    }),

  /**
   * Create listener flow error
   */
  listenerFlowError: (cause: string, step: string, stepNumber: number, recoverable: boolean = true, details?: Record<string, unknown>) =>
    new ListenerFlowError({
      cause,
      step,
      stepNumber,
      recoverable,
      context: {
        timestamp: new Date(),
        operation: `listener_flow_step_${stepNumber}`,
        details
      }
    }),

  /**
   * Create transport error
   */
  transportError: (cause: string, direction: 'send' | 'receive', operation: 'create' | 'connect' | 'close', transportId?: string, details?: Record<string, unknown>) =>
    new TransportError({
      cause,
      transportId,
      direction,
      operation,
      context: {
        timestamp: new Date(),
        operation: `transport_${direction}_${operation}`,
        details
      }
    }),

  /**
   * Create router compatibility error
   */
  routerCompatibilityError: (cause: string, deviceCapabilities?: unknown, routerCapabilities?: unknown, details?: Record<string, unknown>) =>
    new RouterCompatibilityError({
      cause,
      deviceCapabilities,
      routerCapabilities,
      context: {
        timestamp: new Date(),
        operation: 'router_compatibility_check',
        details
      }
    }),

  /**
   * Create WebSocket connection error
   */
  webSocketConnectionError: (cause: string, url: string, connectionType: 'lobby' | 'room', operation: string, details?: Record<string, unknown>) =>
    new WebSocketConnectionError({
      cause,
      url,
      connectionType,
      context: {
        timestamp: new Date(),
        operation,
        details
      }
    })
}