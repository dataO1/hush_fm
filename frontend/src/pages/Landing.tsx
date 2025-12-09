import { createSignal, createResource, For, Show, onMount, onCleanup } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { Effect } from 'effect'
import { listRooms, createRoom } from '../effects/api'
import { useSignaling, useRooms } from '../providers/AppProviders'
import type { RoomInfo } from '../generated/api.schemas'

export default function Landing() {
  const navigate = useNavigate()
  const signaling = useSignaling()
  const [roomName, setRoomName] = createSignal('')
  const [creating, setCreating] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  // Use createResource for async room loading with Effect
  const [rooms] = createResource(async () => {
    return await Effect.runPromise(
      listRooms().pipe(
        Effect.tap((result: RoomInfo[]) => 
          Effect.sync(() => {
            // Update signaling store with rooms (now using clean RoomInfo models)
            signaling.setState({ rooms: result })
          })
        ),
        Effect.catchAll((error) => 
          Effect.sync(() => {
            setError(`Failed to load rooms: ${error}`)
            throw error
          })
        )
      )
    )
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
      const result = yield* _(createRoom({ 
        name: roomName().trim(),
        djName: `DJ ${Date.now()}`  // Generate a simple DJ name
      }))
      return result
    })

    try {
      const result = await Effect.runPromise(program)
      navigate(`/dj/${result.room.id}`)
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
                                {room.listenerCount} listeners
                              </div>
                            </div>
                            <div class="flex items-center gap-2">
                              {room.isStreaming && (
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
