import { createSignal, createResource, For, Show, onMount, onCleanup } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { Effect } from 'effect'
import { listRooms, createRoom } from '../effects/api'
import { useSignaling, useRooms } from '../providers/AppProviders'

export default function Landing() {
  const navigate = useNavigate()
  const signaling = useSignaling()
  const [roomName, setRoomName] = createSignal('')
  const [creating, setCreating] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  // Use createResource for async room loading
  const [rooms] = createResource(async () => {
    const program = Effect.gen(function* (_) {
      const roomList = yield* _(listRooms())
      return roomList
    })

    try {
      const result = await Effect.runPromise(program)

      // Update signaling store with initial rooms
      signaling.setState({ rooms: result })

      return result
    } catch (err: any) {
      setError(`Failed to load rooms: ${err.message}`)
      throw err
    }
  }
  )

  // Connect to lobby WebSocket for real-time updates
  onMount(async () => {
    try {
      await signaling.connectToLobby()
    } catch (err: any) {
      setError(`Failed to connect to lobby: ${err.message}`)
    }
  })

  // Cleanup on unmount
  onCleanup(() => {
    signaling.disconnect()
  })

  const handleCreateRoom = async () => {
    if (!roomName().trim()) return

    setCreating(true)
    setError(null)

    const program = Effect.gen(function* (_) {
      const result = yield* _(createRoom({ name: roomName().trim() }))
      return result
    })

    try {
      const result = await Effect.runPromise(program)
      navigate(`/dj/${result.room_id}`)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  const joinRoom = (roomId: string) => {
    navigate(`/listen/${roomId}`)
  }

  // Get real-time rooms from signaling provider
  const realtimeRooms = useRooms()

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
              onKeyPress={(e) => e.key === 'Enter' && handleCreateRoom()}
            />
            <div class="card-actions">
              <button
                class="btn btn-primary btn-block"
                onClick={handleCreateRoom}
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
              when={!rooms.loading}
              fallback={<div class="loading loading-spinner"></div>}
            >
              <Show
                when={rooms.error}
                fallback={
                  <Show
                    when={(realtimeRooms()?.length || 0) > 0}
                    fallback={<p class="text-base-content/60">No active rooms</p>}
                  >
                    <div class="space-y-2">
                      <For each={realtimeRooms()}>
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
                }
              >
                <div class="alert alert-error">
                  <span>Failed to load rooms</span>
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
