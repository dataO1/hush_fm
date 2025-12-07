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
              setRooms(prev => prev.map(r => 
                r.id === message.room.id ? message.room : r
              ))
            }
            break
          case 'RoomRemoved':
            if (message.room_id) {
              setRooms(prev => prev.filter(r => r.id !== message.room_id))
            }
            break
        }
      }))
    })

    Effect.runPromise(program).catch((err) => {
      console.error('WebSocket connection failed:', err)
    })
  })

  const createRoom = async () => {
    if (!roomName().trim()) return
    
    setCreating(true)
    const program = Effect.gen(function* (_) {
      const room = yield* _(Api.createRoom({ name: roomName().trim() }))
      navigate(`/dj/${room.room_id}`)
    })

    try {
      await Effect.runPromise(program)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  const joinRoom = (roomId: string) => {
    navigate(`/listen/${roomId}`)
  }

  return (
    <div class="min-h-screen bg-base-100 p-4">
      <div class="max-w-4xl mx-auto grid md:grid-cols-2 gap-4">
        {/* Create Room */}
        <div class="card bg-base-200">
          <div class="card-body">
            <h2 class="card-title">Create Room</h2>
            <input
              type="text"
              class="input input-bordered"
              placeholder="Room name"
              value={roomName()}
              onInput={(e) => setRoomName(e.currentTarget.value)}
              onKeyPress={(e) => e.key === 'Enter' && createRoom()}
            />
            <div class="card-actions">
              <button
                class="btn btn-primary btn-block"
                onClick={createRoom}
                disabled={creating() || !roomName().trim()}
              >
                {creating() ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>

        {/* Room List */}
        <div class="card bg-base-200">
          <div class="card-body">
            <h2 class="card-title">Active Rooms</h2>
            <Show
              when={!loading()}
              fallback={<div class="loading loading-spinner"></div>}
            >
              <Show
                when={rooms().length > 0}
                fallback={<p class="text-base-content/60">No active rooms</p>}
              >
                <div class="space-y-2">
                  <For each={rooms()}>
                    {(room) => (
                      <div class="flex justify-between items-center p-3 bg-base-100 rounded">
                        <div>
                          <div class="font-medium">{room.name}</div>
                          <div class="text-sm text-base-content/60">
                            {room.listener_count} listeners
                          </div>
                        </div>
                        <div class="flex items-center gap-2">
                          {room.dj_streaming && (
                            <div class="badge badge-success">LIVE</div>
                          )}
                          <button
                            class="btn btn-sm"
                            onClick={() => joinRoom(room.id)}
                          >
                            Join
                          </button>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </div>
        </div>
      </div>

      {/* Error Alert */}
      <Show when={error()}>
        <div class="alert alert-error max-w-md mx-auto mt-4">
          <span>{error()}</span>
          <button class="btn btn-sm btn-circle" onClick={() => setError(null)}>✕</button>
        </div>
      </Show>
    </div>
  )
}