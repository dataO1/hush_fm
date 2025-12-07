import { createStore } from 'solid-js/store'
import { createSignal, createEffect, createContext, Accessor } from 'solid-js'
import { Device } from 'mediasoup-client'
import type { types } from 'mediasoup-client'

/**
 * Connection states for WebRTC components
 */
export type ConnectionState = 
  | 'disconnected'
  | 'connecting' 
  | 'connected'
  | 'failed'
  | 'reconnecting'

/**
 * Device state for mediasoup-client
 */
export type DeviceState = {
  device: Device | null
  loaded: boolean
  capabilities: any | null
  error: string | null
}

/**
 * Transport state tracking
 */
export type TransportState = {
  id: string
  direction: 'send' | 'receive'
  connectionState: ConnectionState
  iceState: RTCIceConnectionState | null
  dtlsState: RTCDtlsTransportState | null
  transport: types.Transport | null
}

/**
 * Producer state for audio streaming
 */
export type ProducerState = {
  id: string
  kind: 'audio' | 'video'
  paused: boolean
  track: MediaStreamTrack | null
  producer: types.Producer | null
}

/**
 * Consumer state for receiving audio
 */
export type ConsumerState = {
  id: string
  producerId: string
  kind: 'audio' | 'video'
  paused: boolean
  track: MediaStreamTrack | null
  consumer: types.Consumer | null
}

/**
 * Main WebRTC store using SolidJS fine-grained reactivity
 */
export const [webrtcStore, setWebrtcStore] = createStore({
  // Device state
  device: {
    device: null,
    loaded: false,
    capabilities: null,
    error: null,
  } as DeviceState,
  
  // Transport management
  transports: new Map<string, TransportState>(),
  
  // Producer management
  producers: new Map<string, ProducerState>(),
  
  // Consumer management
  consumers: new Map<string, ConsumerState>(),
  
  // Connection statistics
  stats: {
    lastUpdate: null as Date | null,
    bytesReceived: 0,
    bytesSent: 0,
    packetsLost: 0,
  },
})

/**
 * Individual signals for frequently accessed values
 * Following SolidJS best practice: signals for primitives
 */
export const [connectionState, setConnectionState] = createSignal<ConnectionState>('disconnected')
export const [isStreaming, setIsStreaming] = createSignal(false)
export const [audioLevel, setAudioLevel] = createSignal(0)
export const [selectedDeviceId, setSelectedDeviceId] = createSignal<string | null>(null)

/**
 * Derived signals for computed state
 */
export const isConnected: Accessor<boolean> = () => connectionState() === 'connected'
export const hasActiveProducer: Accessor<boolean> = () => 
  Array.from(webrtcStore.producers.values()).some(p => p.producer && !p.paused)
export const hasActiveConsumer: Accessor<boolean> = () =>
  Array.from(webrtcStore.consumers.values()).some(c => c.consumer && !c.paused)

/**
 * Device management actions
 */
export const deviceActions = {
  /**
   * Update device state - maintains reactivity
   */
  setDevice: (device: Device | null) => {
    setWebrtcStore('device', 'device', device)
  },

  setLoaded: (loaded: boolean) => {
    setWebrtcStore('device', 'loaded', loaded)
  },

  setCapabilities: (capabilities: any) => {
    setWebrtcStore('device', 'capabilities', capabilities)
  },

  setError: (error: string | null) => {
    setWebrtcStore('device', 'error', error)
  },
}

/**
 * Transport management actions
 */
export const transportActions = {
  /**
   * Add transport - using Map for O(1) lookups
   */
  addTransport: (transport: TransportState) => {
    setWebrtcStore('transports', transports => {
      const newMap = new Map(transports)
      newMap.set(transport.id, transport)
      return newMap
    })
  },

  /**
   * Update transport connection state
   */
  updateTransportState: (id: string, connectionState: ConnectionState) => {
    setWebrtcStore('transports', transports => {
      const newMap = new Map(transports)
      const existing = newMap.get(id)
      if (existing) {
        newMap.set(id, { ...existing, connectionState })
      }
      return newMap
    })
  },

  /**
   * Remove transport
   */
  removeTransport: (id: string) => {
    setWebrtcStore('transports', transports => {
      const newMap = new Map(transports)
      newMap.delete(id)
      return newMap
    })
  },
}

/**
 * Producer management actions
 */
export const producerActions = {
  addProducer: (producer: ProducerState) => {
    setWebrtcStore('producers', producers => {
      const newMap = new Map(producers)
      newMap.set(producer.id, producer)
      return newMap
    })
    setIsStreaming(true)
  },

  updateProducerPaused: (id: string, paused: boolean) => {
    setWebrtcStore('producers', producers => {
      const newMap = new Map(producers)
      const existing = newMap.get(id)
      if (existing) {
        newMap.set(id, { ...existing, paused })
      }
      return newMap
    })
  },

  updateProducer: (id: string, updates: Partial<ProducerState>) => {
    setWebrtcStore('producers', producers => {
      const newMap = new Map(producers)
      const existing = newMap.get(id)
      if (existing) {
        newMap.set(id, { ...existing, ...updates })
      }
      return newMap
    })
  },

  removeProducer: (id: string) => {
    setWebrtcStore('producers', producers => {
      const newMap = new Map(producers)
      newMap.delete(id)
      return newMap
    })
    
    // Update streaming state if no active producers
    if (!hasActiveProducer()) {
      setIsStreaming(false)
    }
  },
}

/**
 * Consumer management actions
 */
export const consumerActions = {
  addConsumer: (consumer: ConsumerState) => {
    setWebrtcStore('consumers', consumers => {
      const newMap = new Map(consumers)
      newMap.set(consumer.id, consumer)
      return newMap
    })
  },

  updateConsumerPaused: (id: string, paused: boolean) => {
    setWebrtcStore('consumers', consumers => {
      const newMap = new Map(consumers)
      const existing = newMap.get(id)
      if (existing) {
        newMap.set(id, { ...existing, paused })
      }
      return newMap
    })
  },

  removeConsumer: (id: string) => {
    setWebrtcStore('consumers', consumers => {
      const newMap = new Map(consumers)
      newMap.delete(id)
      return newMap
    })
  },
}

/**
 * Stats update action
 */
export const updateStats = (stats: Partial<typeof webrtcStore.stats>) => {
  setWebrtcStore('stats', current => ({
    ...current,
    ...stats,
    lastUpdate: new Date(),
  }))
}

/**
 * Context for sharing WebRTC store across components
 * Following SolidJS Context API pattern
 */
export const WebRTCContext = createContext<{
  store: typeof webrtcStore
  setStore: typeof setWebrtcStore
  connectionState: Accessor<ConnectionState>
  isStreaming: Accessor<boolean>
  audioLevel: Accessor<number>
}>()

/**
 * Export useWebRTC hook for components
 * The provider and hook are now in context.tsx
 */
export { useWebRTC, WebRTCProvider } from './context'

/**
 * Effect to automatically update connection state based on transports
 */
createEffect(() => {
  const transports = Array.from(webrtcStore.transports.values())
  
  if (transports.length === 0) {
    setConnectionState('disconnected')
    return
  }

  const hasConnected = transports.some(t => t.connectionState === 'connected')
  const hasConnecting = transports.some(t => t.connectionState === 'connecting')
  const hasFailed = transports.some(t => t.connectionState === 'failed')

  if (hasConnected && !hasConnecting && !hasFailed) {
    setConnectionState('connected')
  } else if (hasConnecting) {
    setConnectionState('connecting')
  } else if (hasFailed) {
    setConnectionState('failed')
  }
})