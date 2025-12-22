/**
 * DJ Store
 * 
 * Self-contained DJ state management with embedded MediaSoup state.
 * Manages DJ flow steps, device, transport, producer, and audio tracks using SolidJS signals.
 * 
 * This replaces the DJ-related parts of the monolithic room store
 * and provides focused, high-performance reactive state management.
 */

import { createMemo } from 'solid-js'
import { createStore } from 'solid-js/store'
import { 
  type DJStateType, 
  type DJFlowStepType,
  createInitialDJState 
} from '../domain/schemas/dj.schema'

/**
 * DJ actions interface (using schema-inferred types)
 */
export interface DJActions {
  // State management
  setState: (djState: DJStateType) => void
  updateState: (updates: Partial<DJStateType>) => void
  clearState: () => void
  
  // Flow management
  setFlowStep: (step: DJFlowStepType, error?: string) => void
  setFlowError: (error: string, step?: DJFlowStepType) => void
  clearFlowError: () => void
  
  // Device management
  setSelectedDeviceId: (deviceId: string) => void
  clearSelectedDevice: () => void
  
  // Producer management
  setProducerConfirmation: (producerId: string) => void
  clearProducer: () => void
  
  // Stream management
  startPreview: (stream: MediaStream) => void
  stopPreview: () => void
  
  // Reset
  reset: () => void
}

/**
 * DJ store interface (using schema-inferred types)
 */
export interface DJStore {
  // Reactive state (read-only)
  readonly state: DJStateType | null
  
  // Actions
  readonly actions: DJActions
  
  // Computed values (using createMemo for performance)
  readonly hasDJState: () => boolean
  readonly currentFlowStep: () => DJFlowStepType
  readonly isIdle: () => boolean
  readonly isStreaming: () => boolean
  readonly isConnecting: () => boolean
  readonly hasFlowError: () => boolean
  readonly flowError: () => string | null
  readonly selectedDeviceId: () => string | null
  readonly hasProducer: () => boolean
  readonly producerId: () => string | null
  readonly hasPreviewStream: () => boolean
  readonly previewStream: () => MediaStream | null
  readonly isFlowActive: () => boolean
  readonly canStartFlow: () => boolean
}

/**
 * DJ store state wrapper (using schema-inferred types)
 */
interface DJStoreState {
  djState: DJStateType | null
}

/**
 * Initial DJ store state
 */
const createInitialDJStoreState = (): DJStoreState => ({
  djState: null
})

/**
 * Create DJ Store
 * 
 * Creates a new DJ store with SolidJS signals and computed values.
 * Uses fine-grained reactivity for optimal performance.
 */
