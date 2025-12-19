/**
 * Room Store
 * 
 * Enhanced reactive store for the CURRENT room state. Manages complete room state
 * including DJ and Listeners with embedded MediaSoup state (device, transport, 
 * producer/consumer, streams, websocket).
 * 
 * Replaces: dj.store, listener.store, webrtc-error-store functionality
 * Uses: domain schemas for type safety and validation
 */

import { createEffect, onCleanup } from 'solid-js'
import { createStore } from 'solid-js/store'
import { Effect, Option, Runtime, Layer } from 'effect'
import {
  type RoomState,
  type RoomMetadata,
  type StreamingStatus,
  type WebRTCError,
  ConnectionState,
  createInitialRoomState
} from '../domain/schemas/room.schema'
import {
  type DJState,
  type DJFlowStep,
  createInitialDJState
} from '../domain/schemas/dj.schema'
import {
  type ListenerState,
  type ListenerFlowStep,
  type ReceiveTransportState,
  type ConsumerState,
  type ListenerWebSocketState
} from '../domain/schemas/listener.schema'
import {
  RoomConnectionError
} from '../domain/errors'


/**
 * Room store actions - manages current room with DJ + listeners
 */
export interface RoomStoreActions {
  // Unified connection state management
  setConnectionState: (state: ConnectionState) => void
  getConnectionState: () => ConnectionState
  
  // Room connection management
  setRoomWebSocket: (ws: WebSocket, roomId: string, connectionType: 'dj' | 'listener') => Effect.Effect<void, RoomConnectionError>
  disconnectFromRoom: () => void
  updateConnectionState: (state: ConnectionState) => void
  
  // Room metadata management
  setRoomMetadata: (metadata: RoomMetadata) => void
  updateRoomMetadata: (updates: Partial<RoomMetadata>) => void
  
  // DJ state management (embedded MediaSoup state)
  setDJState: (djState: DJState) => void
  updateDJState: (updates: Partial<DJState>) => void
  setDJFlowStep: (step: DJFlowStep) => void
  setDJError: (error: string, step?: DJFlowStep) => void
  clearDJError: () => void
  setSelectedDeviceId: (deviceId: string) => void
  
  // Listener state management (embedded MediaSoup state)  
  addListener: (sessionId: string, listener: ListenerState) => void
  updateListener: (listenerId: string, updates: Partial<ListenerState>) => void
  removeListener: (listenerId: string) => void
  setListenerFlowStep: (listenerId: string, step: ListenerFlowStep) => void
  setListenerError: (listenerId: string, error: string, step?: ListenerFlowStep) => void
  clearListenerError: (listenerId: string) => void
  
  // MediaSoup resource cleanup state management
  updateListenerTransportState: (listenerId: string, updates: Partial<ReceiveTransportState>) => void
  updateListenerConsumerState: (listenerId: string, updates: Partial<ConsumerState>) => void
  updateListenerWebSocketState: (listenerId: string, updates: Partial<ListenerWebSocketState>) => void
  markListenerResourceClosed: (listenerId: string, resource: 'consumer' | 'transport' | 'websocket') => void
  
  // Streaming status management
  setStreamingStatus: (status: StreamingStatus) => void
  startStreaming: () => void
  pauseStreaming: () => void
  resumeStreaming: () => void
  stopStreaming: () => void
  setStreamingError: (error: string) => void
  
  // Audio management for listeners
  setListenerVolume: (listenerId: string, volume: number) => void
  setListenerMuted: (listenerId: string, muted: boolean) => void
  setListenerAutoplayBlocked: (listenerId: string, blocked: boolean) => void
  
  // Error management (replacing webrtc-error-store)
  setGlobalRoomError: (error: string, recoverable?: boolean) => void
  clearGlobalRoomError: () => void
  
  // WebRTC status management
  setWebRTCStatus: (status: 'disconnected' | 'connecting' | 'connected' | 'failed', error?: WebRTCError) => void
  clearWebRTCStatus: () => void
  
  // Producer confirmation management
  setProducerConfirmation: (producerId: string) => void
  
  // Listener confirmation management (pure state only)
  setListenerTransportConfirmation: (listenerId: string) => void
  setListenerConsumerConfirmation: (listenerId: string, consumerId: string, producerId: string, consumerParameters: any) => void
}

