/**
 * RoomHeader Component
 * 
 * Application-specific component for displaying room identity (name + DJ).
 * Follows SolidJS 2025 best practices with reactive props and flexible styling.
 */

import type { JSX } from 'solid-js'

interface RoomHeaderProps {
  /** Reactive getter for room name */
  roomName: () => string
  /** Layout variant */
  variant?: 'center' | 'left'
  /** Additional CSS classes */
  class?: string
}

export function RoomHeader(props: RoomHeaderProps): JSX.Element {
  const variant = () => props.variant || 'center'
  const textAlignClass = () => variant() === 'center' ? 'text-center' : 'text-left'
  
  return (
    <div class={`${textAlignClass()} ${props.class || ''}`}>
      <h1 class="text-lg sm:text-xl font-semibold text-gruvbox-fg">
        {props.roomName()}
      </h1>
    </div>
  )
}