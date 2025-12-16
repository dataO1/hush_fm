import { createSignal, For, Show, onMount, onCleanup } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { Effect } from 'effect'
import { createLobbyStore } from '../../stores/lobby.store'

export default function Landing() {
  const navigate = useNavigate()
  const [djName, setDjName] = createSignal('')
  const [roomName, setRoomName] = createSignal('')
  const [error, setError] = createSignal<string | null>(null)

  // Create lobby store instance
  const lobbyStore = createLobbyStore()

  // Connect to lobby on mount
  onMount(() => {
    const connectEffect = lobbyStore.actions.connectToLobby()
    lobbyStore.runEffect(connectEffect)
  })

  // Cleanup on unmount
  onCleanup(() => {
    const disconnectEffect = lobbyStore.actions.disconnectFromLobby()
    lobbyStore.runEffect(disconnectEffect)
  })

  // Create room handler
  const handleCreateRoom = () => {
    const name = roomName().trim()
    const dj = djName().trim()
    
    if (!name || !dj) {
      setError('Please enter both room name and DJ name')
      return
    }

    setError(null)
    
    const createRoomEffect = Effect.gen(function* (_) {
      const result = yield* _(lobbyStore.actions.createRoom({
        name,
        djName: dj,
        description: `${dj}'s room`
      }))

      // Navigate to DJ room with the returned WebSocket URL
      navigate(`/dj/${result.roomId}`, {
        state: { djWebSocketUrl: result.djWebSocketUrl }
      })
    }).pipe(
      Effect.catchAll((error) => 
        Effect.sync(() => {
          setError(`Failed to create room: ${error.message || error}`)
        })
      )
    )

    lobbyStore.runEffect(createRoomEffect)
  }

  // Join room as listener
  const handleJoinRoom = (roomId: string) => {
    navigate(`/listen/${roomId}`)
  }

  // Refresh room listings
  const handleRefreshRooms = () => {
    const refreshEffect = lobbyStore.actions.refreshRooms()
    lobbyStore.runEffect(refreshEffect)
  }

  return (
    <div class="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 text-white">
      <div class="container mx-auto px-4 py-8">
        {/* Header */}
        <div class="text-center mb-12">
          <h1 class="text-6xl font-bold mb-4 bg-gradient-to-r from-pink-500 to-violet-500 bg-clip-text text-transparent">
            HushFM
          </h1>
          <p class="text-xl text-gray-300">Live Audio Streaming Platform</p>
        </div>

        {/* Error Display */}
        <Show when={error()}>
          <div class="bg-red-500/20 border border-red-500 text-red-100 px-4 py-3 rounded mb-6">
            <div class="flex justify-between items-center">
              <span>{error()}</span>
              <button 
                onClick={() => setError(null)}
                class="text-red-200 hover:text-white"
              >
                ✕
              </button>
            </div>
          </div>
        </Show>

        {/* Connection Status */}
        <div class="mb-8 text-center">
          <Show 
            when={lobbyStore.isConnected}
            fallback={
              <div class="text-yellow-300">
                <Show 
                  when={lobbyStore.isConnecting()} 
                  fallback={<span>Disconnected from lobby</span>}
                >
                  <span>Connecting to lobby...</span>
                </Show>
              </div>
            }
          >
            <div class="text-green-300">Connected to lobby ✓</div>
          </Show>
        </div>

        <div class="grid lg:grid-cols-2 gap-12">
          {/* Create Room Section */}
          <div class="bg-white/10 backdrop-blur-sm rounded-2xl p-8 border border-white/20">
            <h2 class="text-3xl font-bold mb-6 text-center">Start Streaming</h2>
            
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium mb-2">Your Name (DJ)</label>
                <input
                  type="text"
                  value={djName()}
                  onInput={(e) => setDjName(e.currentTarget.value)}
                  placeholder="Enter your DJ name"
                  class="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/30 text-white placeholder-gray-300 focus:outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20"
                />
              </div>
              
              <div>
                <label class="block text-sm font-medium mb-2">Room Name</label>
                <input
                  type="text"
                  value={roomName()}
                  onInput={(e) => setRoomName(e.currentTarget.value)}
                  placeholder="Enter room name"
                  class="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/30 text-white placeholder-gray-300 focus:outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20"
                />
              </div>

              <button
                onClick={handleCreateRoom}
                disabled={lobbyStore.isCreating() || !djName().trim() || !roomName().trim()}
                class="w-full bg-gradient-to-r from-pink-500 to-violet-500 hover:from-pink-600 hover:to-violet-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 px-8 rounded-lg transition-all transform hover:scale-105 disabled:hover:scale-100"
              >
                <Show when={lobbyStore.isCreating()} fallback="Create Room & Start Streaming">
                  Creating Room...
                </Show>
              </button>
            </div>
          </div>

          {/* Join Room Section */}
          <div class="bg-white/10 backdrop-blur-sm rounded-2xl p-8 border border-white/20">
            <div class="flex justify-between items-center mb-6">
              <h2 class="text-3xl font-bold">Live Rooms</h2>
              <button
                onClick={handleRefreshRooms}
                disabled={lobbyStore.isRefreshing()}
                class="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 rounded-lg transition-colors"
              >
                <Show when={lobbyStore.isRefreshing()} fallback="Refresh">
                  Refreshing...
                </Show>
              </button>
            </div>

            <div class="space-y-3 max-h-96 overflow-y-auto">
              <Show 
                when={lobbyStore.availableRooms.length > 0}
                fallback={
                  <div class="text-center text-gray-400 py-8">
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
                    <div class="bg-white/5 rounded-lg p-4 border border-white/10 hover:border-white/20 transition-colors">
                      <div class="flex justify-between items-start mb-2">
                        <div>
                          <h3 class="font-bold text-lg">{room.name}</h3>
                          <p class="text-gray-300">DJ: {room.djName}</p>
                        </div>
                        <div class="text-right">
                          <div class="text-sm text-gray-400">
                            {room.listenerCount || 0} listeners
                          </div>
                          <Show when={room.isStreaming}>
                            <div class="text-green-400 text-xs">🔴 LIVE</div>
                          </Show>
                        </div>
                      </div>
                      
                      <Show when={room.description}>
                        <p class="text-gray-400 text-sm mb-3">{room.description}</p>
                      </Show>
                      
                      <button
                        onClick={() => handleJoinRoom(room.id)}
                        class="w-full bg-green-500 hover:bg-green-600 text-white font-medium py-2 px-4 rounded transition-colors"
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
      </div>
    </div>
  )
}