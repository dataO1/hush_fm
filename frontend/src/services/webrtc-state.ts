import { Context, Effect, Layer, Ref, pipe } from 'effect'
import type { types } from 'mediasoup-client'
import type { ProducerState, TransportState, ConsumerState, DeviceState, ConnectionState } from '../providers/WebRTCProvider'

/**
 * WebRTC State Management Service using Effect-TS Context/Layer/Ref
 * Provides idiomatic Effect-TS state management for WebRTC operations
 */
export interface WebRTCStateService {
  // Device operations
  readonly setDevice: (device: types.Device | null) => Effect.Effect<void>
  readonly setDeviceLoaded: (loaded: boolean) => Effect.Effect<void>
  readonly setDeviceCapabilities: (capabilities: any) => Effect.Effect<void>
  readonly setDeviceError: (error: string | null) => Effect.Effect<void>
  readonly getDeviceState: Effect.Effect<DeviceState>

  // Transport operations
  readonly addTransport: (transport: TransportState) => Effect.Effect<void>
  readonly updateTransportState: (id: string, connectionState: ConnectionState) => Effect.Effect<void>
  readonly removeTransport: (id: string) => Effect.Effect<void>
  readonly getTransport: (id: string) => Effect.Effect<TransportState | null>

  // Producer operations
  readonly addProducer: (producer: ProducerState) => Effect.Effect<void>
  readonly updateProducerPaused: (id: string, paused: boolean) => Effect.Effect<void>
  readonly updateProducer: (id: string, updates: Partial<ProducerState>) => Effect.Effect<void>
  readonly removeProducer: (id: string) => Effect.Effect<void>
  readonly getProducer: (id: string) => Effect.Effect<ProducerState | null>
  readonly getAllProducers: Effect.Effect<ProducerState[]>

  // Consumer operations
  readonly addConsumer: (consumer: ConsumerState) => Effect.Effect<void>
  readonly updateConsumerPaused: (id: string, paused: boolean) => Effect.Effect<void>
  readonly removeConsumer: (id: string) => Effect.Effect<void>
  readonly getConsumer: (id: string) => Effect.Effect<ConsumerState | null>

  // Stream operations
  readonly setLocalStream: (stream: MediaStream | null) => Effect.Effect<void>
  readonly addRemoteStream: (id: string, stream: MediaStream) => Effect.Effect<void>
  readonly removeRemoteStream: (id: string) => Effect.Effect<void>

  // Connection quality
  readonly updateConnectionQuality: (quality: {
    rtt?: number
    packetsLost?: number
    jitter?: number
    timestamp?: number
  }) => Effect.Effect<void>

  // State subscription for SolidJS integration
  readonly subscribeToChanges: (
    callback: (state: WebRTCState) => void
  ) => Effect.Effect<() => void>
}

/**
 * Internal WebRTC state representation
 */
export interface WebRTCState {
  device: DeviceState
  transports: Map<string, TransportState>
  producers: Map<string, ProducerState>
  consumers: Map<string, ConsumerState>
  localStream: MediaStream | null
  remoteStreams: Map<string, MediaStream>
  connectionQuality: {
    rtt: number
    packetsLost: number
    jitter: number
    timestamp: number
  }
}

/**
 * Context tag for WebRTCStateService
 */
export const WebRTCStateService = Context.GenericTag<WebRTCStateService>('WebRTCStateService')

/**
 * Initial state for WebRTC
 */
const initialState: WebRTCState = {
  device: {
    device: null,
    loaded: false,
    capabilities: null,
    error: null
  },
  transports: new Map(),
  producers: new Map(),
  consumers: new Map(),
  localStream: null,
  remoteStreams: new Map(),
  connectionQuality: {
    rtt: 0,
    packetsLost: 0,
    jitter: 0,
    timestamp: Date.now()
  }
}

/**
 * Live implementation of WebRTCStateService using Ref for mutable state
 */
