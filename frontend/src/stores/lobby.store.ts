/**
 * Lobby Store
 * 
 * Reactive store for lobby state management. Bridges between pure domain schemas
 * and the UI by integrating with lobby flow services via Effects.
 * 
 * Extracted from: SignalingProvider.tsx lobby-related functionality
 */

import { createSignal, createEffect, onCleanup } from 'solid-js'
import { createStore } from 'solid-js/store'
import { Effect, Option, Runtime, Layer } from 'effect'
import type { RoomInfo } from '../services/generated/hushFMAPI.schemas'
import {
  type LobbyState,
  type WSConnectionState,
  createInitialLobbyState
} from '../domain/schemas/lobby.schema'
import {
  connectToLobbyWebSocket,
  discoverRooms,
  subscribeLobbyEvents,
  announceRoomCreation,
  leaveLobby,
  refreshRoomListings,
  type CreateRoomRequest
} from '../services/flows/lobby-flows.service'
import type { LobbyEvent } from '../services/websocket/schemas/websocket'
import {
  LobbyConnectionError,
  RoomDiscoveryError,
  RoomCreationError
} from '../domain/errors'

/**
 * Lobby store actions
 */
export interface LobbyStoreActions {
  // Connection actions
  connectToLobby: () => Effect.Effect<void, LobbyConnectionError>
  disconnectFromLobby: () => Effect.Effect<void, never>
  
  // Room discovery actions
  refreshRooms: () => Effect.Effect<void, RoomDiscoveryError>
  
  // Room creation actions
  createRoom: (request: CreateRoomRequest) => Effect.Effect<{ roomId: string, djWebSocketUrl: string }, RoomCreationError>
  
  // State management
  updateConnectionState: (state: WSConnectionState) => void
  addRoom: (room: RoomInfo) => void
  updateRoom: (room: RoomInfo) => void
  removeRoom: (roomId: string) => void
  setError: (error: string) => void
  clearError: () => void
}

/**
 * Create lobby store
 */
