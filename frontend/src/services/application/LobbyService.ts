/**
 * Lobby Application Service
 *
 * Effect-TS service for lobby operations and room discovery.
 * Uses Context.Tag pattern for all dependencies - no direct imports.
 * Follows Schema-First architecture to avoid circular dependencies.
 *
 * Responsibilities:
 * - Room discovery and listing
 * - Room announcement (DJ room creation)
 * - Join request handling
 * - Lobby WebSocket management
 */

import { Effect, Context, Layer, Option as O, Schema as S } from 'effect'
import type { LobbyRoomInfoType } from '../../domain/schemas/lobby.schema'
import { LobbyRoomInfo } from '../../domain/schemas/lobby.schema'
import { config } from '../../config'

// Import only adapters via Context.Tag
import { LobbyAdapter } from '../../stores'

// Import only infrastructure via Context.Tag
import { WebSocketClientService } from '../infrastructure/WebSocketClient'
import { listRooms } from '../generated/rooms/rooms'

/**
 * Room announcement result
 */
export interface RoomAnnouncementResult {
  roomId: string
  djWebSocketUrl: string
  announcedAt: Date
}

/**
 * Room join result
 */
export interface RoomJoinResult {
  roomId: string
  sessionId: string
  listenerWebSocketUrl: string
  joinedAt: Date
}

/**
 * Lobby Service Interface
 *
 * Pure business logic interface - no store dependencies.
 */

/**
 * Lobby Service Context Tag
 *
 * Uses modern 2025 Effect-TS class-based Tag syntax.
 * Acts as both type and value for clean dependency injection.
 */
export class LobbyService extends Context.Tag("@app/services/LobbyService")<
  LobbyService,
  {
    readonly connectToLobby: () => Effect.Effect<void, LobbyServiceError, WebSocketClientService>
    readonly disconnectFromLobby: () => Effect.Effect<void, LobbyServiceError, WebSocketClientService>
    readonly getRoomList: () => Effect.Effect<LobbyRoomInfoType[], LobbyServiceError, never>
    readonly announceRoom: (roomName: string, djName: string, sessionId: string, description?: string, tags?: string[]) => Effect.Effect<RoomAnnouncementResult, LobbyServiceError, LobbyAdapter | WebSocketClientService>
    readonly requestJoinRoom: (roomId: string, sessionId: string) => Effect.Effect<RoomJoinResult, LobbyServiceError, WebSocketClientService>
    readonly refreshRoomList: () => Effect.Effect<void, LobbyServiceError, WebSocketClientService>
    readonly sortRoomsForUser: (rooms: any[], sessionId: string, activeListenerRoomId?: string) => Effect.Effect<any[], LobbyServiceError, never>
  }
>() {}

/**
 * Lobby Service Errors
 */
export class LobbyServiceError extends Error {
  constructor(
    message: string,
    public operation: string,
    public cause?: unknown
  ) {
    super(message)
    this.name = 'LobbyServiceError'
  }
}

/**
 * Lobby Service Implementation
 *
 * Uses Effect.gen for all operations and Context.Tag for all dependencies.
 * No direct imports - everything comes through the context.
 */
