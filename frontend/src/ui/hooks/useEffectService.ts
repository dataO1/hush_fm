/**
 * Effect Service Hooks for SolidJS Components
 * 
 * Provides proper 2025 Effect-TS integration with SolidJS components.
 * Components use these hooks to access services through Context.Tag pattern.
 */

import { Effect } from 'effect'
import { runtime } from '../../index'
import { UserService } from '../../services/application/UserService'
import { LobbyService } from '../../services/application/LobbyService'

/**
 * Hook to use UserService for DJ operations in SolidJS components
 * 
 * Returns a promise-based interface for DJ operations.
 * All methods return Effect programs that are automatically run.
 */
export const useDJService = () => {
  return {
    /**
     * Publish DJ stream to room
     */
    publishToRoom: (roomId: string, djWebSocketUrl: string, selectedDeviceId: string) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const userService = yield* UserService
          return yield* userService.publishDJRoom(roomId, djWebSocketUrl, selectedDeviceId)
        })
      ),

    /**
     * Stop DJ streaming and cleanup
     */
    stopStreaming: (_djId: string) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const userService = yield* UserService
          return yield* userService.closeDJRoom()
        })
      ),

    /**
     * Preview audio device
     */
    previewAudioDevice: (deviceId: string) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const userService = yield* UserService
          return yield* userService.previewAudioDevice(deviceId)
        })
      ),

    /**
     * Stop device preview
     */
    stopPreview: (_djId: string) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const userService = yield* UserService
          return yield* userService.stopDevicePreview()
        })
      ),

    /**
     * Control streaming (pause/resume)
     */
    controlStreaming: (djId: string, action: 'pause' | 'resume') =>
      runtime.runPromise(
        Effect.gen(function* () {
          const userService = yield* UserService
          const pause = action === 'pause'
          return yield* userService.toggleDJStream(pause)
        })
      ),

  }
}

/**
 * Hook to use UserService for Listener operations in SolidJS components
 */
export const useListenerService = () => {
  return {
    /**
     * Join room as listener
     */
    joinRoom: (roomId: string, sessionId: string, listenerWebSocketUrl: string) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const userService = yield* UserService
          return yield* userService.joinRoomAsListener(roomId, sessionId, listenerWebSocketUrl)
        })
      ),

    /**
     * Leave room as listener
     */
    leaveRoom: (listenerId: string) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const userService = yield* UserService
          return yield* userService.leaveListenerRoom(listenerId)
        })
      ),

    /**
     * Control audio playback - removed, now handled by AudioClient
     */
    controlAudio: (_listenerId: string, _action: 'play' | 'pause' | 'setVolume', _value?: number) =>
      Promise.resolve(),

    /**
     * Handle manual play for autoplay-blocked audio - removed, now handled by AudioClient
     */
    handleManualPlay: (_listenerId: string) =>
      Promise.resolve(),

    /**
     * Check existing resources - removed
     */
    checkExistingResources: (_roomId: string, _sessionId: string) =>
      Promise.resolve(null),


    /**
     * Join room with navigation
     */
    joinRoomWithNavigation: (joinData: { roomId: string; sessionId: string; listenerWebSocketUrl: string }) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const userService = yield* UserService
          return yield* userService.joinRoomAsListener(joinData.roomId, joinData.sessionId, joinData.listenerWebSocketUrl)
        })
      ),

    /**
     * Leave room and navigate
     */
    leaveRoomAndNavigate: (listenerId: string) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const userService = yield* UserService
          return yield* userService.leaveListenerRoom(listenerId)
        })
      )
  }
}

/**
 * Hook to use LobbyService in SolidJS components
 */
export const useLobbyService = () => {
  return {
    /**
     * Discover available rooms
     */
    discoverRooms: (lobbyWebSocketUrl: string) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const lobbyService = yield* LobbyService
          return yield* lobbyService.discoverRooms(lobbyWebSocketUrl)
        })
      ),

    /**
     * Create new DJ room
     */
    createDJRoom: (roomName: string, djName: string, isPublic: boolean, tags: string[]) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const lobbyService = yield* LobbyService
          return yield* lobbyService.createDJRoom(roomName, djName, isPublic, tags)
        })
      ),

    /**
     * Join room as listener
     */
    joinRoomAsListener: (roomId: string, roomName: string) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const lobbyService = yield* LobbyService
          return yield* lobbyService.joinRoomAsListener(roomId, roomName)
        })
      ),

    /**
     * Initialize lobby
     */
    initializeLobby: (lobbyWebSocketUrl: string) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const lobbyService = yield* LobbyService
          return yield* lobbyService.connectToLobby()
        })
      ),

    /**
     * Initialize lobby with clean setup
     */
    initialize: () =>
      runtime.runPromise(
        Effect.gen(function* () {
          const lobbyService = yield* LobbyService
          return yield* lobbyService.connectToLobby()
        })
      ),

    /**
     * Initialize lobby with active connection check
     */
    initializeWithActiveConnectionCheck: () =>
      runtime.runPromise(
        Effect.gen(function* () {
          const lobbyService = yield* LobbyService
          return yield* lobbyService.connectToLobby()
        })
      ),

    /**
     * Announce room creation (wrapper for announceRoom)
     */
    announceRoomCreation: (roomData: { roomName: string; djName: string; description?: string; tags?: string[] }) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const lobbyService = yield* LobbyService
          return yield* lobbyService.announceRoom(roomData.roomName, roomData.djName, roomData.description, roomData.tags)
        })
      ),

    /**
     * Request to join room 
     */
    requestJoinRoom: (roomId: string, sessionId: string) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const lobbyService = yield* LobbyService
          return yield* lobbyService.requestJoinRoom(roomId, sessionId)
        })
      ),

    /**
     * Sort rooms for user
     */
    sortRoomsForUser: (rooms: any[], sessionId: string, activeListenerRoomId?: string) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const lobbyService = yield* LobbyService
          return yield* lobbyService.sortRoomsForUser(rooms, sessionId, activeListenerRoomId)
        })
      )
  }
}