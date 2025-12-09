import { createContext, useContext, ParentComponent, createSignal, createEffect, onCleanup } from 'solid-js'
import { createStore } from 'solid-js/store'
import { Device } from 'mediasoup-client'
import type { types } from 'mediasoup-client'
import { Effect, Layer, Runtime, Option, pipe } from 'effect'
import { WebRTCService, WebRTCServiceLive } from '../services/webrtc-service'
import type { WebRTCState, WebRTCService as WebRTCServiceType } from '../services/webrtc-service'

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
  device: Option.Option<Device>
  loaded: boolean
  capabilities: Option.Option<any>
  error: Option.Option<string>
}

/**
 * Transport state tracking
 */
export type TransportState = {
  id: string
  direction: 'send' | 'receive'
  connectionState: ConnectionState
  iceState: Option.Option<RTCIceConnectionState>
  dtlsState: Option.Option<RTCDtlsTransportState>
  transport: Option.Option<types.Transport>
}

/**
 * Producer state for audio streaming
 */
export type ProducerState = {
  id: string
  kind: 'audio' | 'video'
  paused: boolean
  track: Option.Option<MediaStreamTrack>
  producer: Option.Option<types.Producer>
}

/**
 * Consumer state for receiving audio
 */
export type ConsumerState = {
  id: string
  kind: 'audio' | 'video'
  paused: boolean
  track: Option.Option<MediaStreamTrack>
  consumer: Option.Option<types.Consumer>
  producerId: string
}

/**
 * Simplified WebRTC store state - UI-specific only
 */
export type WebRTCStore = {
  // Device state
  device: DeviceState
  
  // Connection monitoring
  connectionQuality: {
    rtt: number
    packetsLost: number
    jitter: number
    timestamp: number
  }
}

/**
 * Simplified WebRTC action handlers - UI-specific only
 */
export type WebRTCActions = {
  // Device management (read-only, managed by service)
  setDeviceError: (error: Option.Option<string>) => void
  
  // Connection quality
  updateConnectionQuality: (quality: Partial<typeof initialStore.connectionQuality>) => void
}

/**
 * Simplified WebRTC Context type
 */
export type WebRTCContextType = {
  state: WebRTCStore
  setState: (updates: Partial<WebRTCStore> | ((prev: WebRTCStore) => Partial<WebRTCStore>)) => void
  actions: WebRTCActions
  
  // UI-specific reactive signals
  connectionState: () => ConnectionState
  setConnectionState: (state: ConnectionState) => void
  
  isStreaming: () => boolean
  setIsStreaming: (streaming: boolean) => void
  
  audioLevel: () => number
  setAudioLevel: (level: number) => void
  
  selectedDeviceId: () => Option.Option<string>
  setSelectedDeviceId: (deviceId: Option.Option<string>) => void
  
  // Derived state
  isConnected: () => boolean
  
  // Direct access to WebRTC service for complex operations
  getService: () => Effect.Effect<Option.Option<WebRTCServiceType>, never, never>
}

const WebRTCContext = createContext<WebRTCContextType>()

/**
 * WebRTC Provider component
 * Manages all WebRTC state within proper SolidJS reactive context
 */
const initialStore: WebRTCStore = {
  device: {
    device: Option.none<Device>(),
    loaded: false,
    capabilities: Option.none<any>(),
    error: Option.none<string>()
  } as DeviceState,
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
  const [selectedDeviceId, setSelectedDeviceId] = createSignal<Option.Option<string>>(Option.none())

  // WebRTC Service integration
  const webrtcServiceLayer = WebRTCServiceLive
  let serviceRuntime: Option.Option<Runtime.Runtime<WebRTCServiceType>> = Option.none()
  let unsubscribe: Option.Option<() => void> = Option.none()


  // Derived signals
  const isConnected = (): boolean => connectionState() === 'connected'

  // Simplified actions - only UI-specific functionality
  const actions: WebRTCActions = {
    // Device error management (for UI feedback)
    setDeviceError: (error: Option.Option<string>) => {
      setState('device', 'error', error)
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

  // Initialize WebRTC service and subscribe to state changes
  createEffect(() => {
    const initService = async () => {
      try {
        // Create service runtime with Layer
        const runtime = await Effect.runPromise(
          Effect.scoped(
            Layer.toRuntime(webrtcServiceLayer)
          )
        )
        serviceRuntime = Option.some(runtime)
        
        // Subscribe to service state changes
        const subscribeEffect = pipe(
          WebRTCService,
          Effect.andThen(service => 
            service.subscribeToStateChanges((serviceState: WebRTCState) => {
              // Sync service state to SolidJS reactive store
              syncServiceStateToStore(serviceState)
            })
          )
        )
        
        const unsub = await Effect.runPromise(
          Effect.provide(subscribeEffect, runtime)
        )
        unsubscribe = Option.some(unsub)
        
      } catch (error) {
        console.error('Failed to initialize WebRTC service:', error)
        setState('device', 'error', Option.some(String(error)))
      }
    }

    initService()
  })
  
  // Simplified sync - just pass service state through
  const syncServiceStateToStore = (serviceState: WebRTCState) => {
    // Update device state to match service structure
    setState('device', {
      device: serviceState.device,
      loaded: serviceState.deviceLoaded,
      capabilities: serviceState.rtpCapabilities,
      error: serviceState.deviceError
    })
    
    // Update connection quality
    setState('connectionQuality', serviceState.connectionQuality)
    
    // Update derived reactive signals
    const hasActiveProducers = serviceState.producers.size > 0
    setIsStreaming(hasActiveProducers)
    
    // Update connection state based on WebSocket
    Option.match(serviceState.ws, {
      onNone: () => setConnectionState('disconnected'),
      onSome: (ws) => {
        setConnectionState(ws.readyState === WebSocket.OPEN ? 'connected' : 'connecting')
      }
    })
  }

  // Cleanup on unmount
  onCleanup(async () => {
    // Unsubscribe from service state changes
    Option.match(unsubscribe, {
      onNone: () => {},
      onSome: (unsub) => unsub()
    })
    
    // Cleanup WebRTC service
    Option.match(serviceRuntime, {
      onNone: () => {},
      onSome: async (runtime) => {
        try {
          await Effect.runPromise(
            Effect.provide(
              pipe(
                WebRTCService,
                Effect.andThen(service => service.cleanup())
              ),
              runtime
            )
          )
        } catch (error) {
          console.error('Error cleaning up WebRTC service:', error)
        }
      }
    })
  })

  // Connection state is now managed in sync function based on WebSocket state

  // Helper to get WebRTC service instance
  const getService = (): Effect.Effect<Option.Option<WebRTCServiceType>, never, never> =>
    pipe(
      serviceRuntime,
      Option.match({
        onNone: () => Effect.succeed(Option.none<WebRTCServiceType>()),
        onSome: (runtime) => pipe(
          WebRTCService,
          Effect.provide(runtime),
          Effect.map(Option.some),
          Effect.catchAll(() => Effect.succeed(Option.none<WebRTCServiceType>()))
        )
      })
    )

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
    getService
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