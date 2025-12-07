/**
 * @deprecated This file previously contained a class-based SignalingManager with module-level state.
 * 
 * All functionality has been migrated to SignalingProvider for proper reactive context.
 * Use SignalingProvider hooks instead.
 * 
 * Use:
 * import { useSignaling } from '../providers/SignalingProvider'
 * 
 * Types and utilities are re-exported for compatibility.
 */

import { Effect } from 'effect'

/**
 * Re-export types from new provider-based architecture
 */
export type {
  SignalingMessage,
  SignalingEventHandlers,
  SignalingContextType,
  SignalingStore,
  WSConnectionState,
  DJMessage,
  ServerMessage,
  BroadcastMessage
} from '../providers/SignalingProvider'

/**
 * Re-export hooks from new provider
 */
export { 
  useSignaling,
  useLobbyConnection,
  useRoomConnection,
  useRooms,
  useCurrentRoom
} from '../providers/SignalingProvider'

/**
 * Utility function to create WebSocket URL from backend config
 */
export const createWebSocketUrl = (baseUrl?: string, roomId?: string): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = baseUrl || window.location.host
  const path = roomId ? `/ws/dj/${roomId}` : '/ws/lobby'
  
  return `${protocol}//${host}${path}`
}

/**
 * Effect to initialize signaling for a DJ room
 * @deprecated Use SignalingProvider hooks instead
 */
export const initializeDJSignaling = (_roomId: string, _djToken: string): Effect.Effect<void, Error> =>
  Effect.fail(new Error('initializeDJSignaling is deprecated. Use SignalingProvider hooks instead.'))

/**
 * Effect to initialize signaling for lobby/listener
 * @deprecated Use SignalingProvider hooks instead
 */
export const initializeLobbySignaling = (): Effect.Effect<void, Error> =>
  Effect.fail(new Error('initializeLobbySignaling is deprecated. Use SignalingProvider hooks instead.'))

/**
 * @deprecated Global signaling manager instance is no longer available.
 * Use SignalingProvider context instead.
 */
export const signalingManager = {
  connect: () => { throw new Error('signalingManager is deprecated. Use SignalingProvider context instead.') },
  disconnect: () => { throw new Error('signalingManager is deprecated. Use SignalingProvider context instead.') },
  sendToRoom: () => { throw new Error('signalingManager is deprecated. Use SignalingProvider context instead.') },
  sendToLobby: () => { throw new Error('signalingManager is deprecated. Use SignalingProvider context instead.') },
  subscribeToRoom: () => { throw new Error('signalingManager is deprecated. Use SignalingProvider context instead.') },
  unsubscribeFromRoom: () => { throw new Error('signalingManager is deprecated. Use SignalingProvider context instead.') },
  setEventHandlers: () => { throw new Error('signalingManager is deprecated. Use SignalingProvider context instead.') },
  getConnectionState: () => { throw new Error('signalingManager is deprecated. Use SignalingProvider context instead.') },
  getConnectedRooms: () => { throw new Error('signalingManager is deprecated. Use SignalingProvider context instead.') }
}