export const WebRTCStateServiceLive = Layer.effect(
  WebRTCStateService,
  Effect.gen(function* (_) {
    // Create mutable state reference
    const stateRef = yield* _(Ref.make(initialState))
    const subscribersRef = yield* _(Ref.make<Set<(state: WebRTCState) => void>>(new Set()))

    // Helper to notify subscribers
    const notifySubscribers = (state: WebRTCState): Effect.Effect<void> =>
      pipe(
        Ref.get(subscribersRef),
        Effect.andThen(subscribers => 
          Effect.sync(() => {
            subscribers.forEach(callback => callback(state))
          })
        )
      )

    // Helper to update state and notify
    const updateState = (
      updater: (state: WebRTCState) => WebRTCState
    ): Effect.Effect<void> =>
      pipe(
        Ref.update(stateRef, updater),
        Effect.andThen(() => Ref.get(stateRef)),
        Effect.andThen(notifySubscribers)
      )

    return WebRTCStateService.of({
      // Device operations
      setDevice: (device: types.Device | null) =>
        updateState(state => ({
          ...state,
          device: { ...state.device, device }
        })),

      setDeviceLoaded: (loaded: boolean) =>
        updateState(state => ({
          ...state,
          device: { ...state.device, loaded }
        })),

      setDeviceCapabilities: (capabilities: any) =>
        updateState(state => ({
          ...state,
          device: { ...state.device, capabilities }
        })),

      setDeviceError: (error: string | null) =>
        updateState(state => ({
          ...state,
          device: { ...state.device, error }
        })),

      getDeviceState: pipe(
        Ref.get(stateRef),
        Effect.map(state => state.device)
      ),

      // Transport operations
      addTransport: (transport: TransportState) =>
        updateState(state => ({
          ...state,
          transports: new Map(state.transports).set(transport.id, transport)
        })),

      updateTransportState: (id: string, connectionState: ConnectionState) =>
        updateState(state => {
          const transports = new Map(state.transports)
          const existing = transports.get(id)
          if (existing) {
            transports.set(id, { ...existing, connectionState })
          }
          return { ...state, transports }
        }),

      removeTransport: (id: string) =>
        updateState(state => {
          const transports = new Map(state.transports)
          transports.delete(id)
          return { ...state, transports }
        }),

      getTransport: (id: string) =>
        pipe(
          Ref.get(stateRef),
          Effect.map(state => state.transports.get(id) || null)
        ),

      // Producer operations
      addProducer: (producer: ProducerState) =>
        updateState(state => ({
          ...state,
          producers: new Map(state.producers).set(producer.id, producer)
        })),

      updateProducerPaused: (id: string, paused: boolean) =>
        updateState(state => {
          const producers = new Map(state.producers)
          const existing = producers.get(id)
          if (existing) {
            producers.set(id, { ...existing, paused })
          }
          return { ...state, producers }
        }),

      updateProducer: (id: string, updates: Partial<ProducerState>) =>
        updateState(state => {
          const producers = new Map(state.producers)
          const existing = producers.get(id)
          if (existing) {
            producers.set(id, { ...existing, ...updates })
          }
          return { ...state, producers }
        }),

      removeProducer: (id: string) =>
        updateState(state => {
          const producers = new Map(state.producers)
          producers.delete(id)
          return { ...state, producers }
        }),

      getProducer: (id: string) =>
        pipe(
          Ref.get(stateRef),
          Effect.map(state => state.producers.get(id) || null)
        ),

      getAllProducers: pipe(
        Ref.get(stateRef),
        Effect.map(state => Array.from(state.producers.values()))
      ),

      // Consumer operations
      addConsumer: (consumer: ConsumerState) =>
        updateState(state => ({
          ...state,
          consumers: new Map(state.consumers).set(consumer.id, consumer)
        })),

      updateConsumerPaused: (id: string, paused: boolean) =>
        updateState(state => {
          const consumers = new Map(state.consumers)
          const existing = consumers.get(id)
          if (existing) {
            consumers.set(id, { ...existing, paused })
          }
          return { ...state, consumers }
        }),

      removeConsumer: (id: string) =>
        updateState(state => {
          const consumers = new Map(state.consumers)
          consumers.delete(id)
          return { ...state, consumers }
        }),

      getConsumer: (id: string) =>
        pipe(
          Ref.get(stateRef),
          Effect.map(state => state.consumers.get(id) || null)
        ),

      // Stream operations
      setLocalStream: (stream: MediaStream | null) =>
        updateState(state => ({
          ...state,
          localStream: stream
        })),

      addRemoteStream: (id: string, stream: MediaStream) =>
        updateState(state => ({
          ...state,
          remoteStreams: new Map(state.remoteStreams).set(id, stream)
        })),

      removeRemoteStream: (id: string) =>
        updateState(state => {
          const remoteStreams = new Map(state.remoteStreams)
          remoteStreams.delete(id)
          return { ...state, remoteStreams }
        }),

      // Connection quality
      updateConnectionQuality: (quality: {
        rtt?: number
        packetsLost?: number
        jitter?: number
        timestamp?: number
      }) =>
        updateState(state => ({
          ...state,
          connectionQuality: {
            ...state.connectionQuality,
            ...quality,
            timestamp: quality.timestamp || Date.now()
          }
        })),

      // Subscription for SolidJS integration
      subscribeToChanges: (callback: (state: WebRTCState) => void) =>
        pipe(
          Ref.update(subscribersRef, subscribers => {
            const newSubscribers = new Set(subscribers)
            newSubscribers.add(callback)
            return newSubscribers
          }),
          Effect.map(() => () => {
            // Return cleanup function
            Effect.runSync(
              Ref.update(subscribersRef, subscribers => {
                const newSubscribers = new Set(subscribers)
                newSubscribers.delete(callback)
                return newSubscribers
              })
            )
          })
        )
    })
  })
)

/**
 * Convenience function to access WebRTCStateService from context
 */
export const useWebRTCStateService = Context.get(WebRTCStateService)