import { Effect, Layer, pipe } from 'effect'
import { WebSdk } from '@effect/opentelemetry'
import { getWebAutoInstrumentations } from '@opentelemetry/auto-instrumentations-web'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
// Removed websocket trace context - backend no longer uses it

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
 * Exports traces to Jaeger via OTLP endpoint with explicit span processor for proper service identification
 */
export const OtelLayer = Layer.unwrapEffect(
  Effect.sync(() => 
    WebSdk.layer(() => ({
      // Resource configuration with service identification
      resource: {
        serviceName: 'hushfm-frontend',
        serviceVersion: '0.1.0',
        attributes: {
          'deployment.environment': 'development',
        },
      },
      // Explicit span processor configuration for OTLP export
      spanProcessor: new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: 'http://localhost:4318/v1/traces',
          headers: {},
        })
      ),
      // Web instrumentations for automatic tracing
      instrumentations: [
        // Automatic web instrumentations for fetch, XHR, user interactions, etc.
        getWebAutoInstrumentations({
          '@opentelemetry/instrumentation-fetch': {
            // Instrument fetch requests to backend
            enabled: true,
            propagateTraceHeaderCorsUrls: [
              /^http:\/\/localhost:3001.*$/,  // Backend URL
              /^http:\/\/localhost:8080.*$/,  // Alternative backend URL
            ],
          },
          '@opentelemetry/instrumentation-xml-http-request': {
            enabled: true,
            propagateTraceHeaderCorsUrls: [
              /^http:\/\/localhost:3001.*$/,
              /^http:\/\/localhost:8080.*$/,
            ],
          },
          '@opentelemetry/instrumentation-user-interaction': {
            // Track user clicks and interactions
            enabled: true,
          },
          '@opentelemetry/instrumentation-document-load': {
            // Track page load performance
            enabled: true,
          },
        }),
      ],
    }))
  )
)

// WebSocket trace service removed - backend no longer uses trace context

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
 * Sets up OpenTelemetry tracing for frontend operations only
 */
export const provideTelemetry = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
  pipe(
    effect,
    Effect.provide(OtelLayer)
  )

/**
 * Legacy compatibility exports for existing code
 */
export const initTelemetry = (serviceName: string, endpoint?: string): void => {
  console.info(`Effect-TS OpenTelemetry configured for ${serviceName} -> ${endpoint || 'http://localhost:4318/v1/traces'}`)
}

/**
 * Cleanup OpenTelemetry resources (handled by Effect runtime)
 */
export const shutdownTelemetry = async (): Promise<void> => {
  console.info('OpenTelemetry cleanup handled by Effect runtime')
}

export const createRootSpan = (_operationName: string, _attributes?: Record<string, any>) => ({
  end: () => {},
  setStatus: () => {},
  recordException: () => {},
  addEvent: () => {},
})

export const createWebRTCSpan = createRootSpan
export const createWebSocketSpan = createRootSpan

// WebSocket trace context functions removed - backend no longer uses trace context

export const withSpan = withWebSocketSpan