export const createDJStore = (): DJStore => {
  // Main reactive state using SolidJS store
  const [storeState, setStoreState] = createStore(createInitialDJStoreState())
  
  // Actions implementation
  const actions: DJActions = {
    setState: (djState: DJStateType) => {
      setStoreState('djState', djState)
    },

    updateState: (updates: Partial<DJStateType>) => {
      if (storeState.djState) {
        setStoreState('djState', current => current ? { ...current, ...updates } : null)
      } else {
        // Initialize DJ state with updates if none exists
        const newDJState = { ...createInitialDJState(), ...updates }
        setStoreState('djState', newDJState)
      }
    },

    clearState: () => {
      setStoreState('djState', null)
    },

    setFlowStep: (step: DJFlowStepType, error?: string) => {
      const updates: Partial<DJStateType> = {
        currentStep: step,
        stepStartedAt: new Date().toISOString(),
        stepError: error || null
      }
      
      if (error) {
        updates.lastError = {
          step,
          error,
          timestamp: new Date().toISOString(),
          recoverable: false
        }
      }
      
      actions.updateState(updates)
    },

    setFlowError: (error: string, step?: DJFlowStepType) => {
      const errorStep = step || 'error'
      actions.updateState({
        currentStep: errorStep,
        stepError: error,
        lastError: {
          step: errorStep,
          error,
          timestamp: new Date().toISOString(),
          recoverable: false
        }
      })
    },

    clearFlowError: () => {
      actions.updateState({
        stepError: null,
        lastError: null
      })
    },

    setSelectedDeviceId: (deviceId: string) => {
      if (!storeState.djState) {
        actions.updateState({})
      }
      
      const currentAudioTrack = storeState.djState?.audioTrack || createInitialDJState().audioTrack
      actions.updateState({
        audioTrack: {
          ...currentAudioTrack,
          deviceId
        }
      })
    },

    clearSelectedDevice: () => {
      if (storeState.djState) {
        const currentAudioTrack = storeState.djState.audioTrack
        actions.updateState({
          audioTrack: {
            ...currentAudioTrack,
            deviceId: null
          }
        })
      }
    },

    setProducerConfirmation: (producerId: string) => {
      const currentProducer = storeState.djState?.producer
      
      if (currentProducer) {
        actions.updateState({
          producer: {
            ...currentProducer,
            id: producerId
          }
        })
      } else {
        // Create minimal producer state for confirmation
        actions.updateState({
          producer: {
            producer: null,
            id: producerId,
            kind: 'audio' as const,
            paused: false,
            rtpParameters: null,
            track: null,
            appData: null,
            stats: null,
            createdAt: new Date().toISOString(),
            error: null
          }
        })
      }
    },

    clearProducer: () => {
      actions.updateState({
        producer: null
      })
    },

    startPreview: (stream: MediaStream) => {
      const audioTrack = stream.getAudioTracks()[0]
      
      actions.updateState({
        streams: {
          localStream: stream,
          audioTrack,
          streamId: stream.id,
          createdAt: new Date().toISOString()
        }
      })
    },

    stopPreview: () => {
      // Stop existing stream tracks
      const currentStreams = storeState.djState?.streams
      if (currentStreams) {
        const localStream = currentStreams.localStream
        
        if (localStream) {
          localStream.getTracks().forEach(track => track.stop())
        }
      }
      
      // Clear streams from state
      actions.updateState({
        streams: null
      })
    },

    reset: () => {
      // Stop any preview streams before reset
      actions.stopPreview()
      
      // Clear DJ state
      setStoreState('djState', Option.none())
    }
  }

  // Computed values using createMemo for performance
  const hasDJState = createMemo(() => !!storeState.djState)

  const currentFlowStep = createMemo(() => 
    storeState.djState?.currentStep || 'idle'
  )

  const isIdle = createMemo(() => currentFlowStep() === 'idle')

  const isStreaming = createMemo(() => currentFlowStep() === 'streaming')

  const isConnecting = createMemo(() => {
    const step = currentFlowStep()
    return step === 'connecting' || step === 'initializing' || step === 'device_loading' ||
           step === 'requesting_media' || step === 'requesting_transport' || step === 'creating_transport' ||
           step === 'connecting_transport' || step === 'creating_producer' || step === 'validating_connection'
  })

  // Computed values with proper Option handling for SolidJS 2025 reactivity
  const hasFlowError = createMemo(() => {
    // Don't destructure - maintain reactivity by accessing properties directly
    return !!(storeState.djState && Option.isSome(storeState.djState.stepError))
  })

  const flowError = createMemo(() => {
    // Safe Option.getOrNull for UI consumption (perfect for <Show> components)
    return storeState.djState && Option.isSome(storeState.djState.stepError)
      ? Option.getOrNull(storeState.djState.stepError)
      : null
  })

  const selectedDeviceId = createMemo(() => {
    // Maintain fine-grained reactivity - no destructuring
    return storeState.djState && Option.isSome(storeState.djState.audioTrack.deviceId)
      ? Option.getOrNull(storeState.djState.audioTrack.deviceId)
      : null
  })

  const hasProducer = createMemo(() => {
    // Direct property access for reactivity
    return !!(storeState.djState && Option.isSome(storeState.djState.producer))
  })

  const producerId = createMemo(() => {
    // Safe Option extraction for UI
    if (storeState.djState && Option.isSome(storeState.djState.producer)) {
      const producer = Option.getOrNull(storeState.djState.producer)
      return producer && Option.isSome(producer.id) ? Option.getOrNull(producer.id) : null
    }
    return null
  })

  const hasPreviewStream = createMemo(() => {
    // Direct property access for reactivity
    return !!(storeState.djState && Option.isSome(storeState.djState.streams))
  })

  const previewStream = createMemo(() => {
    // Convert Option to nullable for <Show> component usage
    if (storeState.djState && Option.isSome(storeState.djState.streams)) {
      const streams = Option.getOrNull(storeState.djState.streams)
      return streams && Option.isSome(streams.localStream) 
        ? Option.getOrNull(streams.localStream) 
        : null
    }
    return null
  })

  const isFlowActive = createMemo(() => {
    const step = currentFlowStep()
    return step !== 'idle' && step !== 'error' && step !== 'cleanup'
  })

  const canStartFlow = createMemo(() => {
    const step = currentFlowStep()
    return step === 'idle' || step === 'error'
  })

  return {
    // Reactive state (read-only access)
    get state() {
      return storeState.djState as Readonly<DJStateType> | null
    },
    
    // Actions
    actions,
    
    // Computed values (memoized for performance)
    hasDJState,
    currentFlowStep,
    isIdle,
    isStreaming,
    isConnecting,
    hasFlowError,
    flowError,
    selectedDeviceId,
    hasProducer,
    producerId,
    hasPreviewStream,
    previewStream,
    isFlowActive,
    canStartFlow
  }
}

