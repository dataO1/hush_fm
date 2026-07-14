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
import { ListenerCountBadge } from '../shared/ListenerCountBadge'
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
  /** Whether a join for this card is currently in progress (loading state) */
  isJoining?: boolean
  /** Additional CSS classes */
  class?: string
}

export function RoomCard(props: RoomCardProps): JSX.Element {
  const handleCardClick = () => {
    // Guard against double-taps while a join is already resolving (X4)
    if (props.isJoining) return
    props.onJoin(props.room.id, props.room)
  }

  // Apply highlighting based on room status
  const getCardClasses = () => {
    let baseClasses = "relative p-3 sm:p-4 transition-colors cursor-pointer"

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

    if (props.isJoining) {
      baseClasses += " opacity-60 pointer-events-none cursor-wait"
    }

    if (props.class) {
      baseClasses += ` ${props.class}`
    }

    return baseClasses
  }

  // State affordance for the DJ's own room / the room you're already listening
  // in. The plain "Join" prompt was removed — tapping any card joins it, so
  // spelling that out is redundant; only these two STATE cues remain (null for a
  // normal room → no affordance row).
  const affordanceLabel = () => {
    if (props.isDJRoom) return "You're DJ here — Resume"
    if (props.isActiveListenerRoom) return '● Listening — Return'
    return null
  }

  const affordanceClasses = () => {
    if (props.isDJRoom) return 'text-gruvbox-orange-bright'
    if (props.isActiveListenerRoom) return 'text-gruvbox-green-bright'
    return 'text-gruvbox-fg-2'
  }

  // A public room that exists but is not currently streaming is paused (L5).
  const isPaused = () => props.room.isPublic && !props.room.isStreaming

  return (
    <div
      class={getCardClasses()}
      onClick={handleCardClick}
    >
      {/* Join loading overlay (X4) — blocks double-taps and gives feedback */}
      <Show when={props.isJoining}>
        <div class="absolute inset-0 flex items-center justify-center bg-hush-main/50 rounded-lg z-10">
          <span class="loading loading-spinner loading-md text-gruvbox-fg-1"></span>
        </div>
      </Show>

      <div class="flex justify-between items-start mb-2 sm:mb-3">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            {/* Show status dot for any public room, even at 0 listeners, so an
                empty-but-live room is still discoverable (L5). */}
            <Show when={props.room.isPublic}>
              <ConnectionStatusDot
                size="sm"
                webrtcState={() => props.room.isStreaming ? WebrtcConnectionState.STREAMING : WebrtcConnectionState.PAUSED}
                title={props.room.isStreaming ? "Live Stream" : "Paused"}
              />
            </Show>
            <h3 class="font-bold text-base sm:text-lg truncate">
              {props.room.name}
            </h3>
            {/* Paused text badge — legible without relying on the dot colour (L5) */}
            <Show when={isPaused()}>
              <span class="text-xs px-2 py-0.5 rounded-sm bg-gruvbox-yellow/20 text-gruvbox-yellow-bright font-medium shrink-0">
                Paused
              </span>
            </Show>
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
        {/* Listener count — same minimal people-glyph + number as the in-room
            ListenerCountBadge, rendered inline in the card header for consistency. */}
        <div class="ml-2 shrink-0">
          <ListenerCountBadge count={() => props.room.listenerCount || 0} inline />
        </div>
      </div>

      {/* State affordance (DJ's own room / currently listening). Omitted for a
          normal room — tapping the card to join is self-explanatory. */}
      <Show when={affordanceLabel()}>
        <div class={`text-sm font-semibold ${affordanceClasses()}`}>
          {affordanceLabel()}
        </div>
      </Show>
    </div>
  )
}
