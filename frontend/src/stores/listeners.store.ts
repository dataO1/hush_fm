/**
 * Listeners Store
 * 
 * Listener collection management with embedded MediaSoup state.
 * Manages multiple listener states, their flow steps, and audio playback using SolidJS signals.
 * 
 * This replaces the listener-related parts of the monolithic room store
 * and provides focused, high-performance reactive state management for multiple listeners.
 */

import { createMemo } from 'solid-js'
import { createStore } from 'solid-js/store'
import { Option } from 'effect'
import type { ListenerState, ListenerFlowStep } from '../domain/schemas/listener.schema'
import { createInitialListenerState } from '../domain/schemas/listener.schema'

/**
 * Listeners collection state interface
 */
export interface ListenersState {
  listeners: Record<string, ListenerState>
  totalCount: number
  maxListeners: number | null
}

/**
 * Listeners collection actions interface
 */
export interface ListenersActions {
  // Listener management
  addListener: (listenerId: string, listener: ListenerState) => void
  updateListener: (listenerId: string, updates: Partial<ListenerState>) => void
  removeListener: (listenerId: string) => void
  clearAllListeners: () => void
  
  // Listener flow management
  setListenerFlowStep: (listenerId: string, step: ListenerFlowStep, error?: string) => void
  setListenerError: (listenerId: string, error: string, step?: ListenerFlowStep) => void
  clearListenerError: (listenerId: string) => void
  
  // Listener transport/consumer confirmations
  setListenerTransportConfirmation: (listenerId: string) => void
  setListenerConsumerConfirmation: (listenerId: string, consumerId: string, producerId: string, consumerParameters: any) => void
  
  // Audio management
  setListenerVolume: (listenerId: string, volume: number) => void
  setListenerMuted: (listenerId: string, muted: boolean) => void
  setListenerAutoplayBlocked: (listenerId: string, blocked: boolean) => void
  
  // Collection management
  setMaxListeners: (max: number | null) => void
  
  // Resource cleanup
  markListenerResourceClosed: (listenerId: string, resource: 'consumer' | 'transport' | 'websocket') => void
  clearListenerResources: (listenerId: string) => void
  
  // Reset
  reset: () => void
}

/**
 * Listeners store interface
 */
export interface ListenersStore {
  // Reactive state (read-only)
  readonly state: ListenersState
  
  // Actions
  readonly actions: ListenersActions
  
  // Computed values (using createMemo for performance)
  readonly listenerCount: () => number
  readonly hasListeners: () => boolean
  readonly listenerIds: () => string[]
  readonly listeners: () => ListenerState[]
  readonly activeListeners: () => ListenerState[]
  readonly streamingListeners: () => ListenerState[]
  readonly connectingListeners: () => ListenerState[]
  readonly errorListeners: () => ListenerState[]
  readonly getListener: (listenerId: string) => ListenerState | null
  readonly hasListener: (listenerId: string) => boolean
  readonly getActiveListenerRoomId: () => string | null
  
  // Collection computed values
  readonly isAtMaxCapacity: () => boolean
  readonly availableSlots: () => number | null
}

/**
 * Initial listeners state
 */
const createInitialListenersState = (): ListenersState => ({
  listeners: {},
  totalCount: 0,
  maxListeners: null
})

/**
 * Create Listeners Store
 * 
 * Creates a new listeners store with SolidJS signals and computed values.
 * Uses fine-grained reactivity for optimal performance.
 */
