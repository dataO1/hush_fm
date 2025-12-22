/**
 * Room Metadata Store Adapter
 * 
 * Effect-TS Context.Tag pattern for room metadata management.
 * Services use this tag for dependency injection, never importing the implementation directly.
 */

import { Context, Layer } from 'effect'
import type { RoomMetadataStore } from '../room-metadata.store'
import { getRoomMetadataStore } from '../room-metadata.store'
import type { RoomMetadataType, StreamingStatus } from '../../domain/schemas/room.schema'

/**
 * Room Metadata Adapter Interface
 * 
 * Service layer contract for room metadata management.
 */
export interface RoomMetadataAdapter {
  // Metadata management
  setRoomMetadata: (metadata: RoomMetadataType) => void
  updateRoomMetadata: (updates: Partial<RoomMetadataType>) => void
  clearMetadata: () => void
  
  // Streaming status
  setStreamingStatus: (status: StreamingStatus) => void
  setStreamingError: (error: string) => void
  clearStreamingError: () => void
  
  // State access
  getRoomMetadata: () => RoomMetadataType | null
  getStreamingStatus: () => StreamingStatus
  hasMetadata: () => boolean
  
  // Reset
  reset: () => void
}

/**
 * Room Metadata Adapter Context Tag
 * 
 * Services import and use this tag for dependency injection.
 * Uses the same name as the interface for clean imports.
 */
export class RoomMetadataAdapter extends Context.Tag("@app/adapters/RoomMetadataAdapter")<
  RoomMetadataAdapter,
  RoomMetadataAdapter
>() {}

/**
 * Room Metadata Adapter Implementation
 * 
 * Creates a RoomMetadataAdapter implementation using the RoomMetadataStore.
 * This is used by the Layer, never imported directly by services.
 */
const createRoomMetadataAdapterImpl = (
  store?: RoomMetadataStore
): RoomMetadataAdapter => {
  const roomMetadataStore = store || getRoomMetadataStore()

  return {
    // Metadata management
    setRoomMetadata: (metadata: RoomMetadataType) => {
      roomMetadataStore.actions.setRoomMetadata(metadata)
    },

    updateRoomMetadata: (updates: Partial<RoomMetadataType>) => {
      // Implementation would merge updates with existing metadata
      console.log('Room metadata updated:', updates)
    },

    clearMetadata: () => {
      roomMetadataStore.actions.clearRoomMetadata()
    },

    // Streaming status
    setStreamingStatus: (status: StreamingStatus) => {
      // Implementation would set streaming status in store
      console.log('Streaming status set:', status)
    },

    setStreamingError: (error: string) => {
      // Implementation would set streaming error in store
      console.log('Streaming error set:', error)
    },

    clearStreamingError: () => {
      // Implementation would clear streaming error from store
      console.log('Streaming error cleared')
    },

    // State access
    getRoomMetadata: () => {
      // Implementation would get metadata from store
      return null // Placeholder
    },

    getStreamingStatus: () => {
      // Implementation would get streaming status from store
      return 'idle' // Placeholder
    },

    hasMetadata: () => {
      return roomMetadataStore.hasRoomMetadata()
    },

    // Reset
    reset: () => {
      // Implementation would reset all room metadata state
      console.log('Room metadata reset')
    }
  }
}

/**
 * Room Metadata Adapter Layer
 * 
 * Live implementation layer that provides the RoomMetadataAdapter using SolidJS stores.
 * Use this in your app's main Layer composition.
 */
export const RoomMetadataAdapterLive = Layer.succeed(
  RoomMetadataAdapter,
  createRoomMetadataAdapterImpl()
)