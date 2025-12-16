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

import { createSignal, createEffect, onCleanup } from 'solid-js'
import { createStore } from 'solid-js/store'
import { Effect, Option, Runtime, Layer } from 'effect'
import {
  type RoomState,
  type RoomMetadata,
  type StreamingStatus,
  createInitialRoomState
} from '../domain/schemas/room.schema'
import {
  type DJState,
  type DJFlowStep,
  createInitialDJState
} from '../domain/schemas/dj.schema'
import {
  type ListenerState,
  type ListenerFlowStep
} from '../domain/schemas/listener.schema'
import {
  type WSConnectionState
} from '../domain/schemas/lobby.schema'
import { closeWebSocket } from '../services/websocket/websocket.service'
import {
  RoomConnectionError
} from '../domain/errors'

/**
 * Room store actions - manages current room with DJ + listeners
 */
export interface RoomStoreActions {
  // Room connection management
  setRoomWebSocket: (ws: WebSocket, roomId: string, connectionType: 'dj' | 'listener') => Effect.Effect<void, RoomConnectionError>
  disconnectFromRoom: () => Effect.Effect<void, never>
  updateConnectionState: (state: WSConnectionState) => void
  
  // Room metadata management
  setRoomMetadata: (metadata: RoomMetadata) => void
  updateRoomMetadata: (updates: Partial<RoomMetadata>) => void
  
  // DJ state management (embedded MediaSoup state)
  setDJState: (djState: DJState) => void
  updateDJState: (updates: Partial<DJState>) => void
  setDJFlowStep: (step: DJFlowStep) => void
  setDJError: (error: string, step?: DJFlowStep) => void
  clearDJError: () => void
  
  // Listener state management (embedded MediaSoup state)
  addListener: (listener: ListenerState) => void
  updateListener: (listenerId: string, updates: Partial<ListenerState>) => void
  removeListener: (listenerId: string) => void
  setListenerFlowStep: (listenerId: string, step: ListenerFlowStep) => void
  setListenerError: (listenerId: string, error: string, step?: ListenerFlowStep) => void
  clearListenerError: (listenerId: string) => void
  
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
  
  // Error management (replacing webrtc-error-store)
  setGlobalRoomError: (error: string, recoverable?: boolean) => void
  clearGlobalRoomError: () => void
}

/**
 * Create enhanced room store with DJ + listeners
 */
