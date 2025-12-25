import { For, Show, createResource, createSignal, onCleanup, createContext, useContext, ParentComponent } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { Option as O, Effect, Context, ManagedRuntime, Layer } from 'effect'
import { useConnectionAdapter, useLobbyAdapter, useUserAdapter } from '../../App'
import { LobbyService, LobbyServiceLive } from '../../services/application/LobbyService'
import { LobbyAdapter } from '../../stores'
import ConnectionStatusDot from '../components/ConnectionStatusDot'
import { RoomCard } from '../components/room/RoomCard'
import type { LobbyRoomInfoType } from '../../domain/schemas/lobby.schema'

// Lobby Feature Service Context
interface LobbyFeatureContextValue {
  lobbyService: Context.Tag.Service<LobbyService>
}

const LobbyFeatureContext = createContext<LobbyFeatureContextValue>()

const LobbyFeatureProvider: ParentComponent = (props) => {
  // Create lobby service using scoped runtime to keep it alive for component lifecycle
  // Provide all necessary adapter dependencies
  const lobbyAdapter = useLobbyAdapter()
  const lobbyServiceRuntime = ManagedRuntime.make(
    LobbyServiceLive.pipe(
      Layer.provide(Layer.succeed(LobbyAdapter, lobbyAdapter))
    )
  )
  const lobbyService = lobbyServiceRuntime.runSync(LobbyService)
  
  const services: LobbyFeatureContextValue = {
    lobbyService
  }
  
  // Cleanup on unmount
  onCleanup(async () => {
    console.info('🏠 LobbyFeatureProvider: Cleaning up on unmount')
    try {
      await lobbyService.disconnectFromLobby().pipe(Effect.runPromise)
      await lobbyServiceRuntime.dispose()
    } catch (error) {
      console.warn('⚠️ LobbyFeatureProvider: Error during cleanup:', error)
    }
  })
  
  return (
    <LobbyFeatureContext.Provider value={services}>
      {props.children}
    </LobbyFeatureContext.Provider>
  )
}

const useLobbyFeature = () => {
  const context = useContext(LobbyFeatureContext)
  if (!context) {
    throw new Error('useLobbyFeature must be used within LobbyFeatureProvider')
  }
  return context
}

