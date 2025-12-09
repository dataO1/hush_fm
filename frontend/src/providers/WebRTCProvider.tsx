import { createContext, useContext, ParentComponent, createSignal, createEffect, onCleanup } from 'solid-js'
import { createStore } from 'solid-js/store'
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
  kind: 'audio' | 'video'
  paused: boolean
  track: MediaStreamTrack | null
  consumer: types.Consumer | null
  producerId: string
}

/**
 * WebRTC store state
 */
export type WebRTCStore = {
  // Device state
  device: DeviceState
  
  // Transport management
  transports: Map<string, TransportState>
  
  // Producer management (for DJ)
  producers: Map<string, ProducerState>
  
  // Consumer management (for listeners)
  consumers: Map<string, ConsumerState>
  
  // Stream state
  localStream: MediaStream | null
  remoteStreams: Map<string, MediaStream>
  
  // Connection monitoring
  connectionQuality: {
    rtt: number
    packetsLost: number
    jitter: number
    timestamp: number
  }
}

/**
 * WebRTC action handlers
 */
export type WebRTCActions = {
  // Device management
  setDevice: (device: Device | null) => void
  setDeviceLoaded: (loaded: boolean) => void
  setDeviceCapabilities: (capabilities: any) => void
  setDeviceError: (error: string | null) => void
  
  // Transport management  
  addTransport: (transport: TransportState) => void
  updateTransportState: (id: string, connectionState: ConnectionState) => void
  removeTransport: (id: string) => void
  
  // Producer management
  addProducer: (producer: ProducerState) => void
  updateProducerPaused: (id: string, paused: boolean) => void
  updateProducer: (id: string, updates: Partial<ProducerState>) => void
  removeProducer: (id: string) => void
  
  // Consumer management
  addConsumer: (consumer: ConsumerState) => void
  updateConsumerPaused: (id: string, paused: boolean) => void
  removeConsumer: (id: string) => void
  
  // Connection quality
  updateConnectionQuality: (quality: Partial<typeof initialStore.connectionQuality>) => void
}

/**
 * WebRTC Context type
 */
export type WebRTCContextType = {
  state: WebRTCStore
  setState: (updates: Partial<WebRTCStore> | ((prev: WebRTCStore) => Partial<WebRTCStore>)) => void
  actions: WebRTCActions
  
  // Additional reactive signals
  connectionState: () => ConnectionState
  setConnectionState: (state: ConnectionState) => void
  
  isStreaming: () => boolean
  setIsStreaming: (streaming: boolean) => void
  
  audioLevel: () => number
  setAudioLevel: (level: number) => void
  
  selectedDeviceId: () => string | null
  setSelectedDeviceId: (deviceId: string | null) => void
  
  // Derived state
  isConnected: () => boolean
  hasActiveProducer: () => boolean
  hasActiveConsumer: () => boolean
}

const WebRTCContext = createContext<WebRTCContextType>()

/**
 * WebRTC Provider component
 * Manages all WebRTC state within proper SolidJS reactive context
 */
const initialStore = {
  device: {
    device: null,
    loaded: false,
    capabilities: null,
    error: null
  } as DeviceState,
  transports: new Map<string, TransportState>(),
  producers: new Map<string, ProducerState>(),
  consumers: new Map<string, ConsumerState>(),
  localStream: null as MediaStream | null,
  remoteStreams: new Map<string, MediaStream>(),
  connectionQuality: {
    rtt: 0,
    packetsLost: 0,
    jitter: 0,
    timestamp: Date.now()
  }
}