const LobbyServiceImpl = {
  /**
   * Connect to lobby and start room discovery
   */
  connectToLobby: () =>
    Effect.gen(function* () {
      console.info('🏠 Lobby Service: Connecting to lobby')

      const wsClient = yield* WebSocketClientService

      // Connect to lobby WebSocket - wsClient handles all connection state management
      const lobbyUrl = `${config.websocket.baseUrl}/lobby`
      yield* wsClient.connectLobby(lobbyUrl).pipe(
        Effect.mapError((error) => new LobbyServiceError(
          `Failed to connect to lobby: ${error}`,
          'connectToLobby',
          error
        ))
      )

      console.info('✅ Lobby Service: Connected to lobby')
    }),

  /**
   * Disconnect from lobby
   */
  disconnectFromLobby: () =>
    Effect.gen(function* () {
      console.info('🏠 Lobby Service: Disconnecting from lobby')

      const wsClient = yield* WebSocketClientService

      // Disconnect from lobby - wsClient handles all connection state management
      yield* wsClient.disconnectLobby().pipe(
        Effect.mapError((error) => new LobbyServiceError(
          `Failed to disconnect from lobby: ${error}`,
          'disconnectFromLobby',
          error
        ))
      )

      console.info('✅ Lobby Service: Disconnected from lobby')
    }),

  /**
   * Get current room list
   */
  getRoomList: () =>
    Effect.gen(function* () {
      // Fetch rooms from API
      const response = yield* Effect.tryPromise({
        try: async () => await listRooms(),
        catch: (error) => new LobbyServiceError(
          `Failed to fetch rooms: ${error}`,
          'getRoomList',
          error
        )
      })

      // Parse and transform room list from wire format to domain format
      const rooms = yield* S.decodeUnknown(S.Array(LobbyRoomInfo))(response.data).pipe(
        Effect.mapError((error) => new LobbyServiceError(
          `Failed to parse room data: ${error}`,
          'getRoomList',
          error
        ))
      )
      
      return rooms
    }),

  /**
   * Announce a new room (for DJs)
   */
  announceRoom: (roomName: string, djName: string, sessionId: string, description?: string, tags: string[] = []) =>
    Effect.gen(function* () {
      console.info(`🎵 Lobby Service: Announcing room: ${roomName}`)

      const lobbyAdapter = yield* LobbyAdapter
      const wsClient = yield* WebSocketClientService

      // Validate inputs
      if (!roomName.trim()) {
        return yield* Effect.fail(new LobbyServiceError(
          'Room name cannot be empty',
          'announceRoom'
        ))
      }

      if (!djName.trim()) {
        return yield* Effect.fail(new LobbyServiceError(
          'DJ name cannot be empty',
          'announceRoom'
        ))
      }

      if (!sessionId.trim()) {
        return yield* Effect.fail(new LobbyServiceError(
          'Session ID cannot be empty',
          'announceRoom'
        ))
      }

      // Send announce room command via lobby WebSocket (without type field)
      yield* wsClient.sendLobbyCommand({
        name: roomName,
        djName,
        sessionId,
        description: description ? O.some(description) : O.none(),
        tags: tags || []
      }).pipe(
        Effect.mapError((error) => new LobbyServiceError(
          `Failed to send announce room command: ${error.cause}`,
          'announceRoom',
          error
        ))
      )

      // Wait for room announced event
      const result = yield* wsClient.waitForLobbyEvent('roomAnnounced').pipe(
        Effect.mapError((error) => new LobbyServiceError(
          `Failed to receive room announced event: ${error.cause}`,
          'announceRoom',
          error
        ))
      )

      // Store room info in lobby adapter
      lobbyAdapter.addRoom({
        id: result.room.id,
        name: roomName,
        djName,
        djId: sessionId,
        description: description ? O.some(description) : O.none(),
        tags: tags || [],
        listenerCount: 0,
        isStreaming: false,
        createdAt: new Date(),
        isPublic: true
      })

      const announcementResult: RoomAnnouncementResult = {
        roomId: result.room.id,
        djWebSocketUrl: result.wsUrl,
        announcedAt: new Date()
      }

      console.info('✅ Lobby Service: Room announced successfully')
      return announcementResult
    }),

  /**
   * Request to join a room (for listeners)
   */
  requestJoinRoom: (roomId: string, sessionId: string) =>
    Effect.gen(function* () {
      console.info(`🎧 Lobby Service: Requesting to join room: ${roomId}`)

      const wsClient = yield* WebSocketClientService

      // Validate inputs
      if (!roomId.trim()) {
        return yield* Effect.fail(new LobbyServiceError(
          'Room ID cannot be empty',
          'requestJoinRoom'
        ))
      }

      if (!sessionId.trim()) {
        return yield* Effect.fail(new LobbyServiceError(
          'Session ID cannot be empty',
          'requestJoinRoom'
        ))
      }

      // Send request join command via lobby WebSocket (without type field)
      yield* wsClient.sendLobbyCommand({
        roomId,
        sessionId
      }).pipe(
        Effect.mapError((error) => new LobbyServiceError(
          `Failed to send join room command: ${error.cause}`,
          'requestJoinRoom',
          error
        ))
      )

      // Wait for join approved event
      const result = yield* wsClient.waitForLobbyEvent('joinApproved').pipe(
        Effect.mapError((error) => new LobbyServiceError(
          `Failed to receive join approved event: ${error.cause}`,
          'requestJoinRoom',
          error
        ))
      )

      const joinResult: RoomJoinResult = {
        roomId,
        sessionId: result.sessionId, // Use sessionId from result
        listenerWebSocketUrl: O.getOrElse(() => '')(result.listenerWebSocketUrl),
        joinedAt: new Date()
      }

      console.info('✅ Lobby Service: Join request approved')
      return joinResult
    }),

  /**
   * Refresh room list
   */
  refreshRoomList: () =>
    Effect.gen(function* () {
      console.info('🔄 Lobby Service: Refreshing room list')

      const wsClient = yield* WebSocketClientService

      // Send refresh rooms command (empty object for RefreshRoomsCommand)
      yield* wsClient.sendLobbyCommand({}).pipe(
        Effect.mapError((error) => new LobbyServiceError(
          `Failed to send refresh rooms command: ${error.cause}`,
          'refreshRoomList',
          error
        ))
      )

      // Note: Room list updates will come as events automatically

      console.info('✅ Lobby Service: Room list refreshed')
    }),

  /**
   * Sort rooms for user with personalized logic
   */
  sortRoomsForUser: (rooms: any[], _sessionId: string, activeListenerRoomId?: string) =>
    Effect.gen(function* () {
      console.info('🔄 Lobby Service: Sorting rooms for user')

      // Simple sorting logic - put user's rooms first, then by listener count
      const sortedRooms = rooms.slice().sort((a, b) => {
        // Put active listener room first
        if (activeListenerRoomId) {
          if (a.roomId === activeListenerRoomId) return -1
          if (b.roomId === activeListenerRoomId) return 1
        }

        // Then sort by listener count (descending)
        return (b.listenerCount || 0) - (a.listenerCount || 0)
      })

      console.info('✅ Lobby Service: Rooms sorted successfully')
      return sortedRooms
    }).pipe(
      Effect.catchAll((error) =>
        Effect.fail(new LobbyServiceError(
          `Failed to sort rooms: ${error}`,
          'sortRoomsForUser'
        ))
      )
    )
}


/**
 * Lobby Service Live Layer
 *
 * Provides the LobbyService implementation through Effect Layer system.
 */
export const LobbyServiceLive = Layer.succeed(
  LobbyService,
  LobbyService.of(LobbyServiceImpl)
)
