import { For, Show, onMount, onCleanup, createMemo } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { Effect } from 'effect'
import { createLobbyStore } from '../../stores/lobby.store'
import { getUserStore } from '../../stores/user.store'
import { getSessionId } from '../../services/user.service'
import {
  connectToLobbyWebSocket,
  discoverRooms,
  subscribeLobbyEvents,
  announceRoomCreation,
  leaveLobby,
  type CreateRoomRequest
} from '../../services/flows/lobby-flows.service'
import type { LobbyEvent } from '../../services/websocket/schemas/websocket'
import ConnectionStatusDot from '../components/ConnectionStatusDot'

export default function Landing() {
  const navigate = useNavigate()

  // Create store instances
  const lobbyStore = createLobbyStore()
  const userStore = getUserStore()
  
  // Track WebSocket for cleanup
  let currentWebSocket: WebSocket | null = null

  // Connect to lobby on mount
  onMount(async () => {
    try {
      lobbyStore.actions.setConnecting(true)
      
      // Connect to lobby WebSocket
      const ws = await Effect.runPromise(connectToLobbyWebSocket())
      currentWebSocket = ws
      lobbyStore.actions.setConnected(ws)
      
      // Subscribe to lobby events
      const subscribe = await Effect.runPromise(subscribeLobbyEvents(ws))
      subscribe((event: LobbyEvent) => {
        switch (event.type) {
          case 'roomAdded':
            lobbyStore.actions.addRoom(event.room)
            break
          case 'roomUpdated':
            lobbyStore.actions.updateRoom(event.room)
            break
          case 'roomRemoved':
            lobbyStore.actions.removeRoom(event.roomId)
            break
        }
      })
      
      // Initial room discovery
      await loadRooms()
    } catch (error) {
      console.error('Failed to connect to lobby:', error)
      lobbyStore.actions.setConnectionError(error instanceof Error ? error.message : 'Connection failed')
    }
  })

  // Cleanup on unmount
  onCleanup(() => {
    if (currentWebSocket) {
      Effect.runPromise(leaveLobby(currentWebSocket))
        .catch(err => console.error('Error disconnecting:', err))
      currentWebSocket = null
    }
    lobbyStore.actions.setDisconnected()
  })

  // Load rooms helper
  const loadRooms = async () => {
    try {
      lobbyStore.actions.setRoomsLoading(true)
      const rooms = await Effect.runPromise(discoverRooms())
      lobbyStore.actions.setRooms(rooms)
    } catch (error) {
      console.error('Failed to load rooms:', error)
      lobbyStore.actions.setRoomDiscoveryError(error instanceof Error ? error.message : 'Failed to load rooms')
    }
  }
  
  // Create room handler
  const handleCreateRoom = async (e: Event) => {
    e.preventDefault()
    
    const form = e.target as HTMLFormElement
    const formData = new FormData(form)
    const name = (formData.get('roomName') as string)?.trim()
    const dj = (formData.get('djName') as string)?.trim()
    
    if (!name || !dj) {
      lobbyStore.actions.setRoomCreationError('Please enter both room name and DJ name')
      return
    }
    
    if (!currentWebSocket) {
      lobbyStore.actions.setRoomCreationError('Not connected to lobby')
      return
    }

    lobbyStore.actions.clearError()
    
    try {
      lobbyStore.actions.setRoomCreating(true)
      
      const request: CreateRoomRequest = {
        name,
        djName: dj,
        description: `${dj}'s room`
      }
      
      const result = await Effect.runPromise(announceRoomCreation(currentWebSocket, request))
      
      lobbyStore.actions.setLastCreatedRoom(result.roomId)
      
      // Close modal and navigate to DJ room
      closeModal()
      navigate(`/dj/${result.roomId}`, {
        state: { djWebSocketUrl: result.djWebSocketUrl }
      })
    } catch (error) {
      console.error('Failed to create room:', error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to create room'
      lobbyStore.actions.setRoomCreationError(errorMessage)
    }
  }

  // Join room as listener
  const handleJoinRoom = async (roomId: string) => {
    try {
      lobbyStore.actions.clearError()
      
      // Ensure we have a session ID
      const sessionId = await Effect.runPromise(getSessionId(userStore))
      
      if (!currentWebSocket) {
        lobbyStore.actions.setConnectionError('Not connected to lobby')
        return
      }
      
      console.info('🎧 Requesting to join room:', { roomId, sessionId })
      
      // Send requestJoin command to lobby WebSocket
      const requestJoinCommand = {
        type: 'requestJoin' as const,
        sessionId,
        roomId
      }
      
      currentWebSocket.send(JSON.stringify(requestJoinCommand))
      
      // Wait for joinRoomResponse
      const joinResponse = await waitForJoinResponse(currentWebSocket, sessionId, roomId)
      
      if (joinResponse.success && joinResponse.listenerWebSocketUrl) {
        console.info('✅ Join request successful, navigating to listener room')
        
        // Navigate to listener room with unique WebSocket URL
        navigate(`/listen/${roomId}`, {
          state: { 
            listenerWebSocketUrl: joinResponse.listenerWebSocketUrl,
            roomInfo: joinResponse.room,
            sessionId
          }
        })
      } else {
        throw new Error(joinResponse.error || 'Join request failed')
      }
      
    } catch (error) {
      console.error('❌ Failed to join room:', error)
      lobbyStore.actions.setConnectionError(error instanceof Error ? error.message : 'Failed to join room')
    }
  }

  // Wait for join room response from lobby WebSocket
  const waitForJoinResponse = (
    websocket: WebSocket, 
    sessionId: string, 
    roomId: string
  ): Promise<any> => {
    return new Promise((resolve, reject) => {
      const handleMessage = (event: MessageEvent) => {
        try {
          const message = JSON.parse(event.data)
          
          // Check if this is our joinRoomResponse
          if (
            message.type === 'joinRoomResponse' && 
            message.sessionId === sessionId && 
            message.roomId === roomId
          ) {
            websocket.removeEventListener('message', handleMessage)
            clearTimeout(timeoutId)
            resolve(message)
          }
        } catch (error) {
          // Continue listening for other messages
        }
      }
      
      // Set up timeout
      const timeoutId = setTimeout(() => {
        websocket.removeEventListener('message', handleMessage)
        reject(new Error('Timeout waiting for join room response'))
      }, 10000) // 10 second timeout
      
      websocket.addEventListener('message', handleMessage)
    })
  }

  // Modal control functions
  const openModal = () => {
    const modal = document.getElementById('createRoomModal') as HTMLDialogElement
    modal?.showModal()
  }

  const closeModal = () => {
    const modal = document.getElementById('createRoomModal') as HTMLDialogElement
    modal?.close()
    lobbyStore.actions.clearError() // Clear any errors when closing modal
  }
  
  // Computed error state for UI display
  const displayError = createMemo(() => lobbyStore.connectionError || lobbyStore.creationError)

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

        {/* Error Display */}
        <Show when={displayError()}>
          <div class="bg-red-500/20 border border-red-500 text-red-100 px-4 py-3 rounded mb-6">
            <div class="flex justify-between items-center">
              <span>{String(displayError() || '')}</span>
              <button 
                onClick={() => lobbyStore.actions.clearError()}
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
                when={lobbyStore.availableRooms.length > 0}
                fallback={
                  <div class="text-center text-gray-400 py-6 sm:py-8">
                    <Show 
                      when={lobbyStore.isRefreshing()}
                      fallback="No rooms available. Create the first one!"
                    >
                      Loading rooms...
                    </Show>
                  </div>
                }
              >
                <For each={lobbyStore.availableRooms}>
                  {(room) => (
                    <div class="bg-white/5 rounded-lg p-3 sm:p-4 border border-white/10 hover:border-white/20 transition-colors">
                      <div class="flex justify-between items-start mb-2 sm:mb-3">
                        <div class="flex-1 min-w-0">
                          <div class="flex items-center gap-2 mb-1">
                            <Show when={room.isStreaming}>
                              <ConnectionStatusDot size="sm" connectionState="connected" title="Live Stream" />
                            </Show>
                            <h3 class="font-bold text-base sm:text-lg truncate">{room.name}</h3>
                          </div>
                          <p class="text-gray-300 text-sm truncate">DJ: {room.djName}</p>
                        </div>
                        <div class="text-right ml-2 shrink-0">
                          <div class="text-xs sm:text-sm text-gray-400">
                            {room.listenerCount || 0} listeners
                          </div>
                        </div>
                      </div>
                      
                      <Show when={room.description}>
                        <p class="text-gray-400 text-sm mb-3">{room.description}</p>
                      </Show>
                      
                      <button
                        onClick={() => handleJoinRoom(room.id)}
                        class="w-full bg-green-500 hover:bg-green-600 text-white font-medium py-2 px-3 sm:px-4 rounded transition-colors text-sm sm:text-base"
                      >
                        Join Room
                      </button>
                    </div>
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
            
            {/* Error Display in Modal */}
            <Show when={displayError()}>
              <div class="bg-red-500/20 border border-red-500 text-red-100 px-4 py-3 rounded-lg mb-6">
                <span class="text-sm sm:text-base">{String(displayError() || '')}</span>
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
                disabled={lobbyStore.isCreating()}
                class="btn bg-gradient-to-r from-pink-500 to-violet-500 hover:from-pink-600 hover:to-violet-600 border-0 text-white font-medium w-full sm:flex-1 py-3 rounded-lg text-sm sm:text-base disabled:opacity-50"
              >
                <Show when={lobbyStore.isCreating()} fallback="Create Room & Start Streaming">
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