/**
 * Create enhanced room store with DJ + listeners
 */
/**
 * Helper function to map DJ flow steps to unified connection state
 */
const mapDJFlowStepToConnectionState = (step: DJFlowStep): ConnectionState => {
  switch (step) {
    case 'idle':
      return ConnectionState.IDLE
    case 'announcing':
    case 'connecting':
    case 'initializing':
    case 'device_loading':
    case 'requesting_media':
    case 'requesting_transport':
    case 'creating_transport':
    case 'connecting_transport':
    case 'creating_producer':
    case 'validating_connection':
    case 'publishing':
      return ConnectionState.CONNECTING
    case 'streaming':
      return ConnectionState.STREAMING
    case 'error':
    case 'cleanup':
      return ConnectionState.ERROR
    default:
      return ConnectionState.IDLE
  }
}

/**
 * Helper function to map Listener flow steps to unified connection state
 */
const mapListenerFlowStepToConnectionState = (step: ListenerFlowStep): ConnectionState => {
  switch (step) {
    case 'idle':
      return ConnectionState.IDLE
    case 'requesting_join':
    case 'connecting':
    case 'requesting_capabilities':
    case 'waiting_transport':
    case 'creating_transport':
    case 'device_loading':
    case 'sending_capabilities':
    case 'waiting_consumer':
    case 'creating_consumer':
    case 'connecting_transport':
      return ConnectionState.CONNECTING
    case 'streaming':
      return ConnectionState.STREAMING
    case 'error':
      return ConnectionState.ERROR
    case 'cleanup':
      return ConnectionState.DISCONNECTING
    default:
      return ConnectionState.IDLE
  }
}