/**
 * DJ store type export
 */
export type DJStore = ReturnType<typeof createDJStore>

/**
 * Singleton DJ store instance
 * 
 * Global instance for application-wide DJ state management.
 * Components access this through Context providers.
 */
let djStoreInstance: DJStore | null = null

/**
 * Get or create the singleton DJ store instance
 */
export const getDJStore = (): DJStore => {
  if (!djStoreInstance) {
    djStoreInstance = createDJStore()
  }
  return djStoreInstance
}

/**
 * Reset the global DJ store (useful for testing)
 */
export const resetGlobalDJStore = (): void => {
  // Stop preview streams before reset
  if (djStoreInstance) {
    djStoreInstance.actions.reset()
  }
  djStoreInstance = null
}

/**
 * DJ Helper Functions
 * 
 * Utility functions for working with DJ state.
 */
export const DJHelpers = {
  /**
   * Check if DJ can transition to a specific flow step
   */
  canTransitionTo: (currentStep: DJFlowStepType, targetStep: DJFlowStepType): boolean => {
    // Define valid transitions
    const validTransitions: Record<DJFlowStepType, DJFlowStepType[]> = {
      'idle': ['announcing', 'connecting'],
      'announcing': ['connecting', 'error'],
      'connecting': ['initializing', 'error'],
      'initializing': ['device_loading', 'error'],
      'device_loading': ['requesting_media', 'error'],
      'requesting_media': ['requesting_transport', 'error'],
      'requesting_transport': ['creating_transport', 'error'],
      'creating_transport': ['connecting_transport', 'error'],
      'connecting_transport': ['creating_producer', 'error'],
      'creating_producer': ['validating_connection', 'error'],
      'validating_connection': ['publishing', 'error'],
      'publishing': ['streaming', 'error'],
      'streaming': ['error', 'cleanup'],
      'error': ['cleanup', 'idle'],
      'cleanup': ['idle']
    }
    
    return validTransitions[currentStep]?.includes(targetStep) || false
  },

  /**
   * Get human-readable flow step description
   */
  getStepDescription: (step: DJFlowStepType): string => {
    const descriptions: Record<DJFlowStepType, string> = {
      'idle': 'Ready to start',
      'announcing': 'Announcing room',
      'connecting': 'Connecting to room',
      'initializing': 'Initializing room',
      'device_loading': 'Loading audio device',
      'requesting_media': 'Requesting microphone access',
      'requesting_transport': 'Requesting transport',
      'creating_transport': 'Creating WebRTC transport',
      'connecting_transport': 'Connecting transport',
      'creating_producer': 'Creating audio producer',
      'validating_connection': 'Validating connection',
      'publishing': 'Publishing stream',
      'streaming': 'Live streaming',
      'error': 'Error occurred',
      'cleanup': 'Cleaning up'
    }
    
    return descriptions[step] || step
  },

  /**
   * Check if flow step indicates an error state
   */
  isErrorStep: (step: DJFlowStepType): boolean => {
    return step === 'error' || step === 'cleanup'
  },

  /**
   * Check if flow step indicates active streaming
   */
  isActiveStep: (step: DJFlowStepType): boolean => {
    return step !== 'idle' && step !== 'error' && step !== 'cleanup'
  }
}