import { createSignal, createEffect, For, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { Effect } from 'effect'
import * as Api from '../api/client'
import { connectWebSocket, subscribeToMessages, BroadcastMessage } from '../ws/client'

interface Room {
  id: string
  name: string
  dj_id: string
  dj_streaming: boolean
  listener_count: number
}

export default function Landing() {
  const navigate = useNavigate()
  const [rooms, setRooms] = createSignal<Room[]>([])
  const [roomName, setRoomName] = createSignal('')
  const [creating, setCreating] = createSignal(false)
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)

  // Load initial rooms
  createEffect(() => {
    const program = Effect.gen(function* (_) {
      const roomList = yield* _(Api.listRooms())
      setRooms(roomList)
      setLoading(false)
    })

    Effect.runPromise(program).catch((err) => {
      setError(`Failed to load rooms: ${err.message}`)
      setLoading(false)
    })
  })

  // Subscribe to real-time room updates
  createEffect(() => {
    const program = Effect.gen(function* (_) {
      const ws = yield* _(connectWebSocket('ws://localhost:3000/ws/lobby'))
      
      yield* _(subscribeToMessages<BroadcastMessage>(ws, (message) => {
        switch (message.type) {
          case 'RoomAdded':
            if (message.room) {
              setRooms(prev => [...prev, message.room])
            }
            break
          case 'RoomUpdated':
            if (message.room) {
              setRooms(prev => prev.map(room => 
                room.id === message.room.id ? message.room : room
              ))
            }
            break
          case 'RoomRemoved':
            if (message.room_id) {
              setRooms(prev => prev.filter(room => room.id !== message.room_id))
            }
            break
        }
      }, (err) => {
        console.error('WebSocket error:', err)
      }))
    })

    Effect.runPromise(program).catch((err) => {
      console.error('Failed to connect to lobby WebSocket:', err)
    })
  })

  const createRoom = async () => {
    if (!roomName().trim()) {
      setError('Please enter a room name')
      return
    }

    setCreating(true)
    setError(null)

    const program = Effect.gen(function* (_) {
      const response = yield* _(Api.createRoom({ name: roomName().trim() }))
      navigate(`/dj/${response.room_id}`)
    })

    try {
      await Effect.runPromise(program)
    } catch (err: any) {
      setError(`Failed to create room: ${err.message}`)
    } finally {
      setCreating(false)
    }
  }

  const joinRoom = (roomId: string) => {
    navigate(`/listen/${roomId}`)
  }

  return (
    <div class="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100">
      {/* Header */}
      <header class="bg-white/80 backdrop-blur-lg border-b border-white/20">
        <div class="max-w-6xl mx-auto px-6 py-6">
          <div class="text-center">
            <h1 class="text-4xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent mb-2">
              🎵 HushFM
            </h1>
            <p class="text-gray-600 text-lg">
              Local Network Audio Streaming
            </p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main class="max-w-6xl mx-auto px-6 py-12">
        {/* Welcome Section */}
        <div class="text-center mb-16">
          <h2 class="text-3xl font-bold text-gray-800 mb-4">
            Welcome to Your Personal Radio Station
          </h2>
          <p class="text-xl text-gray-600 max-w-2xl mx-auto">
            Stream and listen to live audio on your local network. 
            Create a room to start broadcasting, or join an existing room to listen.
          </p>
        </div>

        <Show when={error()}>
          <div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-8 max-w-2xl mx-auto">
            {error()}
          </div>
        </Show>

        {/* Main Interface Grid */}
        <div class="grid lg:grid-cols-2 gap-12 items-start">
          {/* Left Column - Create Room */}
          <div class="bg-white/70 backdrop-blur-sm rounded-2xl p-8 border border-white/30 shadow-lg">
            <div class="text-center mb-6">
              <div class="w-16 h-16 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <span class="text-2xl">🎤</span>
              </div>
              <h3 class="text-2xl font-semibold text-gray-800 mb-2">
                Start Broadcasting
              </h3>
              <p class="text-gray-600">
                Create a new room and start streaming audio to listeners on your network
              </p>
            </div>

            <div class="space-y-4">
              <div>
                <label for="roomName" class="block text-sm font-medium text-gray-700 mb-2">
                  Room Name
                </label>
                <input
                  id="roomName"
                  type="text"
                  placeholder="Enter room name..."
                  value={roomName()}
                  onInput={(e) => setRoomName(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && createRoom()}
                  disabled={creating()}
                  class="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>
              
              <button
                onClick={createRoom}
                disabled={creating() || !roomName().trim()}
                class="w-full py-3 px-6 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-105"
              >
                <Show when={creating()} fallback="Create Room & Start Streaming">
                  <div class="flex items-center justify-center">
                    <div class="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                    Creating Room...
                  </div>
                </Show>
              </button>
            </div>
          </div>

          {/* Right Column - Join Rooms */}
          <div class="bg-white/70 backdrop-blur-sm rounded-2xl p-8 border border-white/30 shadow-lg">
            <div class="text-center mb-6">
              <div class="w-16 h-16 bg-gradient-to-r from-blue-500 to-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <span class="text-2xl">🎧</span>
              </div>
              <h3 class="text-2xl font-semibold text-gray-800 mb-2">
                Join a Room
              </h3>
              <p class="text-gray-600">
                Listen to live audio streams from DJs on your network
              </p>
            </div>

            <Show when={loading()}>
              <div class="text-center py-8">
                <div class="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                <p class="text-gray-500">Loading rooms...</p>
              </div>
            </Show>

            <Show when={!loading()}>
              <div class="space-y-3">
                <div class="flex items-center justify-between mb-4">
                  <span class="text-sm font-medium text-gray-700">
                    Active Rooms ({rooms().length})
                  </span>
                </div>

                <Show when={rooms().length === 0}>
                  <div class="text-center py-12">
                    <div class="text-gray-400 text-4xl mb-4">🏠</div>
                    <p class="text-gray-500 mb-2">No active rooms</p>
                    <p class="text-sm text-gray-400">Create the first room to get started</p>
                  </div>
                </Show>

                <Show when={rooms().length > 0}>
                  <div class="space-y-3 max-h-96 overflow-y-auto">
                    <For each={rooms()}>
                      {(room) => (
                        <div class="border border-gray-200 rounded-xl p-4 hover:shadow-md transition-all duration-200 cursor-pointer hover:border-blue-300"
                             onClick={() => joinRoom(room.id)}>
                          <div class="flex items-center justify-between">
                            <div>
                              <h4 class="font-semibold text-gray-800 mb-1">{room.name}</h4>
                              <div class="flex items-center gap-2">
                                <span class={`px-2 py-1 rounded-full text-xs font-medium ${
                                  room.dj_streaming 
                                    ? 'bg-red-100 text-red-700' 
                                    : 'bg-gray-100 text-gray-600'
                                }`}>
                                  {room.dj_streaming ? '🔴 LIVE' : '⏸️ Offline'}
                                </span>
                                <span class="text-sm text-gray-500">
                                  {room.listener_count} listeners
                                </span>
                              </div>
                            </div>
                            <button class="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
                              Join
                            </button>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>
          </div>
        </div>

        {/* Footer Info */}
        <div class="text-center mt-16 py-8 border-t border-white/30">
          <p class="text-gray-500 mb-4">
            HushFM operates on your local WiFi network only. No internet connection required.
          </p>
          <div class="flex justify-center items-center gap-8 text-sm text-gray-500">
            <div class="flex items-center gap-2">
              <span>🔒</span>
              <span>Private Network</span>
            </div>
            <div class="flex items-center gap-2">
              <span>⚡</span>
              <span>Low Latency</span>
            </div>
            <div class="flex items-center gap-2">
              <span>🎵</span>
              <span>High Quality Audio</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}