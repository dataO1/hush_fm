/**
 * RoomCard Component
 * 
 * Application-specific component for displaying available room information
 * in the lobby with join functionality. Encapsulates complex room metadata
 * display and streaming status visualization.
 */

import { Show } from 'solid-js'
import type { JSX } from 'solid-js'
import ConnectionStatusDot from '../ConnectionStatusDot'
import type { LobbyRoomInfoType } from '../../../domain/schemas/lobby.schema'

interface RoomCardProps {
  /** Room information */
  room: LobbyRoomInfoType
  /** Join room action handler */
  onJoin: (roomId: string, room: LobbyRoomInfoType) => void
  /** Additional CSS classes */
  class?: string
}

export function RoomCard(props: RoomCardProps): JSX.Element {
  const handleJoinClick = () => {
    props.onJoin(props.room.id, props.room)
  }

  return (
    <div class={`rounded-lg p-3 sm:p-4 transition-colors bg-white/5 border border-white/10 hover:border-white/20 ${props.class || ''}`}>
      <div class="flex justify-between items-start mb-2 sm:mb-3">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            {/* Show live indicator for public rooms with listeners */}
            <Show when={props.room.isPublic && props.room.listenerCount > 0}>
              <ConnectionStatusDot 
                size="sm" 
                connectionState="streaming" 
                title="Live Stream" 
              />
            </Show>
            <h3 class="font-bold text-base sm:text-lg truncate">
              {props.room.name}
            </h3>
          </div>
          <p class="text-gray-300 text-sm truncate">
            DJ: {props.room.djName}
          </p>
        </div>
        <div class="text-right ml-2 shrink-0">
          <div class="text-xs sm:text-sm text-gray-400">
            {props.room.listenerCount || 0} listeners
          </div>
        </div>
      </div>
      
      <Show when={props.room.description}>
        <p class="text-gray-400 text-sm mb-3">
          {props.room.description}
        </p>
      </Show>
      
      <button
        onClick={handleJoinClick}
        class="w-full font-medium py-2 px-3 sm:px-4 rounded transition-colors text-sm sm:text-base bg-green-500 hover:bg-green-600 text-white"
      >
        Join Room
      </button>
    </div>
  )
}