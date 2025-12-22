/**
 * Effect Service Hooks for SolidJS Components
 * 
 * Provides proper 2025 Effect-TS integration with SolidJS components.
 * Components use these hooks to access services through Context.Tag pattern.
 */

import { Effect } from 'effect'
import { runtime } from '../../index'
import { DJService } from '../../services/application/DJService'
import { ListenerService } from '../../services/application/ListenerService' 
import { LobbyService } from '../../services/application/LobbyService'

/**
 * Hook to use DJService in SolidJS components
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
          const djService = yield* DJService
          return yield* djService.publishDJRoom(roomId, djWebSocketUrl, selectedDeviceId)
        })
      ),

    /**
     * Stop DJ streaming and cleanup
     */
    stopStreaming: (_djId: string) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const djService = yield* DJService
          return yield* djService.closeDJRoom()
        })
      ),

    /**
     * Preview audio device
     */
    previewAudioDevice: (deviceId: string) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const djService = yield* DJService
          return yield* djService.previewAudioDevice(deviceId)
        })
      ),

    /**
     * Stop device preview
     */
    stopPreview: (_djId: string) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const djService = yield* DJService
          return yield* djService.stopDevicePreview()
        })
      ),

    /**
     * Control streaming (pause/resume)
     */
    controlStreaming: (djId: string, action: 'pause' | 'resume') =>
      runtime.runPromise(
        Effect.gen(function* () {
          const djService = yield* DJService
          const pause = action === 'pause'
          return yield* djService.toggleDJStream(pause)
        })
      ),

  }
}

/**
 * Hook to use ListenerService in SolidJS components
 */
export const useListenerService = () => {
  return {
    /**
     * Join room as listener
     */
    joinRoom: (roomId: string, sessionId: string, listenerWebSocketUrl: string) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const listenerService = yield* ListenerService
          return yield* listenerService.joinRoom(roomId, sessionId, listenerWebSocketUrl)
        })
      ),

    /**
     * Leave room as listener
     */
    leaveRoom: (listenerId: string) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const listenerService = yield* ListenerService
          return yield* listenerService.leaveRoom(listenerId)
        })
      ),

    /**
     * Control audio playback
     */
    controlAudio: (listenerId: string, action: 'play' | 'pause' | 'setVolume', value?: number) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const listenerService = yield* ListenerService
          return yield* listenerService.controlAudio(listenerId, action, value)
        })
      ),

    /**
     * Handle manual play for autoplay-blocked audio
     */
    handleManualPlay: (listenerId: string) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const listenerService = yield* ListenerService
          return yield* listenerService.handleManualPlay(listenerId)
        })
      ),

    /**
     * Check existing resources
     */
    checkExistingResources: (roomId: string, sessionId: string) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const listenerService = yield* ListenerService
          return yield* listenerService.checkExistingResources(roomId, sessionId)
        })
      ),


    /**
     * Join room with navigation
     */
    joinRoomWithNavigation: (joinData: { roomId: string; sessionId: string; listenerWebSocketUrl: string }) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const listenerService = yield* ListenerService
          return yield* listenerService.joinRoom(joinData.roomId, joinData.sessionId, joinData.listenerWebSocketUrl)
        })
      ),

    /**
     * Leave room and navigate
     */
    leaveRoomAndNavigate: (listenerId: string) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const listenerService = yield* ListenerService
          return yield* listenerService.leaveRoom(listenerId)
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