export const createListenersStore = (): ListenersStore => {
  // Main reactive state using SolidJS store
  const [state, setState] = createStore(createInitialListenersState())
  
  // Actions implementation
  const actions: ListenersActions = {
    addListener: (listenerId: string, listener: ListenerState) => {
      setState('listeners', listenerId, listener)
      setState('totalCount', count => count + 1)
    },

    updateListener: (listenerId: string, updates: Partial<ListenerState>) => {
      const existingListener = state.listeners[listenerId]
      if (existingListener) {
        setState('listeners', listenerId, current => ({ ...current, ...updates }))
      } else {
        // Create new listener if doesn't exist
        const newListener = { ...createInitialListenerState(), ...updates }
        setState('listeners', listenerId, newListener)
        setState('totalCount', count => count + 1)
      }
    },

    removeListener: (listenerId: string) => {
      const existingListener = state.listeners[listenerId]
      if (existingListener) {
        // Clean up any active streams/resources before removal
        const currentStreams = existingListener.audioPlayback?.mediaStream
        if (currentStreams && Option.isSome(currentStreams)) {
          const stream = Option.getOrNull(currentStreams) as MediaStream
          stream.getTracks().forEach(track => track.stop())
        }
        
        // Remove from state
        setState('listeners', listeners => {
          const { [listenerId]: removed, ...remaining } = listeners
          return remaining
        })
        setState('totalCount', count => Math.max(0, count - 1))
      }
    },

    clearAllListeners: () => {
      // Clean up all active streams first
      Object.values(state.listeners).forEach(listener => {
        const currentStreams = listener.audioPlayback?.mediaStream
        if (currentStreams && Option.isSome(currentStreams)) {
          const stream = Option.getOrNull(currentStreams) as MediaStream
          stream.getTracks().forEach(track => track.stop())
        }
      })
      
      // Clear state
      setState({
        listeners: {},
        totalCount: 0
      })
    },

    setListenerFlowStep: (listenerId: string, step: ListenerFlowStep, error?: string) => {
      actions.updateListener(listenerId, {
        currentStep: step,
        stepStartedAt: Option.some(new Date()),
        stepError: error ? Option.some(error) : Option.none()
      })
    },

    setListenerError: (listenerId: string, error: string, step?: ListenerFlowStep) => {
      const errorStep = step || 'error'
      actions.updateListener(listenerId, {
        currentStep: errorStep,
        stepError: Option.some(error),
        lastError: Option.some({
          step: errorStep,
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

    setListenerTransportConfirmation: (listenerId: string) => {
      const existingListener = state.listeners[listenerId]
      if (existingListener && existingListener.receiveTransport) {
        actions.updateListener(listenerId, {
          receiveTransport: {
            ...existingListener.receiveTransport,
            connected: true,
            connectError: Option.none()
          }
        })
      }
    },

    setListenerConsumerConfirmation: (listenerId: string, consumerId: string, producerId: string, consumerParameters: any) => {
      const existingListener = state.listeners[listenerId]
      if (existingListener) {
        const currentConsumer = existingListener.consumer || createInitialListenerState().consumer
        actions.updateListener(listenerId, {
          consumer: {
            ...currentConsumer,
            id: Option.some(consumerId),
            producerId: Option.some(producerId),
            rtpParameters: Option.some(consumerParameters)
          }
        })
      }
    },

    setListenerVolume: (listenerId: string, volume: number) => {
      const existingListener = state.listeners[listenerId]
      if (existingListener) {
        const currentAudioPlayback = existingListener.audioPlayback
        actions.updateListener(listenerId, {
          audioPlayback: {
            ...currentAudioPlayback,
            volume: Math.max(0, Math.min(1, volume))
          }
        })
      }
    },

    setListenerMuted: (listenerId: string, muted: boolean) => {
      const existingListener = state.listeners[listenerId]
      if (existingListener) {
        const currentAudioPlayback = existingListener.audioPlayback
        actions.updateListener(listenerId, {
          audioPlayback: {
            ...currentAudioPlayback,
            muted
          }
        })
      }
    },

    setListenerAutoplayBlocked: (listenerId: string, blocked: boolean) => {
      const existingListener = state.listeners[listenerId]
      if (existingListener) {
        const currentAudioPlayback = existingListener.audioPlayback
        actions.updateListener(listenerId, {
          audioPlayback: {
            ...currentAudioPlayback,
            autoplayBlocked: blocked
          }
        })
      }
    },

    setMaxListeners: (max: number | null) => {
      setState('maxListeners', max)
    },
    
    // Resource cleanup methods
    markListenerResourceClosed: (listenerId: string, resource: 'consumer' | 'transport' | 'websocket') => {
      const existingListener = state.listeners[listenerId]
      if (existingListener) {
        switch (resource) {
          case 'consumer':
            actions.updateListener(listenerId, {
              consumer: {
                ...existingListener.consumer,
                consumer: Option.none()
              }
            })
            break
          case 'transport':
            actions.updateListener(listenerId, {
              receiveTransport: {
                ...existingListener.receiveTransport,
                transport: Option.none(),
                connected: false
              }
            })
            break
          case 'websocket':
            actions.updateListener(listenerId, {
              websocket: {
                ...existingListener.websocket,
                websocket: Option.none(),
                connectionState: 'closed'
              }
            })
            break
        }
      }
    },
    
    clearListenerResources: (listenerId: string) => {
      const existingListener = state.listeners[listenerId]
      if (existingListener) {
        // Clear all MediaSoup resources
        actions.updateListener(listenerId, {
          consumer: {
            ...existingListener.consumer,
            consumer: Option.none()
          },
          receiveTransport: {
            ...existingListener.receiveTransport,
            transport: Option.none(),
            connected: false
          },
          websocket: {
            ...existingListener.websocket,
            websocket: Option.none(),
            connectionState: 'closed'
          }
        })
      }
    },

    reset: () => {
      // Clean up all streams first
      actions.clearAllListeners()
      
      // Reset state
      setState(createInitialListenersState())
    }
  }

  // Computed values using createMemo for performance
  const listenerCount = createMemo(() => Object.keys(state.listeners).length)

  const hasListeners = createMemo(() => listenerCount() > 0)

  const listenerIds = createMemo(() => Object.keys(state.listeners))

  const listeners = createMemo(() => Object.values(state.listeners))

  const activeListeners = createMemo(() => 
    listeners().filter(listener => 
      listener.currentStep !== 'idle' && 
      listener.currentStep !== 'error' && 
      listener.currentStep !== 'cleanup'
    )
  )

  const streamingListeners = createMemo(() => 
    listeners().filter(listener => listener.currentStep === 'streaming')
  )

  const connectingListeners = createMemo(() => 
    listeners().filter(listener => 
      listener.currentStep === 'connecting' || 
      listener.currentStep === 'requesting_capabilities' ||
      listener.currentStep === 'waiting_transport' ||
      listener.currentStep === 'creating_transport' ||
      listener.currentStep === 'sending_capabilities' ||
      listener.currentStep === 'waiting_consumer' ||
      listener.currentStep === 'creating_consumer'
    )
  )

  const errorListeners = createMemo(() => 
    listeners().filter(listener => listener.currentStep === 'error')
  )

  const getListener = createMemo(() => (listenerId: string) => 
    state.listeners[listenerId] || null
  )

  const hasListener = createMemo(() => (listenerId: string) => 
    !!state.listeners[listenerId]
  )

  const getActiveListenerRoomId = createMemo(() => {
    // Find the first active listener with a room connection
    for (const listener of listeners()) {
      const listenerRoomId = listener.websocket?.roomId
      if (listenerRoomId && Option.isSome(listenerRoomId)) {
        return Option.getOrNull(listenerRoomId)
      }
    }
    return null
  })

  const isAtMaxCapacity = createMemo(() => {
    if (state.maxListeners === null) return false
    return listenerCount() >= state.maxListeners
  })

  const availableSlots = createMemo(() => {
    if (state.maxListeners === null) return null
    return Math.max(0, state.maxListeners - listenerCount())
  })

  return {
    // Reactive state (read-only access)
    state: state as Readonly<ListenersState>,
    
    // Actions
    actions,
    
    // Computed values (memoized for performance)
    listenerCount,
    hasListeners,
    listenerIds,
    listeners,
    activeListeners,
    streamingListeners,
    connectingListeners,
    errorListeners,
    getListener,
    hasListener,
    getActiveListenerRoomId,
    isAtMaxCapacity,
    availableSlots
  }
}

/**
 * Listeners store type export
 */
export type ListenersStore = ReturnType<typeof createListenersStore>

/**
 * Singleton listeners store instance
 * 
 * Global instance for application-wide listeners state management.
 * Components access this through Context providers.
 */
let listenersStoreInstance: ListenersStore | null = null

/**
 * Get or create the singleton listeners store instance
 */
export const getListenersStore = (): ListenersStore => {
  if (!listenersStoreInstance) {
    listenersStoreInstance = createListenersStore()
  }
  return listenersStoreInstance
}

/**
 * Reset the global listeners store (useful for testing)
 */
export const resetGlobalListenersStore = (): void => {
  // Clean up streams before reset
  if (listenersStoreInstance) {
    listenersStoreInstance.actions.reset()
  }
  listenersStoreInstance = null
}

/**
 * Listener Helper Functions
 * 
 * Utility functions for working with listener states.
 */
export const ListenerHelpers = {
  /**
   * Check if listener can transition to a specific flow step
   */
  canTransitionTo: (currentStep: ListenerFlowStep, targetStep: ListenerFlowStep): boolean => {
    // Define valid transitions
    const validTransitions: Record<ListenerFlowStep, ListenerFlowStep[]> = {
      'idle': ['requesting_join', 'connecting'],
      'requesting_join': ['connecting', 'error'],
      'connecting': ['requesting_capabilities', 'error'],
      'requesting_capabilities': ['waiting_transport', 'error'],
      'waiting_transport': ['creating_transport', 'error'],
      'creating_transport': ['validating_connection', 'sending_capabilities', 'error'],
      'validating_connection': ['sending_capabilities', 'error'],
      'device_loading': ['sending_capabilities', 'error'],
      'sending_capabilities': ['waiting_consumer', 'error'],
      'waiting_consumer': ['creating_consumer', 'error'],
      'creating_consumer': ['connecting_transport', 'error'],
      'connecting_transport': ['streaming', 'error'],
      'streaming': ['error', 'cleanup'],
      'error': ['cleanup', 'idle'],
      'cleanup': ['idle']
    }
    
    return validTransitions[currentStep]?.includes(targetStep) || false
  },

  /**
   * Get human-readable flow step description
   */
  getStepDescription: (step: ListenerFlowStep): string => {
    const descriptions: Record<ListenerFlowStep, string> = {
      'idle': 'Ready to join',
      'requesting_join': 'Requesting to join room',
      'connecting': 'Connecting to room',
      'requesting_capabilities': 'Requesting capabilities',
      'waiting_transport': 'Waiting for transport',
      'creating_transport': 'Creating WebRTC transport',
      'validating_connection': 'Validating connection',
      'device_loading': 'Loading audio device',
      'sending_capabilities': 'Sending capabilities',
      'waiting_consumer': 'Waiting for consumer',
      'creating_consumer': 'Creating audio consumer',
      'connecting_transport': 'Connecting transport',
      'streaming': 'Listening to stream',
      'error': 'Error occurred',
      'cleanup': 'Cleaning up'
    }
    
    return descriptions[step] || step
  },

  /**
   * Check if flow step indicates an error state
   */
  isErrorStep: (step: ListenerFlowStep): boolean => {
    return step === 'error' || step === 'cleanup'
  },

  /**
   * Check if flow step indicates active listening
   */
  isActiveStep: (step: ListenerFlowStep): boolean => {
    return step !== 'idle' && step !== 'error' && step !== 'cleanup'
  },

  /**
   * Get listener transport confirmation status
   */
  getTransportConfirmation: (listener: ListenerState): boolean => {
    return listener.receiveTransport?.connected === true
  },

  /**
   * Get listener consumer confirmation status
   */
  getConsumerConfirmation: (listener: ListenerState): {
    hasConsumer: boolean
    consumerId: string | null
    producerId: string | null
    consumerParameters: any | null
  } => {
    const consumer = listener.consumer
    if (!consumer) {
      return { hasConsumer: false, consumerId: null, producerId: null, consumerParameters: null }
    }
    
    return {
      hasConsumer: Option.isSome(consumer.id),
      consumerId: Option.getOrNull(consumer.id),
      producerId: Option.getOrNull(consumer.producerId),
      consumerParameters: Option.getOrNull(consumer.rtpParameters)
    }
  }
}