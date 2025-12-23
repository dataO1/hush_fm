import { For, Show, createResource, createSignal } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { Option as O } from 'effect'
import { useConnectionAdapter, useLobbyAdapter, useUserAdapter, useRuntime } from '../../App'
import { useLobbyService } from '../hooks/useEffectService'
import ConnectionStatusDot from '../components/ConnectionStatusDot'
import { RoomCard } from '../components/room/RoomCard'
import type { LobbyRoomType } from '../../domain/schemas/lobby.schema'

export default function Landing() {
  const navigate = useNavigate()

  // SolidJS 2025: Use Effect services through hooks
  const lobbyService = useLobbyService()

  // Use stores for reactive state (read-only)
  const djStore = useDJStore()
  const listenersStore = useListenersStore()
  const lobbyStore = useLobbyStore()
  const userStore = useUserStore()

  // SolidJS 2025: Use createResource for lobby initialization
  const [lobbyInitialization] = createResource(async () => {
    console.info('🏠 Landing: Checking active connections and initializing lobby...')
    
    // Check if we have active DJ streaming or listener connections
    const isDJStreaming = djStore.isStreaming()
    const activeListenerRoomId = listenersStore.getActiveListenerRoomId()
    const hasActiveListeners = activeListenerRoomId !== null
    
    console.info(`🔍 Landing: Connection state debug:`)
    console.info(`  🎤 DJ streaming: ${isDJStreaming}`)
    console.info(`  🎧 Active listener room: ${activeListenerRoomId}`)
    console.info(`  🎧 Has active listeners: ${hasActiveListeners}`)
    
    if (isDJStreaming || hasActiveListeners) {
      console.info('⚡ Landing: Preserving active connections - using smart initialization')
      return await lobbyService.initializeWithActiveConnectionCheck()
    } else {
      console.info('🏠 Landing: No active connections - using clean initialization')
      return await lobbyService.initialize()
    }
  })


  // SolidJS 2025: Use signals for form state and createResource for room creation
  const [roomCreationData, setRoomCreationData] = createSignal<{name: string, dj: string} | null>(null)
  
  const [roomCreation] = createResource(roomCreationData, async (data) => {
    if (!data) return null
    
    console.info('🏠 Creating room via Lobby Application Service...')
    
    const result = await lobbyService.announceRoomCreation({
      roomName: data.name,
      djName: data.dj,
      description: `${data.dj}'s room`
    })
    
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
  const handleRoomAction = async (roomId: string, room: RoomInfo) => {
    try {
      console.info('🏠 Processing room action via Application Services...', { roomId })
      
      // Check if this is an active listener room (navigation only)
      const activeListenerRoomId = listenersStore.getActiveListenerRoomId()
      if (activeListenerRoomId === roomId) {
        console.info('🎧 Navigating back to active listener room:', roomId)
        navigate(`/listen/${roomId}`)
        return
      }
      
      // Check if this is our own DJ room (DJ reconnection) 
      const currentSessionId = O.getOrNull(userStore.state.sessionId)
      const isStreaming = djStore.isStreaming() 
      const djRoomId = djStore.state?.websocket?.roomId ? O.getOrNull(djStore.state.websocket.roomId) : null
      
      if (isStreaming && djRoomId === roomId) {
        console.info('🎤 Navigating back to active DJ room:', roomId)
        navigate(`/dj/${roomId}`)
        return
      }
      
      // Check if this is the user's own room for DJ reconnection
      if (currentSessionId && (room as any).djId === currentSessionId) {
        console.info('🔄 Reconnecting to own DJ room via room announcement:', roomId)
        
        try {
          const result = await lobbyService.announceRoomCreation({
            roomName: room.name,
            djName: room.djName,
            description: room.description,
            tags: room.tags
          })
          
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
      
      if (!currentSessionId) {
        console.error('❌ Cannot join room: No session ID available')
        return
      }
      
      try {
        const joinResult = await lobbyService.requestJoinRoom(roomId, currentSessionId)
        
        if (joinResult && joinResult.listenerWebSocketUrl) {
          console.info('✅ Join request successful, navigating to listener room')
          
          navigate(`/listen/${roomId}`, {
            state: { 
              listenerWebSocketUrl: joinResult.listenerWebSocketUrl,
              sessionId: currentSessionId,
              roomInfo: {
                id: room.id,
                name: room.name,
                djName: room.djName,
                description: room.description,
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
  
  // Computed values from stores (read-only)
  const availableRooms = () => lobbyStore.availableRooms
  const isLoading = () => lobbyStore.isLoading() || lobbyInitialization.loading
  const isCreating = () => lobbyStore.isCreating() || roomCreation.loading
  
  // SolidJS 2025: Use computed for Option types that return null-safe values
  const connectionError = () => lobbyStore.connectionError()
  const creationError = () => lobbyStore.creationError()
  
  // SolidJS 2025: Use createResource for async service calls with proper Option handling
  const [sortedRooms] = createResource(
    // Source signal that triggers refetch
    () => ({ 
      rooms: availableRooms(), 
      sessionId: userStore.state.sessionId, 
      activeListenerRoomId: listenersStore.getActiveListenerRoomId() 
    }),
    // Fetcher function that calls the service
    async (source) => {
      const sessionId = O.getOrNull(source.sessionId)
      const activeListenerRoomId = O.getOrNull(source.activeListenerRoomId)
      return await lobbyService.sortRoomsForUser(source.rooms, sessionId || '', activeListenerRoomId)
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
                  onClick={() => lobbyStore.actions.clearError()}
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
                  onClick={() => lobbyStore.actions.clearError()}
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