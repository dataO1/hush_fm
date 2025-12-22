/**
 * Room Metadata Store
 * 
 * Pure room information management without participant state.
 * Manages room metadata, streaming status, and room lifecycle using SolidJS signals.
 * 
 * This replaces the room metadata parts of the monolithic room store
 * and provides clean separation between room info and participant management.
 */

import { createMemo } from 'solid-js'
import { createStore } from 'solid-js/store'
import { Option } from 'effect'
import type { RoomMetadataType, StreamingStatus } from '../domain/schemas/room.schema'

/**
 * Room metadata state interface - uses Option types for consistency with domain schemas
 */
export interface RoomMetadataState {
  metadata: Option.Option<RoomMetadataType>
  streaming: {
    status: StreamingStatus
    startedAt: Option.Option<Date>
    pausedAt: Option.Option<Date>
    lastError: Option.Option<string>
  }
}

/**
 * Room metadata actions interface
 */
export interface RoomMetadataActions {
  // Metadata management
  setRoomMetadata: (metadata: RoomMetadataType) => void
  updateRoomMetadata: (updates: Partial<RoomMetadataType>) => void
  clearRoomMetadata: () => void
  
  // Streaming status management
  setStreamingStatus: (status: StreamingStatus) => void
  startStreaming: () => void
  pauseStreaming: () => void
  resumeStreaming: () => void
  stopStreaming: () => void
  setStreamingError: (error: string) => void
  clearStreamingError: () => void
  
  // Reset
  reset: () => void
}


/**
 * Initial room metadata state
 */
const createInitialRoomMetadataState = (): RoomMetadataState => ({
  metadata: Option.none(),
  streaming: {
    status: 'idle',
    startedAt: Option.none(),
    pausedAt: Option.none(),
    lastError: Option.none()
  }
})

/**
 * Create Room Metadata Store
 * 
 * Creates a new room metadata store with SolidJS signals and computed values.
 * Uses fine-grained reactivity for optimal performance.
 */