export const createRoomStore = () => {
  // Main reactive state - starts with initial room state
  const [state, setState] = createStore(createInitialRoomState() as any)
  
  // Additional UI signals
  const [isConnecting, setIsConnecting] = createSignal(false)
  const [isDJFlowActive, setIsDJFlowActive] = createSignal(false)
  const [hasGlobalError, setHasGlobalError] = createSignal(false)
  const [globalErrorMessage, setGlobalErrorMessage] = createSignal<string>('')
  
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
  const generateListenerId = (): string => `listener_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  
  // Event handling will be implemented by flow services
  
  // Actions implementation with domain schema integration
  const actions: RoomStoreActions = {
    /**
     * Set room WebSocket connection
     */
    setRoomWebSocket: (ws: WebSocket, roomId: string, connType: 'dj' | 'listener') => {
      return Effect.gen(function* (_) {
        roomWebSocket = Option.some(ws)
        
        setState('connection', {
          websocket: Option.some(ws),
          state: 'connected',
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
      return Effect.gen(function* (_) {
        if (Option.isSome(roomWebSocket)) {
          yield* _(closeWebSocket(roomWebSocket.value))
          roomWebSocket = Option.none()
        }
        
        setState('connection', {
          websocket: Option.none(),
          state: 'disconnected',
          roomId: Option.none(),
          connectionType: Option.none(),
          connectionAttempts: 0,
          lastError: Option.none()
        })
        
        // Reset DJ and listeners
        setState('participants', {
          dj: Option.none(),
          listeners: [],
          totalCount: 0,
          maxListeners: Option.none()
        })
      })
    },

    /**
     * Update connection state
     */
    updateConnectionState: (newState: WSConnectionState) => {
      setState('connection', 'state', newState)
      setIsConnecting(newState === 'connecting')
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
      setIsDJFlowActive(djState.currentStep !== 'idle' && djState.currentStep !== 'error')
    },

    updateDJState: (updates: Partial<DJState>) => {
      Option.match(state.participants.dj, {
        onSome: (currentDJ) => {
          const updatedDJ = { ...currentDJ as any, ...updates }
          setState('participants', 'dj', Option.some(updatedDJ))
          setIsDJFlowActive(updatedDJ.currentStep !== 'idle' && updatedDJ.currentStep !== 'error')
        },
        onNone: () => {
          // Initialize DJ state with updates
          const newDJ = { ...createInitialDJState(), ...updates }
          setState('participants', 'dj', Option.some(newDJ))
          setIsDJFlowActive(newDJ.currentStep !== 'idle' && newDJ.currentStep !== 'error')
        }
      })
    },

    setDJFlowStep: (step: DJFlowStep) => {
      actions.updateDJState({
        currentStep: step,
        stepStartedAt: Option.some(new Date()),
        stepError: Option.none()
      })
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

    /**
     * Listener state management (using domain schema)
     */
    addListener: (listener: ListenerState) => {
      setState('participants', 'listeners', (listeners: ListenerState[]) => [
        ...listeners,
        { ...(listener as any), id: (listener as any).id || generateListenerId() }
      ])
      setState('participants', 'totalCount', (count: number) => count + 1)
    },

    updateListener: (listenerId: string, updates: Partial<ListenerState>) => {
      setState('participants', 'listeners', (listeners: ListenerState[]) =>
        listeners.map((listener: any) => 
          listener.id === listenerId 
            ? { ...listener, ...updates }
            : listener
        )
      )
    },

    removeListener: (listenerId: string) => {
      setState('participants', 'listeners', (listeners: ListenerState[]) =>
        listeners.filter((listener: any) => listener.id !== listenerId)
      )
      setState('participants', 'totalCount', (count: number) => Math.max(0, count - 1))
    },

    setListenerFlowStep: (listenerId: string, step: ListenerFlowStep) => {
      actions.updateListener(listenerId, {
        currentStep: step,
        stepStartedAt: Option.some(new Date()),
        stepError: Option.none()
      })
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
    },

    pauseStreaming: () => {
      setState('streaming', {
        status: 'paused',
        pausedAt: Option.some(new Date()),
        lastError: Option.none()
      })
    },

    resumeStreaming: () => {
      setState('streaming', {
        status: 'streaming',
        pausedAt: Option.none(),
        lastError: Option.none()
      })
    },

    stopStreaming: () => {
      setState('streaming', {
        status: 'idle',
        startedAt: Option.none(),
        pausedAt: Option.none(),
        lastError: Option.none()
      })
    },

    setStreamingError: (error: string) => {
      setState('streaming', {
        status: 'error',
        lastError: Option.some(error)
      })
    },

    /**
     * Audio management for listeners
     */
    setListenerVolume: (listenerId: string, volume: number) => {
      actions.updateListener(listenerId, {
        audioPlayback: {
          ...((state.participants.listeners as any[]).find(l => l.id === listenerId)?.audioPlayback || {}),
          volume: Math.max(0, Math.min(1, volume))
        }
      })
    },

    setListenerMuted: (listenerId: string, muted: boolean) => {
      actions.updateListener(listenerId, {
        audioPlayback: {
          ...((state.participants.listeners as any[]).find(l => l.id === listenerId)?.audioPlayback || {}),
          muted
        }
      })
    },

    /**
     * Global room error management (replacing webrtc-error-store)
     */
    setGlobalRoomError: (error: string, recoverable: boolean = true) => {
      setHasGlobalError(true)
      setGlobalErrorMessage(error)
      setState('connection', 'lastError', Option.some(error))
      if (!recoverable) {
        setState('connection', 'state', 'error')
      }
    },

    clearGlobalRoomError: () => {
      setHasGlobalError(false)
      setGlobalErrorMessage('')
      setState('connection', 'lastError', Option.none())
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
    
    // UI signals  
    isConnecting,
    isDJFlowActive,
    hasGlobalError,
    globalErrorMessage,
    
    // Actions
    actions,
    
    // Computed values
    get isConnected() {
      return state.connection.state === 'connected'
    },
    
    get roomId() {
      return Option.getOrNull(state.connection.roomId)
    },
    
    get connectionType() {
      return Option.getOrNull(state.connection.connectionType)
    },
    
    get roomMetadata() {
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
      return state.participants.listeners as ListenerState[]
    },
    
    get listenerCount() {
      return state.participants.listeners.length
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