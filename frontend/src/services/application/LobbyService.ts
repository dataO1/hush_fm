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

import { Effect, Context, Layer, pipe, Schema as S, Option as O } from 'effect'
import type { LobbyRoomInfoType } from '../../domain/schemas/lobby.schema'
import { LobbyRoomInfo } from '../../domain/schemas/lobby.schema'
import { config } from '../../config'

// Import lobby command schemas for .make() construction and event types
import { 
  AnnounceRoomCommandSchema, 
  RequestJoinCommandSchema, 
  RefreshRoomsCommandSchema,
  withSchemaLogging,
  // Event types  
  type RoomAnnouncedEvent,
  type RoomAddedEvent,
  type JoinRoomResponseEvent
} from '../../domain/schemas/shared/websocket.schema'

// Import only adapters via Context.Tag
import { LobbyAdapter } from '../../stores'

// Import only infrastructure via Context.Tag
import { LobbyWebSocket, createWebSocketClientService } from '../infrastructure/WebSocketClient'
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
    readonly connectToLobby: () => Effect.Effect<void, LobbyServiceError, never>
    readonly disconnectFromLobby: () => Effect.Effect<void, LobbyServiceError, never>
    readonly getRoomList: () => Effect.Effect<ReadonlyArray<LobbyRoomInfoType>, LobbyServiceError, never>
    readonly announceRoom: (roomName: string, djName: string, sessionId: string, description?: string, tags?: string[]) => Effect.Effect<RoomAnnouncementResult, LobbyServiceError, never>
    readonly requestJoinRoom: (roomId: string, sessionId: string) => Effect.Effect<RoomJoinResult, LobbyServiceError, never>
    readonly refreshRoomList: () => Effect.Effect<void, LobbyServiceError, never>
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
const createLobbyServiceImpl = () => {
  return {
    /**
     * Connect to lobby and start room discovery
     */
    connectToLobby: () =>
      Effect.gen(function* () {
        console.info('🏠 Lobby Service: Connecting to lobby')

        const wsClient = yield* LobbyWebSocket
        const lobbyAdapter = yield* LobbyAdapter

      // Connect to lobby WebSocket - wsClient handles all connection state management
      const lobbyUrl = `${config.websocket.baseUrl}/ws/lobby`
      yield* wsClient.connect(lobbyUrl).pipe(
        Effect.mapError((error) => new LobbyServiceError(
          `Failed to connect to lobby: ${error}`,
          'connectToLobby',
          error
        ))
      )

      // Subscribe to roomAdded events (callback receives decoded domain type)
      yield* wsClient.subscribe('roomAdded', (event: RoomAddedEvent) => {
        console.info('🎵 Lobby Service: Room added event received:', event.room)
        
        // Transform domain event to LobbyRoomInfo format
        const lobbyRoom: LobbyRoomInfoType = {
          ...event.room,
          createdAt: new Date(event.room.createdAt),
          isPublic: true, // Rooms in roomAdded events are always public
        }
        
        lobbyAdapter.addRoom(lobbyRoom)
      }).pipe(
        Effect.mapError((error) => new LobbyServiceError(
          `Failed to subscribe to room events: ${error}`,
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

      const wsClient = yield* LobbyWebSocket

      // Disconnect from lobby - wsClient handles all connection state management
      yield* wsClient.disconnect().pipe(
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
      const lobbyAdapter = yield* LobbyAdapter
      
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
      
      // Update lobby adapter with fetched rooms
      yield* Effect.sync(() => {
        console.info(`🏠 Lobby Service: Updating adapter with ${rooms.length} rooms`)
        lobbyAdapter.setRooms([...rooms]) // Convert readonly array to mutable
      })
      
      return rooms
    }),

  /**
   * Announce a new room (for DJs)
   */
  announceRoom: (roomName: string, djName: string, sessionId: string, description?: string, tags: string[] = []) =>
    Effect.gen(function* () {
      console.info(`🎵 Lobby Service: Announcing room: ${roomName}`)

      const lobbyAdapter = yield* LobbyAdapter
      const wsClient = yield* LobbyWebSocket

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

      // Create command using logging wrapper
      const makeAnnounceRoomCommand = withSchemaLogging(AnnounceRoomCommandSchema, 'AnnounceRoomCommand')
      
      const command = yield* pipe(
        makeAnnounceRoomCommand({
          name: roomName,
          djName,
          sessionId,
          description: description ? O.some(description) : O.none(), // Use Option types for .make()
          tags: (tags && tags.length > 0) ? O.some(tags) : O.none(), // Use Option types for .make()
          type: "announceRoom" as const
        }),
        Effect.mapError((error) => new LobbyServiceError(
          `Failed to create announce room command: ${error}`,
          'announceRoom',
          error
        ))
      )

      // Send announce room command and wait for response
      const result = yield* wsClient.sendCommand<RoomAnnouncedEvent>(command).pipe(
        Effect.mapError((error) => new LobbyServiceError(
          `Failed to announce room: ${error.cause}`,
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

      const wsClient = yield* LobbyWebSocket

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

      // Create command using logging wrapper
      const makeRequestJoinCommand = withSchemaLogging(RequestJoinCommandSchema, 'RequestJoinCommand')
      const requestJoinCommand = yield* makeRequestJoinCommand({
        roomId,
        sessionId
      }).pipe(
        Effect.mapError((error) => new LobbyServiceError(
          `Failed to create request join command: ${error}`,
          'requestJoinRoom',
          error
        ))
      )
      
      // Send request join command and wait for response
      const result = yield* wsClient.sendCommand<JoinRoomResponseEvent>(
        requestJoinCommand
      ).pipe(
        Effect.mapError((error) => new LobbyServiceError(
          `Failed to request join room: ${error.cause}`,
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

      const wsClient = yield* LobbyWebSocket

      // Create command using logging wrapper
      const makeRefreshRoomsCommand = withSchemaLogging(RefreshRoomsCommandSchema, 'RefreshRoomsCommand')
      const refreshRoomsCommand = yield* makeRefreshRoomsCommand({}).pipe(
        Effect.mapError((error) => new LobbyServiceError(
          `Failed to create refresh rooms command: ${error}`,
          'refreshRoomList',
          error
        ))
      )
      
      // Send refresh rooms command
      yield* wsClient.sendCommandFireForget(refreshRoomsCommand).pipe(
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
}


/**
 * Lobby Feature Layer
 * 
 * Provides LobbyService with all its dependencies properly injected.
 * Follows UserService pattern for dependency resolution.
 */
export const LobbyFeatureLayer = Layer.scoped(
  LobbyService, 
  Effect.gen(function* () {
    // Resolve dependencies within this layer context
    const lobbyAdapter = yield* LobbyAdapter
    const lobbyWebSocket = yield* LobbyWebSocket
    
    // Get the service implementation
    const serviceImpl = createLobbyServiceImpl()
    
    // Return service implementation with resolved dependencies provided to each method
    return {
      connectToLobby: () =>
        serviceImpl.connectToLobby().pipe(
          Effect.provideService(LobbyWebSocket, lobbyWebSocket),
          Effect.provideService(LobbyAdapter, lobbyAdapter)
        ),
      disconnectFromLobby: () =>
        serviceImpl.disconnectFromLobby().pipe(
          Effect.provideService(LobbyWebSocket, lobbyWebSocket)
        ),
      getRoomList: () =>
        serviceImpl.getRoomList().pipe(
          Effect.provideService(LobbyAdapter, lobbyAdapter)
        ),
      announceRoom: (roomName: string, djName: string, sessionId: string, description?: string, tags?: string[]) =>
        serviceImpl.announceRoom(roomName, djName, sessionId, description, tags).pipe(
          Effect.provideService(LobbyAdapter, lobbyAdapter),
          Effect.provideService(LobbyWebSocket, lobbyWebSocket)
        ),
      requestJoinRoom: (roomId: string, sessionId: string) =>
        serviceImpl.requestJoinRoom(roomId, sessionId).pipe(
          Effect.provideService(LobbyWebSocket, lobbyWebSocket)
        ),
      refreshRoomList: () =>
        serviceImpl.refreshRoomList().pipe(
          Effect.provideService(LobbyWebSocket, lobbyWebSocket)
        ),
      sortRoomsForUser: (rooms: any[], sessionId: string, activeListenerRoomId?: string) =>
        serviceImpl.sortRoomsForUser(rooms, sessionId, activeListenerRoomId)
    } satisfies Context.Tag.Service<LobbyService>
  })
)

/**
 * Complete Lobby Layer with All Dependencies
 * 
 * Combines LobbyService with all its dependencies.
 * Use this in global layer compositions.
 */
export const LobbyServiceLive = LobbyFeatureLayer.pipe(
  Layer.provide(
    Layer.scoped(LobbyWebSocket, createWebSocketClientService)
  )
)
