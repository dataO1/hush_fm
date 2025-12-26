/**
 * RoomCard Component
 * 
 * Application-specific component for displaying available room information
 * in the lobby with join functionality. Encapsulates complex room metadata
 * display and streaming status visualization.
 */

import { Show } from 'solid-js'
import type { JSX } from 'solid-js'
import { WebrtcConnectionState } from '../../../domain/schemas/connection.schema'
import ConnectionStatusDot from '../ConnectionStatusDot'
import type { LobbyRoomInfoType } from '../../../domain/schemas/lobby.schema'

interface RoomCardProps {
  /** Room information */
  room: LobbyRoomInfoType
  /** Join room action handler */
  onJoin: (roomId: string, room: LobbyRoomInfoType) => void
  /** Whether this room belongs to the current DJ */
  isDJRoom?: boolean
  /** Whether this is the user's currently active listener room */
  isActiveListenerRoom?: boolean
  /** Additional CSS classes */
  class?: string
}

export function RoomCard(props: RoomCardProps): JSX.Element {
  const handleCardClick = () => {
    props.onJoin(props.room.id, props.room)
  }

  // Apply highlighting based on room status
  const getCardClasses = () => {
    let baseClasses = "p-3 sm:p-4 transition-colors cursor-pointer"
    
    if (props.isDJRoom) {
      // DJ's own room - orange/red highlight with music pulse
      baseClasses += " room-dj"
    } else if (props.isActiveListenerRoom) {
      // Currently listening room - green highlight with music pulse
      baseClasses += " room-listener"
    } else {
      // Default styling
      baseClasses += " room-default"
    }
    
    if (props.class) {
      baseClasses += ` ${props.class}`
    }
    
    return baseClasses
  }

  return (
    <div 
      class={getCardClasses()}
      onClick={handleCardClick}
    >
      <div class="flex justify-between items-start mb-2 sm:mb-3">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            {/* Show live indicator for public rooms with listeners */}
            <Show when={props.room.isPublic && props.room.listenerCount > 0}>
              <ConnectionStatusDot 
                size="sm" 
                webrtcState={() => props.room.isStreaming ? WebrtcConnectionState.STREAMING : WebrtcConnectionState.CONNECTED}
                title={props.room.isStreaming ? "Live Stream" : "Room Available"} 
              />
            </Show>
            <h3 class="font-bold text-base sm:text-lg truncate">
              {props.room.name}
            </h3>
          </div>
          <Show when={props.room.tags && props.room.tags.length > 0}>
            <div class="flex flex-wrap gap-1 mb-2">
              {props.room.tags.map((tag) => (
                <span class="text-xs px-2 py-1 bg-gruvbox-bg-2/60 text-gruvbox-fg-3 rounded-sm">
                  {tag}
                </span>
              ))}
            </div>
          </Show>
        </div>
        <div class="text-right ml-2 shrink-0">
          <div class="text-xs sm:text-sm text-gruvbox-fg-4">
            {props.room.listenerCount || 0} listeners
          </div>
        </div>
      </div>
    </div>
  )
}