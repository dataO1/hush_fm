/**
 * Lobby Flows Service
 * 
 * Stateless service containing lobby-related flows:
 * - Room discovery and listing
 * - Room announcements and creation
 * - Lobby WebSocket management
 * 
 * This service orchestrates lobby operations without maintaining state.
 * State is managed in lobby stores.
 */

import { Effect, pipe, Option } from 'effect'
import { 
  connectToLobby,
  connectToListenerRoom,
  sendLobbyCommand, 
  subscribeToLobbyEvents,
  closeWebSocket
} from '../websocket/websocket.service'
import { listRooms } from '../api'
import type { RoomInfo } from '../generated/hushFMAPI.schemas'
import type { LobbyCommand, LobbyEvent, DjEvent } from '../websocket/schemas/websocket'
import {
  LobbyConnectionError,
  RoomDiscoveryError,
  RoomCreationError,
  ErrorFactories
} from '../../domain/errors'
import type { RoomStore } from '../../stores/room.store'
import type { RoomMetadata } from '../../domain/schemas/room.schema'

/**
 * Room creation request
 */
export interface CreateRoomRequest {
  name: string
  djName: string
  description?: string
  tags?: string[]
}

/**
 * Connect to lobby WebSocket (using the new role-specific function)
 */
export const connectToLobbyWebSocket = (): Effect.Effect<WebSocket, LobbyConnectionError> => 
  pipe(
    connectToLobby(),
    Effect.mapError(error => 
      ErrorFactories.lobbyConnectionError(
        'Failed to connect to lobby WebSocket',
        'connect_to_lobby',
        { url: `wss://${window.location.hostname}:3443/ws/lobby`, originalError: error }
      )
    ),
    Effect.tap(() => Effect.logInfo('Connected to lobby WebSocket'))
  )

/**
 * Discover available rooms via HTTP API
 */
export const discoverRooms = (): Effect.Effect<RoomInfo[], RoomDiscoveryError> =>
  pipe(
    listRooms(),
    Effect.mapError(error => 
      new RoomDiscoveryError({
        cause: error.message || 'Failed to fetch rooms',
        context: {
          timestamp: new Date(),
          operation: 'discover_rooms',
          details: { error }
        }
      })
    ),
    Effect.tap(rooms => Effect.logInfo(`Discovered ${rooms.length} rooms`))
  )

/**
 * Subscribe to lobby events (room added/updated/removed)
 */
export const subscribeLobbyEvents = (
  lobbyWs: WebSocket
): Effect.Effect<(handler: (event: LobbyEvent) => void) => void, never> =>
  pipe(
    subscribeToLobbyEvents(lobbyWs),
    Effect.tap(() => Effect.logInfo('Subscribed to lobby events'))
  )

/**
 * Announce room creation in lobby (Step 1 of DJ flow)
 * 
 * This creates a room in "unfinished" state and returns a DJ WebSocket URL
 */
