import { createSignal, Show, createEffect } from 'solid-js'
import { Effect } from 'effect'
import { publishRoomFlow } from '../../effects/webrtc-flows'
import { useWebRTC } from '../../webrtc/store'

/**
 * Create Room Card Component
 * Follows atomic room creation pattern - room only appears when streaming ready
 */
export function CreateRoomCard() {
  const [roomName, setRoomName] = createSignal('')
  const [isCreating, setIsCreating] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [createdRoom, setCreatedRoom] = createSignal<{
    roomId: string
    producerId: string
  } | null>(null)

  const { connectionState, isStreaming } = useWebRTC()

  // Handle room creation with Effect-TS flow
  const handleCreateRoom = async () => {
    if (!roomName().trim()) {
      setError('Room name is required')
      return
    }

    setIsCreating(true)
    setError(null)

    const effect = publishRoomFlow(roomName().trim())
    
    Effect.runPromise(effect)
      .then((result) => {
        setCreatedRoom({
          roomId: result.roomId,
          producerId: result.producerId,
        })
        setIsCreating(false)
        setRoomName('') // Clear form
      })
      .catch((error) => {
        setError(error.message || 'Failed to create room')
        setIsCreating(false)
      })
  }

  // Clear error when room name changes
  createEffect(() => {
    if (roomName()) {
      setError(null)
    }
  })

  return (
    <div class="bg-white rounded-lg shadow-lg p-6 w-full max-w-md">
      <h2 class="text-xl font-semibold mb-4 text-gray-800">
        Create New Room
      </h2>

      <Show
        when={!createdRoom()}
        fallback={
          <div class="text-center">
            <div class="text-green-600 font-medium mb-2">
              🎵 Room Created Successfully!
            </div>
            <div class="text-sm text-gray-600 mb-4">
              Room ID: {createdRoom()?.roomId}
            </div>
            <div class="text-sm text-gray-600 mb-4">
              Status: {isStreaming() ? 'Live' : 'Connecting...'}
            </div>
            <button
              onClick={() => setCreatedRoom(null)}
              class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
            >
              Create Another Room
            </button>
          </div>
        }
      >
        <div class="space-y-4">
          <div>
            <label 
              for="roomName" 
              class="block text-sm font-medium text-gray-700 mb-1"
            >
              Room Name
            </label>
            <input
              id="roomName"
              type="text"
              value={roomName()}
              onInput={(e) => setRoomName(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleCreateRoom()}
              placeholder="Enter room name..."
              class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isCreating()}
            />
          </div>

          <Show when={error()}>
            <div class="text-red-600 text-sm bg-red-50 p-2 rounded">
              {error()}
            </div>
          </Show>

          <button
            onClick={handleCreateRoom}
            disabled={isCreating() || !roomName().trim()}
            class="w-full px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
          >
            <Show 
              when={!isCreating()}
              fallback={
                <>
                  <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Creating...
                </>
              }
            >
              Create Room & Start Streaming
            </Show>
          </button>

          <div class="text-xs text-gray-500 text-center">
            Connection: {connectionState()}
          </div>
        </div>
      </Show>
    </div>
  )
}