function LandingContent() {
  const navigate = useNavigate()

  // Use adapters for reactive state (read-only)
  const connectionAdapter = useConnectionAdapter()
  const lobbyAdapter = useLobbyAdapter()
  const userAdapter = useUserAdapter()
  
  // Get scoped lobby service
  const { lobbyService } = useLobbyFeature()
  
  // Set up cleanup when the component unmounts
  onCleanup(async () => {
    console.info('🏠 Landing: Cleaning up on component unmount')
    try {
      await lobbyService.disconnectFromLobby().pipe(Effect.runPromise)
    } catch (error) {
      console.warn('⚠️ Landing: Error during cleanup:', error)
    }
  })

  // SolidJS 2025: Use createResource for lobby initialization
  const [lobbyInitialization] = createResource(async () => {
    console.info('🏠 Landing: Checking active connections and initializing lobby...')
    
    // Check if we have active DJ streaming or listener connections
    const currentRole = userAdapter.getCurrentRole()
    const isDJStreaming = O.getOrNull(currentRole) === 'dj'
    const hasActiveListeners = connectionAdapter.isRoomConnected()
    
    console.info(`🔍 Landing: Connection state debug:`)
    console.info(`  🎤 DJ streaming: ${isDJStreaming}`)
    console.info(`  🎧 Has active listeners: ${hasActiveListeners}`)
    
    // Use scoped lobby service to connect
    console.info('🏠 Landing: Connecting to lobby')
    return await lobbyService.connectToLobby().pipe(
      Effect.runPromise
    )
  })


  // SolidJS 2025: Use signals for form state and createResource for room creation
  const [roomCreationData, setRoomCreationData] = createSignal<{name: string, dj: string} | null>(null)
  
  const [roomCreation] = createResource(roomCreationData, async (data) => {
    if (!data) return null
    
    console.info('🏠 Creating room via Lobby Application Service...')
    
    // Use scoped lobby service to announce room creation
    const result = await lobbyService.announceRoom(
      data.name, 
      data.dj, 
      O.getOrElse(userAdapter.getSessionId(), () => 'anonymous'),
      `${data.dj}'s room`,
      []
    ).pipe(
      Effect.runPromise
    )
    
    // Close modal and navigate to DJ room
    closeModal()
    navigate(`/dj/${result.roomId}`, {
      state: { djWebSocketUrl: result.djWebSocketUrl }
    })
    
    console.info('✅ Room created successfully:', result.roomId)
    return result
  })
  
  const handleCreateRoom = (e: Event) => {
    e.preventDefault()
    
    const form = e.target as HTMLFormElement
    const formData = new FormData(form)
    const name = (formData.get('roomName') as string)?.trim()
    const dj = (formData.get('djName') as string)?.trim()
    
    if (!name || !dj) {
      console.error('Please enter both room name and DJ name')
      return
    }
    
    // Trigger the resource by setting the signal
    setRoomCreationData({ name, dj })
  }

  // SolidJS 2025: Handle room interaction using Application Services
  const handleRoomAction = async (roomId: string, room: LobbyRoomInfoType) => {
    try {
      console.info('🏠 Processing room action via Application Services...', { roomId })
      
      // Check if this is an active listener room (navigation only)
      const isActiveListener = connectionAdapter.isRoomConnected()
      if (isActiveListener && roomId) {
        console.info('🎧 Navigating back to active listener room:', roomId)
        navigate(`/listen/${roomId}`)
        return
      }
      
      // Check if this is our own DJ room (DJ reconnection) 
      const currentSessionId = userAdapter.getSessionId()
      const currentRole = userAdapter.getCurrentRole()
      const isStreaming = O.getOrNull(currentRole) === 'dj'
      const isDJConnected = connectionAdapter.isConnected()
      
      if (isStreaming && isDJConnected) {
        console.info('🎤 Navigating back to active DJ room:', roomId)
        navigate(`/dj/${roomId}`)
        return
      }
      
      // Check if this is the user's own room for DJ reconnection
      const sessionId = O.getOrNull(currentSessionId)
      if (sessionId && room.djId === sessionId) {
        console.info('🔄 Reconnecting to own DJ room via room announcement:', roomId)
        
        try {
          // Use scoped lobby service to announce room reconnection
          const result = await lobbyService.announceRoom(
            room.name,
            room.djName,
            sessionId,
            O.getOrNull(room.description) || undefined,
            [...(room.tags || [])]
          ).pipe(
            Effect.runPromise
          )
          
          navigate(`/dj/${result.roomId}`, {
            state: { djWebSocketUrl: result.djWebSocketUrl }
          })
          console.info('✅ DJ room reconnection successful')
          return
        } catch (error) {
          console.error('❌ Failed to reconnect to DJ room:', error)
        }
      }
      
      // Regular listener join flow using LobbyService
      console.info('🎧 Requesting to join room as listener via LobbyService:', roomId)
      
      if (!sessionId) {
        console.error('❌ Cannot join room: No session ID available')
        return
      }
      
      try {
        // Use scoped lobby service to request join room
        const joinResult = await lobbyService.requestJoinRoom(roomId, sessionId).pipe(
          Effect.runPromise
        )
        
        if (joinResult && joinResult.listenerWebSocketUrl) {
          console.info('✅ Join request successful, navigating to listener room')
          
          navigate(`/listen/${roomId}`, {
            state: { 
              listenerWebSocketUrl: joinResult.listenerWebSocketUrl,
              sessionId: sessionId,
              roomInfo: {
                id: room.id,
                name: room.name,
                djName: room.djName,
                description: O.getOrNull(room.description),
                tags: room.tags,
                listenerCount: room.listenerCount,
                isPublic: room.isPublic
              }
            }
          })
        } else {
          console.error('❌ Join request failed: No result returned')
        }
      } catch (error) {
        console.error('❌ Failed to request room join:', error)
      }
      
    } catch (error) {
      console.error('❌ Failed to handle room action:', error)
    }
  }

  // SolidJS 2025: Modal control functions
  const openModal = () => {
    const modal = document.getElementById('createRoomModal') as HTMLDialogElement
    modal?.showModal()
  }

  const closeModal = () => {
    const modal = document.getElementById('createRoomModal') as HTMLDialogElement
    modal?.close()
  }
  
  // Computed values from adapters (read-only)
  const availableRooms = () => lobbyAdapter.getRooms()
  const isLoading = () => lobbyAdapter.isLoading() || lobbyInitialization.loading
  const isCreating = () => lobbyAdapter.isCreating() || roomCreation.loading
  
  // SolidJS 2025: Use computed for Option types that return null-safe values
  const connectionError = () => O.getOrNull(connectionAdapter.getError())
  const creationError = () => lobbyAdapter.getCreationError()
  
  // SolidJS 2025: Use createResource for async service calls with proper Option handling
  const [sortedRooms] = createResource(
    // Source signal that triggers refetch
    () => ({ 
      rooms: availableRooms(), 
      sessionId: userAdapter.getSessionId(), 
      isRoomConnected: connectionAdapter.isRoomConnected() 
    }),
    // Fetcher function that calls the service
    async (source) => {
      const sessionId = O.getOrNull(source.sessionId)
      // Use scoped lobby service to sort rooms
      return await lobbyService.sortRoomsForUser(source.rooms, sessionId || '', undefined).pipe(
        Effect.runPromise
      )
    }
  )

  return (
    <div class="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 text-white">
      <div class="container mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
        {/* Header */}
        <div class="text-center mb-6 sm:mb-8">
          <h1 class="text-3xl sm:text-4xl lg:text-5xl font-bold mb-2 bg-gradient-to-r from-pink-500 to-violet-500 bg-clip-text text-transparent">
            HushFM
          </h1>
          <p class="text-sm sm:text-base text-gray-400">Live Audio Streaming</p>
        </div>

        {/* Error Display using SolidJS Show for Option types */}
        <Show when={connectionError()}>
          {(error) => (
            <div class="bg-red-500/20 border border-red-500 text-red-100 px-4 py-3 rounded mb-6">
              <div class="flex justify-between items-center">
                <span>{String(error())}</span>
                <button 
                  onClick={() => connectionAdapter.clearError()}
                  class="text-red-200 hover:text-white"
                >
                  ✕
                </button>
              </div>
            </div>
          )}
        </Show>
        
        <Show when={creationError()}>
          {(error) => (
            <div class="bg-red-500/20 border border-red-500 text-red-100 px-4 py-3 rounded mb-6">
              <div class="flex justify-between items-center">
                <span>{String(error())}</span>
                <button 
                  onClick={() => connectionAdapter.clearError()}
                  class="text-red-200 hover:text-white"
                >
                  ✕
                </button>
              </div>
            </div>
          )}
        </Show>
        
        <Show when={roomCreation.error}>
          <div class="bg-red-500/20 border border-red-500 text-red-100 px-4 py-3 rounded mb-6">
            <div class="flex justify-between items-center">
              <span>Failed to create room: {roomCreation.error?.message}</span>
              <button 
                onClick={() => setRoomCreationData(null)}
                class="text-red-200 hover:text-white"
              >
                ✕
              </button>
            </div>
          </div>
        </Show>


        {/* Simplified Single Column Layout */}
        <div class="max-w-4xl mx-auto">
          {/* Live Rooms Section */}
          <div class="bg-white/10 backdrop-blur-sm rounded-xl sm:rounded-2xl p-4 sm:p-6 lg:p-8 border border-white/20">
            <div class="flex justify-between items-center mb-4 sm:mb-6">
              <div class="flex items-center gap-2 sm:gap-3">
                <ConnectionStatusDot size="sm" title="Connection Status" />
                <h2 class="text-xl sm:text-2xl lg:text-3xl font-bold">Live Rooms</h2>
              </div>
              <button
                onClick={openModal}
                class="btn btn-circle btn-primary btn-sm sm:btn-md lg:btn-lg"
                title="Create New Room"
              >
                <svg class="w-4 h-4 sm:w-6 sm:h-6 lg:w-8 lg:h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>

            <div class="space-y-2 sm:space-y-3 max-h-64 sm:max-h-80 lg:max-h-96 overflow-y-auto">
              <Show 
                when={sortedRooms() && sortedRooms()!.length > 0}
                fallback={
                  <div class="text-center text-gray-400 py-6 sm:py-8">
                    <Show when={sortedRooms.loading || isLoading()} fallback="No rooms available. Create the first one!">
                      Loading rooms...
                    </Show>
                  </div>
                }
              >
                <For each={sortedRooms()}>
                  {(room) => (
                    <RoomCard 
                      room={room}
                      onJoin={handleRoomAction}
                    />
                  )}
                </For>
              </Show>
            </div>
          </div>
        </div>

        {/* Create Room Modal */}
        <dialog id="createRoomModal" class="modal modal-backdrop:bg-black/50">
          <div class="modal-box max-w-sm sm:max-w-md bg-white/10 backdrop-blur-md border border-white/20 text-white rounded-2xl p-6 sm:p-8 shadow-2xl">
            <h3 class="font-bold text-xl sm:text-2xl mb-6 text-center bg-gradient-to-r from-pink-500 to-violet-500 bg-clip-text text-transparent">Start Streaming</h3>
            
            {/* Error Display in Modal using proper Show for Option types */}
            <Show when={creationError()}>
              {(error) => (
                <div class="bg-red-500/20 border border-red-500 text-red-100 px-4 py-3 rounded-lg mb-6">
                  <span class="text-sm sm:text-base">{String(error())}</span>
                </div>
              )}
            </Show>
            
            <Show when={roomCreation.error}>
              <div class="bg-red-500/20 border border-red-500 text-red-100 px-4 py-3 rounded-lg mb-6">
                <span class="text-sm sm:text-base">Failed to create room: {roomCreation.error?.message}</span>
              </div>
            </Show>
            
            <form id="createRoomForm" onSubmit={handleCreateRoom} class="space-y-5 sm:space-y-6">
              <div>
                <label class="block text-sm sm:text-base font-medium mb-3 text-white/90">Your Name (DJ)</label>
                <input
                  type="text"
                  name="djName"
                  placeholder="Enter your DJ name"
                  class="input w-full bg-white/10 border border-white/20 text-white placeholder-white/60 focus:border-pink-500 focus:outline-none rounded-lg px-4 py-3 text-sm sm:text-base"
                  required
                />
              </div>
              
              <div>
                <label class="block text-sm sm:text-base font-medium mb-3 text-white/90">Room Name</label>
                <input
                  type="text"
                  name="roomName"
                  placeholder="Enter room name"
                  class="input w-full bg-white/10 border border-white/20 text-white placeholder-white/60 focus:border-pink-500 focus:outline-none rounded-lg px-4 py-3 text-sm sm:text-base"
                  required
                />
              </div>
            </form>

            <div class="flex flex-col sm:flex-row gap-3 mt-8">
              <button
                type="submit"
                form="createRoomForm"
                disabled={isCreating()}
                class="btn bg-gradient-to-r from-pink-500 to-violet-500 hover:from-pink-600 hover:to-violet-600 border-0 text-white font-medium w-full sm:flex-1 py-3 rounded-lg text-sm sm:text-base disabled:opacity-50"
              >
                <Show when={isCreating()} fallback="Create Room & Start Streaming">
                  <>
                    <span class="loading loading-spinner loading-sm mr-2"></span>
                    Creating Room...
                  </>
                </Show>
              </button>
              <form method="dialog" class="w-full sm:w-auto">
                <button 
                  type="button" 
                  onClick={closeModal}
                  class="btn bg-white/10 hover:bg-white/20 border border-white/20 text-white w-full sm:w-auto py-3 rounded-lg text-sm sm:text-base"
                >
                  Cancel
                </button>
              </form>
            </div>
          </div>
        </dialog>
      </div>
    </div>
  )
}

export default function Landing() {
  return (
    <LobbyFeatureProvider>
      <LandingContent />
    </LobbyFeatureProvider>
  )
}