/**
 * @deprecated This file previously contained module-level reactive state.
 * 
 * Event handling has been moved to SignalingProvider for proper reactive context.
 * Use SignalingProvider hooks instead.
 * 
 * Use:
 * import { useSignaling } from '../providers/AppProviders'
 * 
 * Types are re-exported from SignalingProvider for compatibility.
 */

import type { ServerMessage, BroadcastMessage, DJMessage } from './client'

/**
 * Room state for reactive updates
 */
export type RoomState = {
  id: string
  name: string
  created_at: string
  listener_count: number
  is_live: boolean
}

/**
 * Re-export message types
 */
export type { ServerMessage, BroadcastMessage, DJMessage }

/**
 * Re-export hooks from new provider-based architecture
 */
export { 
  useSignaling,
  useLobbyConnection,
  useRoomConnection,
  useRooms,
  useCurrentRoom
} from '../providers/SignalingProvider'

/**
 * Re-export types from new provider
 */
export type {
  SignalingContextType,
  SignalingStore,
  WSConnectionState
} from '../providers/SignalingProvider'