export const createRoomMetadataStore = (): RoomMetadataStore => {
  // Main reactive state using SolidJS store
  const [state, setState] = createStore(createInitialRoomMetadataState())
  
  // Actions implementation
  const actions: RoomMetadataActions = {
    setRoomMetadata: (metadata: RoomMetadataType) => {
      setState('metadata', Option.some(metadata))
    },

    updateRoomMetadata: (updates: Partial<RoomMetadataType>) => {
      if (Option.isSome(state.metadata)) {
        const current = Option.getOrNull(state.metadata)
        if (current) {
          setState('metadata', Option.some({ ...current, ...updates }))
        }
      } else {
        console.warn('Cannot update room metadata: no metadata set')
      }
    },

    clearRoomMetadata: () => {
      setState('metadata', Option.none())
    },

    setStreamingStatus: (status: StreamingStatus) => {
      setState('streaming', 'status', status)
      
      // Update timestamps based on status
      const now = new Date()
      switch (status) {
        case 'streaming':
          setState('streaming', 'startedAt', Option.some(now))
          setState('streaming', 'pausedAt', Option.none())
          setState('streaming', 'lastError', Option.none())
          break
        case 'paused':
          setState('streaming', 'pausedAt', Option.some(now))
          break
        case 'idle':
        case 'stopping':
          setState('streaming', 'startedAt', Option.none())
          setState('streaming', 'pausedAt', Option.none())
          break
        case 'error':
          // Keep timestamps but don't clear error
          break
      }
    },

    startStreaming: () => {
      const now = new Date()
      setState('streaming', {
        status: 'streaming',
        startedAt: Option.some(now),
        pausedAt: Option.none(),
        lastError: Option.none()
      })
    },

    pauseStreaming: () => {
      setState('streaming', {
        status: 'paused',
        pausedAt: Option.some(new Date())
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

    clearStreamingError: () => {
      setState('streaming', 'lastError', Option.none())
      
      // If status was error and we're clearing, go to idle
      if (state.streaming.status === 'error') {
        setState('streaming', 'status', 'idle')
      }
    },

    reset: () => {
      setState(createInitialRoomMetadataState())
    }
  }

  // Computed values using createMemo for performance
  const hasRoomMetadata = createMemo(() => Option.isSome(state.metadata))

  const roomId = createMemo(() => {
    const metadata = Option.getOrNull(state.metadata)
    return metadata?.id || null
  })

  const roomName = createMemo(() => {
    const metadata = Option.getOrNull(state.metadata)
    return metadata?.name || null
  })

  const djName = createMemo(() => {
    const metadata = Option.getOrNull(state.metadata)
    return metadata?.djName || null
  })

  const isPublic = createMemo(() => {
    const metadata = Option.getOrNull(state.metadata)
    return metadata?.isPublic || false
  })

  const roomTags = createMemo(() => {
    const metadata = Option.getOrNull(state.metadata)
    return metadata?.tags || []
  })

  const isStreaming = createMemo(() => state.streaming.status === 'streaming')

  const isPaused = createMemo(() => state.streaming.status === 'paused')

  const isIdle = createMemo(() => state.streaming.status === 'idle')

  const hasStreamingError = createMemo(() => 
    state.streaming.status === 'error' || Option.isSome(state.streaming.lastError)
  )

  const streamingError = createMemo(() => Option.getOrNull(state.streaming.lastError))

  const streamDuration = createMemo(() => {
    const startedAt = Option.getOrNull(state.streaming.startedAt)
    if (!startedAt) return null
    
    const pausedAt = Option.getOrNull(state.streaming.pausedAt)
    const endTime = pausedAt || new Date()
    return endTime.getTime() - startedAt.getTime()
  })

  return {
    // Reactive state (read-only access)
    state: state as Readonly<RoomMetadataState>,
    
    // Actions
    actions,
    
    // Computed values (memoized for performance)
    hasRoomMetadata,
    roomId,
    roomName,
    djName,
    isPublic,
    roomTags,
    isStreaming,
    isPaused,
    isIdle,
    hasStreamingError,
    streamingError,
    streamDuration
  }
}

/**
 * Room metadata store type export
 */
export type RoomMetadataStore = ReturnType<typeof createRoomMetadataStore>

/**
 * Singleton room metadata store instance
 * 
 * Global instance for application-wide room metadata management.
 * Components access this through Context providers.
 */
let roomMetadataStoreInstance: RoomMetadataStore | null = null

/**
 * Get or create the singleton room metadata store instance
 */
export const getRoomMetadataStore = (): RoomMetadataStore => {
  if (!roomMetadataStoreInstance) {
    roomMetadataStoreInstance = createRoomMetadataStore()
  }
  return roomMetadataStoreInstance
}

/**
 * Reset the global room metadata store (useful for testing)
 */
export const resetGlobalRoomMetadataStore = (): void => {
  roomMetadataStoreInstance = null
}

/**
 * Room Metadata Helper Functions
 * 
 * Utility functions for creating and validating room metadata.
 */
export const RoomMetadataHelpers = {
  /**
   * Create room metadata from API response
   */
  createFromAPI: (apiData: {
    id: string
    name: string
    description?: string
    djName: string
    isPublic?: boolean
    createdAt?: string | Date
    tags?: string[]
  }): RoomMetadata => ({
    id: apiData.id,
    name: apiData.name,
    description: Option.fromNullable(apiData.description),
    djName: apiData.djName,
    isPublic: apiData.isPublic ?? true,
    createdAt: typeof apiData.createdAt === 'string' 
      ? new Date(apiData.createdAt) 
      : apiData.createdAt || new Date(),
    tags: apiData.tags || []
  }),

  /**
   * Validate room metadata
   */
  isValid: (metadata: any): metadata is RoomMetadataType => {
    return !!(
      metadata &&
      typeof metadata.id === 'string' &&
      typeof metadata.name === 'string' &&
      typeof metadata.djName === 'string' &&
      typeof metadata.isPublic === 'boolean' &&
      metadata.createdAt instanceof Date &&
      Array.isArray(metadata.tags)
    )
  },

  /**
   * Get room display name with fallback
   */
  getDisplayName: (metadata: O.Option<RoomMetadataType>): string => {
    return O.match(metadata, {
      onNone: () => 'Unknown Room',
      onSome: (meta) => meta.name || `Room ${meta.id}`
    })
  },

  /**
   * Get DJ display name with fallback
   */
  getDJDisplayName: (metadata: O.Option<RoomMetadataType>): string => {
    return O.match(metadata, {
      onNone: () => 'Unknown DJ', 
      onSome: (meta) => meta.djName || 'DJ'
    })
  }
}