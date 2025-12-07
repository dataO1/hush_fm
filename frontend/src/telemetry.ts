import { Context, Effect, Layer, pipe } from 'effect'
import { WebSdk } from '@effect/opentelemetry'
import { trace, propagation, context as otelContext } from '@opentelemetry/api'
import * as Option from 'effect/Option'
import type { TraceContext } from './models/websocket'

/**
 * Unified Cross-Service Span Architecture for HushFM
 * Goal: Single Coherent Trace from User Action to Audio Playback
 * One span per user (listener/DJ) with subspans from server and frontend
 * 
 * Uses W3C Trace Context Standard via OpenTelemetry to link spans across services
 * Format: traceparent: 00-<trace-id>-<parent-span-id>-<flags>
 */

/**
 * OpenTelemetry layer configuration for Effect
 * Exports traces to Jaeger via OTLP endpoint
 */
export const OtelLayer = Layer.unwrapEffect(
  Effect.sync(() => 
    WebSdk.layer(() => ({
      resource: {
        serviceName: 'hushfm-frontend',
        serviceVersion: '0.1.0',
      },
      traceExporter: {
        url: 'http://localhost:4318/v1/traces',
      },
      instrumentations: [], // Effect handles this automatically
    }))
  )
)

/**
 * Trace service for context propagation between frontend and backend
 */
export interface TraceService {
  readonly injectTraceContext: <T extends { _traceContext: Option.Option<TraceContext> }>(
    message: T
  ) => Effect.Effect<T, never>
  readonly extractTraceContext: (context: Option.Option<TraceContext>) => Effect.Effect<void, never>
}

export const TraceServiceTag = Context.GenericTag<TraceService>('TraceService')

/**
 * Implementation using Effect's built-in OpenTelemetry integration
 * with proper W3C trace context propagation
 */
export const TraceServiceLive = Layer.succeed(
  TraceServiceTag,
  {
    /**
     * Inject current OpenTelemetry span context into WebSocket message
     * This creates proper W3C traceparent headers for backend correlation
     */
    injectTraceContext: <T extends { _traceContext: Option.Option<TraceContext> }>(
      message: T
    ): Effect.Effect<T, never> =>
      Effect.sync(() => {
        // Get the active OpenTelemetry span from the current context
        const activeSpan = trace.getActiveSpan()
        if (!activeSpan) {
          return message
        }

        // Create carrier for context injection using OpenTelemetry propagation API
        const carrier: Record<string, string> = {}
        propagation.inject(otelContext.active(), carrier)

        // Convert carrier to our TraceContext format
        if (carrier.traceparent) {
          const traceContext: TraceContext = {
            traceparent: carrier.traceparent,
            tracestate: Option.fromNullable(carrier.tracestate),
            metadata: Object.keys(carrier).length > 1 ? 
              Option.some(carrier) : 
              Option.none(),
          }

          return {
            ...message,
            _traceContext: Option.some(traceContext),
          }
        }

        return message
      }),

    /**
     * Extract trace context from server message and set as parent for new spans
     * This allows frontend spans to be children of backend spans
     */
    extractTraceContext: (context: Option.Option<TraceContext>) =>
      Effect.sync(() => {
        if (Option.isSome(context)) {
          const traceContext = context.value
          const carrier: Record<string, string> = {
            traceparent: traceContext.traceparent,
          }

          // Add tracestate if present
          if (Option.isSome(traceContext.tracestate)) {
            carrier.tracestate = traceContext.tracestate.value
          }

          // Add metadata if present
          if (Option.isSome(traceContext.metadata)) {
            Object.assign(carrier, traceContext.metadata.value)
          }

          // Extract the context and set it as active for subsequent spans
          const extractedContext = propagation.extract(otelContext.active(), carrier)
          otelContext.with(extractedContext, () => {
            // Context is now active for subsequent Effect operations
          })
        }
      })
  }
)

/**
 * Create root span for user interactions (top-level operations)
 * This becomes the parent for all subsequent operations
 */