export const createLobbyStore = () => {
  // Main reactive state
  const [state, setState] = createStore(createInitialLobbyState() as any)
  
  // Additional UI signals
  const [isConnecting, setIsConnecting] = createSignal(false)
  const [isRefreshing, setIsRefreshing] = createSignal(false)
  const [isCreating, setIsCreating] = createSignal(false)
  
  // Effect runtime for service calls
  let effectRuntime: Option.Option<Runtime.Runtime<never>> = Option.none()
  let lobbyWebSocket: Option.Option<WebSocket> = Option.none()
  // Event subscriber for cleanup (currently unused but maintained for future use)
  // let _eventSubscriber: Option.Option<(handler: (event: LobbyEvent) => void) => void> = Option.none()
  
  // Initialize Effect runtime
  createEffect(() => {
    Effect.runPromise(
      Effect.scoped(Layer.toRuntime(Layer.empty))
    ).then(runtime => {
      effectRuntime = Option.some(runtime)
    }).catch(err => {
      console.error('Failed to initialize lobby store runtime:', err)
    })
  })
  
  // Cleanup on dispose
  onCleanup(() => {
    // WebSocket cleanup will happen when connection is closed
    Option.match(lobbyWebSocket, {
      onSome: (ws) => ws.close(),
      onNone: () => {}
    })
  })
  
  // Actions implementation
  const actions: LobbyStoreActions = {
    /**
     * Connect to lobby WebSocket
     */
    connectToLobby: () => {
      return Effect.gen(function* (_) {
        setIsConnecting(true)
        setState('connection', 'state', 'connecting')
        
        // Connect to lobby
        const ws = yield* _(connectToLobbyWebSocket())
        
        // Store WebSocket reference
        lobbyWebSocket = Option.some(ws)
        setState('connection', {
          websocket: Option.some(ws),
          state: 'connected',
          lastConnectedAt: Option.some(new Date()),
          connectionAttempts: 0,
          lastError: Option.none()
        })
        
        // Subscribe to lobby events
        const subscribe = yield* _(subscribeLobbyEvents(ws))
        // _eventSubscriber = Option.some(subscribe)
        
        // Set up event handling
        subscribe((event: LobbyEvent) => {
          switch (event.type) {
            case 'roomAdded':
              actions.addRoom(event.room)
              break
            case 'roomUpdated':
              actions.updateRoom(event.room)
              break
            case 'roomRemoved':
              actions.removeRoom(event.roomId)
              break
          }
        })
        
        // Initial room discovery
        yield* _(actions.refreshRooms().pipe(
          Effect.mapError((roomError) => 
            new LobbyConnectionError({
              cause: `Failed to discover rooms during lobby connection: ${roomError.message}`,
              context: { timestamp: new Date(), operation: 'connecting', details: { cause: roomError } }
            })
          )
        ))
        
        setIsConnecting(false)
      })
    },

    /**
     * Disconnect from lobby
     */
    disconnectFromLobby: () => {
      return Effect.gen(function* (_) {
        if (Option.isSome(lobbyWebSocket)) {
          yield* _(leaveLobby(lobbyWebSocket.value))
          lobbyWebSocket = Option.none()
        }
        
        // Clear event subscriber reference
        // _eventSubscriber = Option.none()
        
        setState('connection', {
          websocket: Option.none(),
          state: 'disconnected',
          connectionAttempts: 0,
          lastError: Option.none()
        })
      })
    },

    /**
     * Refresh room listings
     */
    refreshRooms: () => {
      return Effect.gen(function* (_) {
        setIsRefreshing(true)
        setState('discovery', 'loading', true)
        
        const rooms = yield* _(
          Option.match(lobbyWebSocket, {
            onSome: (ws) => refreshRoomListings(ws),
            onNone: () => discoverRooms()
          })
        )
        
        setState('discovery', {
          availableRooms: rooms,
          loading: false,
          lastRefreshAt: Option.some(new Date()),
          refreshError: Option.none()
        })
        
        setIsRefreshing(false)
      })
    },

    /**
     * Create new room
     */
    createRoom: (request: CreateRoomRequest) => {
      return Effect.gen(function* (_) {
        const ws = Option.getOrElse(lobbyWebSocket, () => {
          throw new Error('Not connected to lobby')
        })
        
        setIsCreating(true)
        setState('creation', 'creating', true)
        
        const result = yield* _(announceRoomCreation(ws, request))
        
        setState('creation', {
          creating: false,
          creationError: Option.none(),
          lastCreatedRoomId: Option.some(result.roomId)
        })
        
        setIsCreating(false)
        
        return result
      })
    },

    /**
     * Update connection state
     */
    updateConnectionState: (newState: WSConnectionState) => {
      setState('connection', 'state', newState)
      if (newState === 'error') {
        setIsConnecting(false)
      }
    },

    /**
     * Add room to listings
     */
    addRoom: (room: RoomInfo) => {
      setState('discovery', 'availableRooms', (rooms: RoomInfo[]) => [...rooms, room])
    },

    /**
     * Update existing room in listings
     */
    updateRoom: (updatedRoom: RoomInfo) => {
      setState('discovery', 'availableRooms', (rooms: RoomInfo[]) =>
        rooms.map((room: RoomInfo) => room.id === updatedRoom.id ? updatedRoom : room)
      )
    },

    /**
     * Remove room from listings
     */
    removeRoom: (roomId: string) => {
      setState('discovery', 'availableRooms', (rooms: RoomInfo[]) =>
        rooms.filter((room: RoomInfo) => room.id !== roomId)
      )
    },

    /**
     * Set error message
     */
    setError: (error: string) => {
      setState('connection', 'lastError', Option.some(error))
    },

    /**
     * Clear error message
     */
    clearError: () => {
      setState('connection', 'lastError', Option.none())
      setState('discovery', 'refreshError', Option.none())
      setState('creation', 'creationError', Option.none())
    }
  }
  
  // Auto-run effects with runtime when available
  const runEffect = <E, A>(effect: Effect.Effect<A, E>) => {
    Option.match(effectRuntime, {
      onSome: (runtime) => {
        Runtime.runPromiseExit(runtime)(effect).then(exit => {
          if (exit._tag === 'Failure') {
            console.error('Lobby store effect failed:', exit.cause)
          }
        })
      },
      onNone: () => {
        console.warn('Effect runtime not available, deferring effect')
      }
    })
  }

  return {
    // Reactive state (read-only)
    state: state as Readonly<LobbyState>,
    
    // UI signals
    isConnecting,
    isRefreshing,
    isCreating,
    
    // Actions
    actions,
    
    // Computed values
    get isConnected() {
      return state.connection.state === 'connected'
    },
    
    get availableRooms() {
      return state.discovery.availableRooms as RoomInfo[]
    },
    
    get connectionError() {
      return Option.getOrNull(state.connection.lastError)
    },
    
    get lastCreatedRoomId() {
      return Option.getOrNull(state.creation.lastCreatedRoomId)
    },
    
    // Effect runner (for external use)
    runEffect
  }
}

/**
 * Lobby store type
 */
export type LobbyStore = ReturnType<typeof createLobbyStore>