export const createRoomStore = () => {
  // Main reactive state - starts with initial room state
  const [state, setState] = createStore(createInitialRoomState() as any)
  
  // Effect runtime for service calls
  let effectRuntime: Option.Option<Runtime.Runtime<never>> = Option.none()
  let roomWebSocket: Option.Option<WebSocket> = Option.none()
  
  // Initialize Effect runtime
  createEffect(() => {
    Effect.runPromise(
      Effect.scoped(Layer.toRuntime(Layer.empty))
    ).then(runtime => {
      effectRuntime = Option.some(runtime)
    }).catch(err => {
      console.error('Failed to initialize room store runtime:', err)
    })
  })
  
  // Cleanup on dispose
  onCleanup(() => {
    Option.match(roomWebSocket, {
      onSome: (ws) => ws.close(),
      onNone: () => {}
    })
  })
  
  // Helper function to generate listener IDs
  
  // Event handling will be implemented by flow services
  
  // Actions implementation with domain schema integration
  const actions: RoomStoreActions = {
    /**
     * Set unified connection state
     */
    setConnectionState: (newState: ConnectionState) => {
      setState('connection', 'state', newState)
    },

    /**
     * Get current connection state
     */
    getConnectionState: (): ConnectionState => {
      return state.connection.state as ConnectionState
    },
    /**
     * Set room WebSocket connection
     */
    setRoomWebSocket: (ws: WebSocket, roomId: string, connType: 'dj' | 'listener') => {
      return Effect.gen(function* (_) {
        roomWebSocket = Option.some(ws)
        
        setState('connection', {
          websocket: Option.some(ws),
          state: ConnectionState.CONNECTED,
          roomId: Option.some(roomId),
          connectionType: Option.some(connType),
          lastConnectedAt: Option.some(new Date()),
          connectionAttempts: 0,
          lastError: Option.none()
        })
        
        // Event handling will be managed by flow services
      })
    },

    /**
     * Disconnect from room
     */
    disconnectFromRoom: () => {
      // Store only updates state - WebSocket closing is handled by services
      roomWebSocket = Option.none()
      
      setState('connection', {
        websocket: Option.none(),
        state: ConnectionState.DISCONNECTED,
        roomId: Option.none(),
        connectionType: Option.none(),
        connectionAttempts: 0,
        lastError: Option.none()
      })
      
      // Reset DJ and listeners
      setState('participants', {
        dj: Option.none(),
        listeners: {}, // Change to Record<string, ListenerState>
        totalCount: 0,
        maxListeners: Option.none()
      })
    },

    /**
     * Update connection state
     */
    updateConnectionState: (newState: ConnectionState) => {
      setState('connection', 'state', newState)
    },

    /**
     * Room metadata management
     */
    setRoomMetadata: (metadata: RoomMetadata) => {
      setState('metadata', Option.some(metadata))
    },

    updateRoomMetadata: (updates: Partial<RoomMetadata>) => {
      Option.match(state.metadata, {
        onSome: (current) => {
          setState('metadata', Option.some({ ...(current as any), ...updates }))
        },
        onNone: () => {
          console.warn('Cannot update metadata: no metadata set')
        }
      })
    },

    /**
     * DJ state management (using domain schema)
     */
    setDJState: (djState: DJState) => {
      setState('participants', 'dj', Option.some(djState))
    },

    updateDJState: (updates: Partial<DJState>) => {
      Option.match(state.participants.dj, {
        onSome: (currentDJ) => {
          const updatedDJ = { ...currentDJ as any, ...updates }
          setState('participants', 'dj', Option.some(updatedDJ))
        },
        onNone: () => {
          // Initialize DJ state with updates
          const newDJ = { ...createInitialDJState(), ...updates }
          setState('participants', 'dj', Option.some(newDJ))
        }
      })
    },

    setDJFlowStep: (step: DJFlowStep) => {
      actions.updateDJState({
        currentStep: step,
        stepStartedAt: Option.some(new Date()),
        stepError: Option.none()
      })
      
      // Automatically update unified connection state based on DJ flow step
      const connectionState = mapDJFlowStepToConnectionState(step)
      actions.setConnectionState(connectionState)
    },

    setDJError: (error: string, step?: DJFlowStep) => {
      actions.updateDJState({
        currentStep: step || 'error',
        stepError: Option.some(error),
        lastError: Option.some({
          step: step || 'error',
          error,
          timestamp: new Date()
        })
      })
    },

    clearDJError: () => {
      actions.updateDJState({
        stepError: Option.none(),
        lastError: Option.none()
      })
    },

    setSelectedDeviceId: (deviceId: string) => {
      actions.updateDJState({
        audioTrack: {
          ...((state.participants.dj as any)?.audioTrack || createInitialDJState().audioTrack),
          deviceId: Option.some(deviceId)
        }
      })
    },

    /**
     * Listener state management (using domain schema)
     */
    addListener: (sessionId: string, listener: ListenerState) => {
      setState('participants', 'listeners', (listeners: Record<string, ListenerState>) => ({
        ...listeners,
        [sessionId]: listener
      }))
      setState('participants', 'totalCount', (count: number) => count + 1)
    },

    updateListener: (listenerId: string, updates: Partial<ListenerState>) => {
      setState('participants', 'listeners', (listeners: Record<string, ListenerState>) => ({
        ...listeners,
        [listenerId]: listeners[listenerId] ? { ...listeners[listenerId], ...updates } : updates as ListenerState
      }))
    },

    removeListener: (listenerId: string) => {
      setState('participants', 'listeners', (listeners: Record<string, ListenerState>) => {
        const { [listenerId]: removed, ...remaining } = listeners
        return remaining
      })
      setState('participants', 'totalCount', (count: number) => Math.max(0, count - 1))
    },

    setListenerFlowStep: (listenerId: string, step: ListenerFlowStep) => {
      actions.updateListener(listenerId, {
        currentStep: step,
        stepStartedAt: Option.some(new Date()),
        stepError: Option.none()
      })
      
      // Automatically update unified connection state based on Listener flow step
      const connectionState = mapListenerFlowStepToConnectionState(step)
      actions.setConnectionState(connectionState)
    },

    setListenerError: (listenerId: string, error: string, step?: ListenerFlowStep) => {
      actions.updateListener(listenerId, {
        currentStep: step || 'error',
        stepError: Option.some(error),
        lastError: Option.some({
          step: step || 'error',
          error,
          timestamp: new Date(),
          recoverable: true
        })
      })
    },

    clearListenerError: (listenerId: string) => {
      actions.updateListener(listenerId, {
        stepError: Option.none(),
        lastError: Option.none()
      })
    },

    /**
     * MediaSoup resource cleanup state management
     */
    updateListenerTransportState: (listenerId: string, updates: Partial<ReceiveTransportState>) => {
      actions.updateListener(listenerId, {
        receiveTransport: {
          ...state.participants.listeners[listenerId]?.receiveTransport,
          ...updates
        }
      })
    },

    updateListenerConsumerState: (listenerId: string, updates: Partial<ConsumerState>) => {
      actions.updateListener(listenerId, {
        consumer: {
          ...state.participants.listeners[listenerId]?.consumer,
          ...updates
        }
      })
    },

    updateListenerWebSocketState: (listenerId: string, updates: Partial<ListenerWebSocketState>) => {
      actions.updateListener(listenerId, {
        websocket: {
          ...state.participants.listeners[listenerId]?.websocket,
          ...updates
        }
      })
    },

    markListenerResourceClosed: (listenerId: string, resource: 'consumer' | 'transport' | 'websocket') => {
      switch (resource) {
        case 'consumer':
          actions.updateListenerConsumerState(listenerId, {
            consumer: Option.none(),
            track: Option.none()
          })
          break
        case 'transport':
          actions.updateListenerTransportState(listenerId, {
            transport: Option.none(),
            connected: false,
            connectionState: 'disconnected'
          })
          break
        case 'websocket':
          actions.updateListenerWebSocketState(listenerId, {
            websocket: Option.none(),
            connectionState: 'disconnected',
            connectedAt: Option.none()
          })
          break
      }
    },

    /**
     * Streaming status management
     */
    setStreamingStatus: (status: StreamingStatus) => {
      setState('streaming', 'status', status)
      if (status === 'streaming' && !Option.isSome(state.streaming.startedAt)) {
        setState('streaming', 'startedAt', Option.some(new Date()))
      }
    },

    startStreaming: () => {
      setState('streaming', {
        status: 'streaming',
        startedAt: Option.some(new Date()),
        pausedAt: Option.none(),
        lastError: Option.none()
      })
      actions.setConnectionState(ConnectionState.STREAMING)
    },

    pauseStreaming: () => {
      setState('streaming', {
        status: 'paused',
        pausedAt: Option.some(new Date()),
        lastError: Option.none()
      })
      actions.setConnectionState(ConnectionState.PAUSED)
    },

    resumeStreaming: () => {
      setState('streaming', {
        status: 'streaming',
        pausedAt: Option.none(),
        lastError: Option.none()
      })
      actions.setConnectionState(ConnectionState.STREAMING)
    },

    stopStreaming: () => {
      setState('streaming', {
        status: 'idle',
        startedAt: Option.none(),
        pausedAt: Option.none(),
        lastError: Option.none()
      })
      actions.setConnectionState(ConnectionState.IDLE)
    },

    setStreamingError: (error: string) => {
      setState('streaming', {
        status: 'error',
        lastError: Option.some(error)
      })
      actions.setConnectionState(ConnectionState.ERROR)
    },

    /**
     * Audio management for listeners
     */
    setListenerVolume: (listenerId: string, volume: number) => {
      actions.updateListener(listenerId, {
        audioPlayback: {
          ...state.participants.listeners[listenerId]?.audioPlayback,
          volume: Math.max(0, Math.min(1, volume))
        }
      })
    },

    setListenerMuted: (listenerId: string, muted: boolean) => {
      actions.updateListener(listenerId, {
        audioPlayback: {
          ...state.participants.listeners[listenerId]?.audioPlayback,
          muted
        }
      })
    },

    setListenerAutoplayBlocked: (listenerId: string, blocked: boolean) => {
      actions.updateListener(listenerId, {
        audioPlayback: {
          ...state.participants.listeners[listenerId]?.audioPlayback,
          autoplayBlocked: blocked
        }
      })
    },

    /**
     * Global room error management (replacing webrtc-error-store)
     */
    setGlobalRoomError: (error: string, recoverable: boolean = true) => {
      setState('connection', 'lastError', Option.some(error))
      if (!recoverable) {
        setState('connection', 'state', ConnectionState.ERROR)
      }
    },

    clearGlobalRoomError: () => {
      setState('connection', 'lastError', Option.none())
    },

    /**
     * WebRTC status management
     */
    setWebRTCStatus: (status: 'disconnected' | 'connecting' | 'connected' | 'failed', error?: WebRTCError) => {
      setState('webrtcStatus', {
        status,
        lastConnectedAt: status === 'connected' ? Option.some(new Date()) : state.webrtcStatus.lastConnectedAt,
        error: error ? Option.some(error) : Option.none()
      })
    },

    clearWebRTCStatus: () => {
      setState('webrtcStatus', {
        status: 'disconnected',
        lastConnectedAt: Option.none(),
        error: Option.none()
      })
    },

    /**
     * Producer confirmation management (pure state only)
     */
    setProducerConfirmation: (producerId: string) => {
      actions.updateDJState({
        producer: Option.match(state.participants.dj?.producer || Option.none(), {
          onSome: (currentProducer) => Option.some({
            ...currentProducer as any,
            id: Option.some(producerId)
          }),
          onNone: () => Option.some({
            producer: Option.none(),
            id: Option.some(producerId),
            kind: 'audio' as const,
            paused: false,
            rtpParameters: Option.none(),
            track: Option.none(),
            appData: Option.none(),
            stats: Option.none(),
            createdAt: Option.some(new Date()),
            error: Option.none()
          })
        })
      })
    },

    /**
     * Listener confirmation management (pure state only)
     */
    setListenerTransportConfirmation: (listenerId: string) => {
      const existingListener = state.participants.listeners[listenerId]
      if (existingListener && existingListener.receiveTransport) {
        const currentTransport = existingListener.receiveTransport as any
        actions.updateListener(listenerId, {
          receiveTransport: {
            ...currentTransport,
            connected: true,
            connectError: Option.none()
          }
        })
      }
    },

    setListenerConsumerConfirmation: (listenerId: string, consumerId: string, producerId: string, consumerParameters: any) => {
      const existingListener = state.participants.listeners[listenerId]
      if (existingListener) {
        const currentConsumer = existingListener.consumer ? existingListener.consumer as any : null
        actions.updateListener(listenerId, {
          consumer: currentConsumer ? {
            ...currentConsumer,
            id: Option.some(consumerId),
            producerId: Option.some(producerId),
            rtpParameters: Option.some(consumerParameters)
          } : {
            consumer: Option.none(),
            id: Option.some(consumerId),
            producerId: Option.some(producerId),
            kind: 'audio' as const,
            paused: false,
            rtpParameters: Option.some(consumerParameters),
            track: Option.none(),
            appData: Option.none(),
            stats: Option.none(),
            createdAt: Option.some(new Date()),
            error: Option.none()
          }
        })
      }
    }
  }
  
  // Auto-run effects with runtime when available
  const runEffect = <E, A>(effect: Effect.Effect<A, E>) => {
    Option.match(effectRuntime, {
      onSome: (runtime) => {
        Runtime.runPromiseExit(runtime)(effect).then(exit => {
          if (exit._tag === 'Failure') {
            console.error('Room store effect failed:', exit.cause)
          }
        })
      },
      onNone: () => {
        console.warn('Effect runtime not available, deferring effect')
      }
    })
  }

  return {
    // Reactive state (read-only)
    state: state as Readonly<RoomState>,
    
    // Actions
    actions,
    
    // Computed values
    get connectionState() {
      return state.connection.state as ConnectionState
    },
    
    get isConnected() {
      return state.connection.state === ConnectionState.CONNECTED || state.connection.state === ConnectionState.STREAMING
    },
    
    get isConnecting() {
      return state.connection.state === ConnectionState.CONNECTING
    },
    
    get isDJFlowActive() {
      const djState = this.djState
      if (!djState) return false
      const step = (djState as any).currentStep
      return step !== 'idle' && step !== 'error' && step !== 'cleanup'
    },
    
    get hasConnectionError() {
      return state.connection.state === ConnectionState.ERROR
    },
    
    get roomId() {
      return Option.getOrNull(state.connection.roomId)
    },
    
    get connectionType() {
      return Option.getOrNull(state.connection.connectionType)
    },
    
    get roomMetadata(): RoomMetadata | null {
      return Option.getOrNull(state.metadata)
    },
    
    // DJ state getters
    get djState() {
      return Option.getOrNull(state.participants.dj)
    },
    
    get djFlowStep() {
      return Option.match(state.participants.dj, {
        onSome: (dj) => (dj as any).currentStep,
        onNone: () => 'idle' as DJFlowStep
      })
    },
    
    get isDJStreaming() {
      return Option.match(state.participants.dj, {
        onSome: (dj) => (dj as any).currentStep === 'streaming',
        onNone: () => false
      })
    },
    
    // Listener state getters
    get listeners() {
      return Object.values(state.participants.listeners as Record<string, ListenerState>)
    },
    
    get listenerCount() {
      return Object.keys(state.participants.listeners as Record<string, ListenerState>).length
    },
    
    getListener(sessionId: string) {
      return (state.participants.listeners as Record<string, ListenerState>)[sessionId]
    },
    
    // Streaming status
    get streamingStatus() {
      return state.streaming.status
    },
    
    get isStreaming() {
      return state.streaming.status === 'streaming'
    },
    
    get isPaused() {
      return state.streaming.status === 'paused'
    },
    
    // Error states
    get connectionError() {
      return Option.getOrNull(state.connection.lastError)
    },
    
    get streamingError() {
      return Option.getOrNull(state.streaming.lastError)
    },
    
    get djError() {
      return Option.match(state.participants.dj, {
        onSome: (dj) => Option.getOrNull((dj as any).stepError),
        onNone: () => null
      })
    },
    
    get selectedDeviceId() {
      return Option.match(state.participants.dj, {
        onSome: (dj) => Option.getOrNull((dj as any).audioTrack?.deviceId),
        onNone: () => null
      })
    },
    
    // WebRTC status getters
    get webrtcStatus() {
      return state.webrtcStatus.status
    },
    
    get webrtcError() {
      return Option.getOrNull(state.webrtcStatus.error)
    },
    
    get isWebRTCConnected() {
      return state.webrtcStatus.status === 'connected'
    },
    
    get isWebRTCConnecting() {
      return state.webrtcStatus.status === 'connecting'
    },
    
    get hasWebRTCError() {
      return state.webrtcStatus.status === 'failed'
    },
    
    // Producer confirmation getters (pure state)
    get hasProducerConfirmation() {
      return Option.match(state.participants.dj, {
        onSome: (dj) => Option.match((dj as any).producer || Option.none(), {
          onSome: (producer: any) => Option.isSome(producer.id),
          onNone: () => false
        }),
        onNone: () => false
      })
    },
    
    get confirmedProducerId() {
      return Option.match(state.participants.dj, {
        onSome: (dj) => Option.match((dj as any).producer || Option.none(), {
          onSome: (producer: any) => Option.getOrNull(producer.id),
          onNone: () => null
        }),
        onNone: () => null
      })
    },
    
    // Listener confirmation getters (pure state)
    getListenerTransportConfirmation: (listenerId: string) => {
      const listener = state.participants.listeners[listenerId]
      if (!listener || !listener.receiveTransport) return false
      return listener.receiveTransport.connected === true
    },
    
    getListenerConsumerConfirmation: (listenerId: string) => {
      const listener = state.participants.listeners[listenerId]
      if (!listener || !listener.consumer) return { hasConsumer: false, consumerId: null, producerId: null, consumerParameters: null }
      
      const consumer = listener.consumer
      return {
        hasConsumer: Option.isSome(consumer.id),
        consumerId: Option.getOrNull(consumer.id),
        producerId: Option.getOrNull(consumer.producerId),
        consumerParameters: Option.getOrNull(consumer.rtpParameters)
      }
    },
    
    // Utility getters
    get participantCount() {
      return state.participants.totalCount
    },
    
    // Effect runner (for external use)
    runEffect
  }
}

/**
 * Room store type
 */
export type RoomStore = ReturnType<typeof createRoomStore>

/**
 * Singleton room store instance
 */
let roomStoreInstance: RoomStore | null = null

/**
 * Get or create the singleton room store instance
 */
export function getRoomStore(): RoomStore {
  if (!roomStoreInstance) {
    roomStoreInstance = createRoomStore()
  }
  return roomStoreInstance
}