export const announceRoomCreation = (
  lobbyWs: WebSocket,
  request: CreateRoomRequest,
  roomStore: RoomStore
): Effect.Effect<{ roomId: string, djWebSocketUrl: string }, RoomCreationError> =>
  pipe(
    Effect.gen(function* (_) {
      // Send announce room command (no trace context)
      const command: LobbyCommand = {
        type: 'announceRoom',
        name: request.name,
        djName: request.djName,
        description: request.description,
        tags: request.tags || []
      }
      
      yield* _(sendLobbyCommand(lobbyWs, command))
      
      // Wait for room announced response (this requires a different approach now)
      // We need to listen for DjEvent 'roomAnnounced' since that's where it comes from
      const response = yield* _(
        Effect.async<DjEvent & { type: 'roomAnnounced' }, RoomCreationError>((resume) => {
          const handler = (event: MessageEvent) => {
            try {
              const data = JSON.parse(event.data)
              if (data.type === 'roomAnnounced') {
                lobbyWs.removeEventListener('message', handler)
                resume(Effect.succeed(data))
              }
            } catch (error) {
              lobbyWs.removeEventListener('message', handler)
              resume(Effect.fail(new RoomCreationError({
                cause: 'Failed to parse room announced response',
                roomName: request.name,
                context: { timestamp: new Date(), operation: 'announce_room_creation' }
              })))
            }
          }
          
          lobbyWs.addEventListener('message', handler)
          
          // Timeout after 15 seconds
          setTimeout(() => {
            lobbyWs.removeEventListener('message', handler)
            resume(Effect.fail(new RoomCreationError({
              cause: 'Room announcement timeout',
              roomName: request.name,
              context: { timestamp: new Date(), operation: 'announce_room_creation' }
            })))
          }, 15000)
          
          return Effect.sync(() => {
            lobbyWs.removeEventListener('message', handler)
          })
        })
      )
      
      // Set room metadata in store from the request and response
      const metadata: RoomMetadata = {
        id: response.room.id,
        name: request.name,
        description: request.description ? Option.some(request.description) : Option.none(),
        djName: request.djName,
        isPublic: true,
        createdAt: new Date(),
        tags: request.tags || []
      }
      roomStore.actions.setRoomMetadata(metadata)
      
      return {
        roomId: response.room.id,
        djWebSocketUrl: response.wsUrl
      }
    }),
    Effect.mapError(error => 
      error instanceof RoomCreationError ? error : new RoomCreationError({
        cause: error.message || 'Failed to announce room creation',
        roomName: request.name,
        context: {
          timestamp: new Date(),
          operation: 'announce_room_creation',
          details: { request, error }
        }
      })
    ),
    Effect.tap(result => 
      Effect.logInfo(`Room announced successfully: ${result.roomId}`)
    )
  )

/**
 * Request to join an existing room (Step 1 of Listener flow)
 * 
 * This creates a listener WebSocket connection for the specified room
 */
export const requestJoinRoom = (
  roomId: string
): Effect.Effect<WebSocket, LobbyConnectionError> => 
  pipe(
    connectToListenerRoom(roomId),
    Effect.mapError(error => 
      new LobbyConnectionError({
        cause: 'Failed to connect to room listener WebSocket',
        context: {
          timestamp: new Date(),
          operation: 'request_join_room',
          details: { roomId, error }
        }
      })
    ),
    Effect.tap(() => 
      Effect.logInfo(`Connected to room listener WebSocket: ${roomId}`)
    )
  )

/**
 * Leave lobby (close lobby WebSocket)
 */
export const leaveLobby = (
  lobbyWs: WebSocket
): Effect.Effect<void, never> =>
  pipe(
    closeWebSocket(lobbyWs),
    Effect.tap(() => Effect.logInfo('Left lobby'))
  )

/**
 * Get lobby WebSocket connection status
 */
export const getLobbyConnectionStatus = (
  lobbyWs: WebSocket
): Effect.Effect<'connecting' | 'open' | 'closing' | 'closed', never> =>
  Effect.sync(() => {
    switch (lobbyWs.readyState) {
      case WebSocket.CONNECTING:
        return 'connecting'
      case WebSocket.OPEN:
        return 'open'
      case WebSocket.CLOSING:
        return 'closing'
      case WebSocket.CLOSED:
        return 'closed'
      default:
        return 'closed'
    }
  })

/**
 * Refresh room listings (combination of HTTP + WebSocket updates)
 */
export const refreshRoomListings = (
  lobbyWs?: WebSocket
): Effect.Effect<RoomInfo[], RoomDiscoveryError> =>
  pipe(
    // Always fetch via HTTP for immediate results
    discoverRooms(),
    Effect.tap(_rooms => {
      // If we have a lobby WebSocket, real-time updates will come via events
      if (lobbyWs && lobbyWs.readyState === WebSocket.OPEN) {
        return Effect.logInfo('Room listings refreshed, listening for real-time updates')
      } else {
        return Effect.logInfo('Room listings refreshed via HTTP only')
      }
    })
  )