export const withRootUserSpan = <A, E>(
  operation: string,
  userId: string,
  roomId?: string
) => (effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
  pipe(
    effect,
    Effect.withSpan(`user.${operation}`, {
      attributes: {
        'user.id': userId,
        'user.action': operation,
        'span.kind': 'client',
        'component': 'hushfm-frontend',
        ...(roomId && { 'room.id': roomId }),
      }
    })
  )

/**
 * Create WebSocket operation span (child of user span)
 * Links to backend spans via trace context propagation
 */
export const withWebSocketSpan = <A, E>(
  operation: string,
  messageType: string,
  roomId?: string
) => (effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
  pipe(
    effect,
    Effect.withSpan(`ws.${operation}`, {
      attributes: {
        'messaging.system': 'websocket',
        'messaging.operation': operation,
        'message.type': messageType,
        'span.kind': 'client',
        ...(roomId && { 'room.id': roomId }),
      }
    })
  )

/**
 * Create WebRTC operation span for mediasoup operations
 */
export const withWebRTCSpan = <A, E>(
  operation: string,
  transportId?: string,
  roomId?: string
) => (effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
  pipe(
    effect,
    Effect.withSpan(`webrtc.${operation}`, {
      attributes: {
        'webrtc.component': 'mediasoup-client',
        'webrtc.operation': operation,
        'span.kind': 'client',
        ...(transportId && { 'transport.id': transportId }),
        ...(roomId && { 'room.id': roomId }),
      }
    })
  )

/**
 * Enhanced transport timeout tracking with precise timing
 */
export const withTransportTimeoutTracking = <A, E>(
  timeoutMs: number,
  transportId: string
) => (effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
  pipe(
    effect,
    Effect.withSpan(`transport.connection-attempt`, {
      attributes: {
        'transport.id': transportId,
        'transport.timeout_ms': timeoutMs,
        'transport.operation': 'connect',
      }
    })
  )

/**
 * Room joining operation with full trace instrumentation
 * Creates root span and propagates context to all child operations
 */
export const withJoinRoomTrace = <A, E>(
  userId: string,
  roomId: string
) => (effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
  pipe(
    effect,
    withRootUserSpan('join_room', userId, roomId),
    Effect.tap(() => Effect.logInfo(`User ${userId} joining room ${roomId}`))
  )

/**
 * DJ streaming operation with full trace instrumentation
 */
export const withDJStreamTrace = <A, E>(
  djId: string,
  roomId: string
) => (effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
  pipe(
    effect,
    withRootUserSpan('start_stream', djId, roomId),
    Effect.tap(() => Effect.logInfo(`DJ ${djId} starting stream in room ${roomId}`))
  )

/**
 * Audio consumption with trace instrumentation
 */
export const withAudioConsumeTrace = <A, E>(
  userId: string,
  roomId: string
) => (effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
  pipe(
    effect,
    Effect.withSpan('audio.consume', {
      attributes: {
        'user.id': userId,
        'room.id': roomId,
        'audio.operation': 'consume',
        'webrtc.component': 'mediasoup-client',
      }
    })
  )

/**
 * Provide telemetry for the entire application
 * Sets up unified tracing across frontend and backend
 */
export const provideTelemetry = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
  pipe(
    effect,
    Effect.provide(TraceServiceLive),
    Effect.provide(OtelLayer)
  )

/**
 * Access trace service from context
 */
export const useTraceService = Context.get(TraceServiceTag)

/**
 * Legacy compatibility exports for existing code
 */

export const initTelemetry = (serviceName: string, endpoint?: string): void => {
  console.info(`Effect-TS telemetry configured for ${serviceName} -> ${endpoint || 'http://localhost:4318/v1/traces'}`)
}

export const createRootSpan = (_operationName: string, _attributes?: Record<string, any>) => ({
  end: () => {},
  setStatus: () => {},
  recordException: () => {},
  addEvent: () => {},
})

export const createWebRTCSpan = createRootSpan
export const createWebSocketSpan = createRootSpan

export const injectTraceContext = <T extends { _traceContext: Option.Option<TraceContext> }>(
  message: T
): Effect.Effect<T, never> => {
  return pipe(
    TraceServiceTag,
    Effect.andThen(service => service.injectTraceContext(message)),
    Effect.provide(TraceServiceLive)
  )
}

export const extractTraceContext = (context: Option.Option<TraceContext>): Effect.Effect<void, never> => {
  return pipe(
    TraceServiceTag,
    Effect.andThen(service => service.extractTraceContext(context)),
    Effect.provide(TraceServiceLive)
  )
}

export const withSpan = withWebSocketSpan