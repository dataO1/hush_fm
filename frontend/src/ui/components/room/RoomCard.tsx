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
import { Option } from 'effect'
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
  const handleJoinClick = () => {
    props.onJoin(props.room.id, props.room)
  }

  // Apply highlighting based on room status
  const getCardClasses = () => {
    let baseClasses = "rounded-lg p-3 sm:p-4 transition-colors"
    
    if (props.isDJRoom) {
      // DJ's own room - blue highlight
      baseClasses += " bg-blue-500/20 border-blue-500/50 hover:border-blue-500/70"
    } else if (props.isActiveListenerRoom) {
      // Currently listening room - green highlight  
      baseClasses += " bg-green-500/20 border-green-500/50 hover:border-green-500/70"
    } else {
      // Default styling
      baseClasses += " bg-white/5 border border-white/10 hover:border-white/20"
    }
    
    if (props.class) {
      baseClasses += ` ${props.class}`
    }
    
    return baseClasses
  }

  return (
    <div class={getCardClasses()}>
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
                <span class="text-xs px-2 py-1 bg-white/10 text-white/80 rounded-full">
                  {tag}
                </span>
              ))}
            </div>
          </Show>
        </div>
        <div class="text-right ml-2 shrink-0">
          <div class="text-xs sm:text-sm text-gray-400">
            {props.room.listenerCount || 0} listeners
          </div>
        </div>
      </div>
      
      <button
        onClick={handleJoinClick}
        class={`w-full font-medium py-2 px-3 sm:px-4 rounded transition-colors text-sm sm:text-base text-white ${
          props.isDJRoom 
            ? "bg-orange-600 hover:bg-orange-700"
            : props.isActiveListenerRoom
            ? "bg-orange-600 hover:bg-orange-700" 
            : "bg-green-500 hover:bg-green-600"
        }`}
      >
        {props.isDJRoom 
          ? "Continue Streaming" 
          : props.isActiveListenerRoom 
          ? "Continue Listening"
          : "Join Room"}
      </button>
    </div>
  )
}