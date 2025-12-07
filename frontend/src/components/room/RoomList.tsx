import { createSignal, For, Show, createEffect, createMemo } from 'solid-js'
import { Effect } from 'effect'
import { joinRoomFlow } from '../../effects/webrtc-flows'
import { useWebRTC } from '../../webrtc/store'
import { getLiveRooms, subscribeToRoom, unsubscribeFromRoom, initializeLobbySignaling } from '../../ws/event-handlers'

/**
 * Room data is now handled by WebSocket event system
 * No need for local type definition as it comes from event-handlers
 */

/**
 * Room List Component
 * Shows live rooms with instant join capability
 */
export function RoomList() {
  const [selectedRoom, setSelectedRoom] = createSignal<string | null>(null)
  const [joinError, setJoinError] = createSignal<string | null>(null)
  const [isJoining, setIsJoining] = createSignal(false)

  const { connectionState } = useWebRTC()

  // Reactive rooms from WebSocket events
  const rooms = createMemo(() => getLiveRooms())
  const [isConnectedToLobby, setIsConnectedToLobby] = createSignal(false)

  // Initialize lobby signaling on mount
  createEffect(() => {
    if (!isConnectedToLobby()) {
      Effect.runPromise(initializeLobbySignaling())
        .then(() => setIsConnectedToLobby(true))
        .catch(error => {
          console.error('Failed to initialize lobby signaling:', error)
          setJoinError('Failed to connect to lobby')
        })
    }
  })

  // Handle joining a room
  const handleJoinRoom = async (roomId: string) => {
    setIsJoining(true)
    setJoinError(null)
    setSelectedRoom(roomId)

    const effect = joinRoomFlow(roomId)
    
    Effect.runPromise(effect)
      .then(() => {
        setIsJoining(false)
        // Subscribe to room events for real-time updates
        return Effect.runPromise(subscribeToRoom(roomId))
      })
      .catch((error) => {
        setJoinError(error.message || 'Failed to join room')
        setIsJoining(false)
        setSelectedRoom(null)
      })
  }

  // Stop listening and disconnect
  const handleLeaveRoom = () => {
    const roomId = selectedRoom()
    if (roomId) {
      Effect.runPromise(unsubscribeFromRoom(roomId))
        .catch(error => console.error('Failed to unsubscribe from room:', error))
    }
    setSelectedRoom(null)
    // Cleanup will be handled by the leave flow
  }

  return (
    <div class="bg-white rounded-lg shadow-lg p-6 w-full max-w-2xl">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-semibold text-gray-800">
          Live Rooms
        </h2>
        <button
          onClick={() => {
            setIsConnectedToLobby(false) // Force reconnection
          }}
          disabled={!isConnectedToLobby()}
          class="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded transition-colors disabled:bg-gray-50"
        >
          {!isConnectedToLobby() ? '🔄' : '↻'} {!isConnectedToLobby() ? 'Connecting...' : 'Reconnect'}
        </button>
      </div>

      <Show
        when={selectedRoom()}
        fallback={
          <div class="space-y-3">
            <Show
              when={isConnectedToLobby() && rooms().length > 0}
              fallback={
                <div class="text-center py-8 text-gray-500">
                  <Show 
                    when={isConnectedToLobby()}
                    fallback={
                      <div class="flex items-center justify-center">
                        <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
                        <span class="ml-2">Connecting to lobby...</span>
                      </div>
                    }
                  >
                    No live rooms available
                  </Show>
                </div>
              }
            >
              <For each={rooms()}>
                {(room) => (
                  <div class="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors">
                    <div class="flex items-center justify-between">
                      <div class="flex-1">
                        <h3 class="font-medium text-gray-800 mb-1">
                          {room.name}
                        </h3>
                        <div class="flex items-center space-x-4 text-sm text-gray-600">
                          <span class="flex items-center">
                            <span class="w-2 h-2 bg-green-500 rounded-full mr-1"></span>
                            Live
                          </span>
                          <span>
                            👥 {room.listener_count} listening
                          </span>
                          <span>
                            🕐 {new Date(room.created_at).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleJoinRoom(room.id)}
                        disabled={isJoining() && selectedRoom() === room.id}
                        class="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center"
                      >
                        <Show 
                          when={!(isJoining() && selectedRoom() === room.id)}
                          fallback={
                            <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                          }
                        >
                          🎧
                        </Show>
                        <span class="ml-1">
                          {isJoining() && selectedRoom() === room.id ? 'Joining...' : 'Listen'}
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </Show>

            <Show when={joinError()}>
              <div class="text-red-600 text-sm bg-red-50 p-3 rounded">
                {joinError()}
              </div>
            </Show>
          </div>
        }
      >
        {/* Currently listening to a room */}
        <div class="text-center">
          <div class="bg-green-50 border border-green-200 rounded-lg p-6">
            <div class="text-green-800 font-medium mb-2">
              🎵 Now Listening
            </div>
            <div class="text-lg font-semibold mb-2">
              {rooms()?.find((r: any) => r.id === selectedRoom())?.name || 'Unknown Room'}
            </div>
            <div class="text-sm text-gray-600 mb-4">
              Connection: {connectionState()}
            </div>
            <div class="flex justify-center space-x-4">
              <button
                onClick={handleLeaveRoom}
                class="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
              >
                Leave Room
              </button>
              <button
                onClick={() => setIsConnectedToLobby(false)}
                class="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
              >
                Reconnect
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}