export const WebRTCProvider: ParentComponent = (props) => {
  // Main WebRTC store
  const [state, setState] = createStore<WebRTCStore>(initialStore)

  // Additional reactive signals
  const [connectionState, setConnectionState] = createSignal<ConnectionState>('disconnected')
  const [isStreaming, setIsStreaming] = createSignal(false)
  const [audioLevel, setAudioLevel] = createSignal(0)
  const [selectedDeviceId, setSelectedDeviceId] = createSignal<string | null>(null)


  // Derived signals
  const isConnected = (): boolean => connectionState() === 'connected'
  const hasActiveProducer = (): boolean => 
    Array.from(state.producers.values()).some(p => p.producer && !p.paused)
  const hasActiveConsumer = (): boolean =>
    Array.from(state.consumers.values()).some(c => c.consumer && !c.paused)

  // WebRTC actions following the original store pattern
  const actions: WebRTCActions = {
    // Device management
    setDevice: (device: Device | null) => {
      setState('device', 'device', device)
    },
    setDeviceLoaded: (loaded: boolean) => {
      setState('device', 'loaded', loaded)
    },
    setDeviceCapabilities: (capabilities: any) => {
      setState('device', 'capabilities', capabilities)
    },
    setDeviceError: (error: string | null) => {
      setState('device', 'error', error)
    },

    // Transport management
    addTransport: (transport: TransportState) => {
      setState('transports', transports => {
        const newMap = new Map(transports)
        newMap.set(transport.id, transport)
        return newMap
      })
    },
    updateTransportState: (id: string, connectionState: ConnectionState) => {
      setState('transports', transports => {
        const newMap = new Map(transports)
        const existing = newMap.get(id)
        if (existing) {
          newMap.set(id, { ...existing, connectionState })
        }
        return newMap
      })
    },
    removeTransport: (id: string) => {
      setState('transports', transports => {
        const newMap = new Map(transports)
        newMap.delete(id)
        return newMap
      })
    },

    // Producer management
    addProducer: (producer: ProducerState) => {
      setState('producers', producers => {
        const newMap = new Map(producers)
        newMap.set(producer.id, producer)
        return newMap
      })
      setIsStreaming(true)
    },
    updateProducerPaused: (id: string, paused: boolean) => {
      setState('producers', producers => {
        const newMap = new Map(producers)
        const existing = newMap.get(id)
        if (existing) {
          newMap.set(id, { ...existing, paused })
        }
        return newMap
      })
    },
    updateProducer: (id: string, updates: Partial<ProducerState>) => {
      setState('producers', producers => {
        const newMap = new Map(producers)
        const existing = newMap.get(id)
        if (existing) {
          newMap.set(id, { ...existing, ...updates })
        }
        return newMap
      })
    },
    removeProducer: (id: string) => {
      setState('producers', producers => {
        const newMap = new Map(producers)
        newMap.delete(id)
        return newMap
      })
      
      // Update streaming state if no active producers
      if (!hasActiveProducer()) {
        setIsStreaming(false)
      }
    },

    // Consumer management
    addConsumer: (consumer: ConsumerState) => {
      setState('consumers', consumers => {
        const newMap = new Map(consumers)
        newMap.set(consumer.id, consumer)
        return newMap
      })
    },
    updateConsumerPaused: (id: string, paused: boolean) => {
      setState('consumers', consumers => {
        const newMap = new Map(consumers)
        const existing = newMap.get(id)
        if (existing) {
          newMap.set(id, { ...existing, paused })
        }
        return newMap
      })
    },
    removeConsumer: (id: string) => {
      setState('consumers', consumers => {
        const newMap = new Map(consumers)
        newMap.delete(id)
        return newMap
      })
    },

    // Connection quality
    updateConnectionQuality: (quality: Partial<typeof initialStore.connectionQuality>) => {
      setState('connectionQuality', current => ({
        ...current,
        ...quality,
        timestamp: Date.now()
      }))
    }
  }

  // Initialize mediasoup device
  createEffect(() => {
    const initDevice = async () => {
      try {
        const device = new Device()
        setState('device', {
          device,
          loaded: false,
          capabilities: null,
          error: null
        })
      } catch (error) {
        setState('device', 'error', String(error))
      }
    }

    initDevice()
  })

  // Cleanup on unmount
  onCleanup(() => {
    // Close all transports
    state.transports.forEach(transport => {
      transport.transport?.close()
    })

    // Close local stream tracks
    if (state.localStream) {
      state.localStream.getTracks().forEach(track => track.stop())
    }

    // Close remote stream tracks
    state.remoteStreams.forEach(stream => {
      stream.getTracks().forEach(track => track.stop())
    })
  })

  // Automatic connection state management based on transports
  createEffect(() => {
    const transports = Array.from(state.transports.values())
    
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

  const contextValue: WebRTCContextType = {
    state,
    setState,
    actions,
    connectionState,
    setConnectionState,
    isStreaming,
    setIsStreaming,
    audioLevel,
    setAudioLevel,
    selectedDeviceId,
    setSelectedDeviceId,
    isConnected,
    hasActiveProducer,
    hasActiveConsumer
  }

  return (
    <WebRTCContext.Provider value={contextValue}>
      {props.children}
    </WebRTCContext.Provider>
  )
}

/**
 * Hook to access WebRTC context
 * Must be used within WebRTCProvider
 */
export const useWebRTC = (): WebRTCContextType => {
  const context = useContext(WebRTCContext)
  if (!context) {
    throw new Error('useWebRTC must be used within WebRTCProvider')
  }
  return context
}

/**
 * Helper hooks for specific WebRTC functionality
 */

// Get current device state
export const useWebRTCDevice = () => {
  const { state } = useWebRTC()
  return () => state.device
}

// Get connection state
export const useWebRTCConnection = () => {
  const { connectionState } = useWebRTC()
  return connectionState
}

// Get streaming state
export const useStreamingState = () => {
  const { isStreaming, setIsStreaming } = useWebRTC()
  return [isStreaming, setIsStreaming] as const
}

// Get audio level
export const useAudioLevel = () => {
  const { audioLevel } = useWebRTC()
  return audioLevel
}