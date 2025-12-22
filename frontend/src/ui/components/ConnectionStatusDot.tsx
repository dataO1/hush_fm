/**
 * Connection Status Dot Component
 * 
 * A reusable component that shows connection status as a colored, pulsing dot.
 * Uses stores for state knowledge and is read-only.
 * 
 * Colors:
 * - Green (pulsing): Connected/Active
 * - Blue (pulsing): Connecting/Setup
 * - Yellow (solid): Muted/Paused
 * - Red (pulsing): Error/Disconnected
 */

import { createMemo, Show } from 'solid-js'
import { useLobbyStore } from '../../stores/store-contexts'

interface ConnectionStatusDotProps {
  /** Optional override for connection state (for DJ/Listener specific states) */
  connectionState?: 'connected' | 'connecting' | 'muted' | 'error' | 'disconnected' | 'streaming' | 'paused' | 'setup'
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
  /** Optional tooltip text */
  title?: string
}

export default function ConnectionStatusDot(props: ConnectionStatusDotProps) {
  // SolidJS 2025: Use store context instead of creating new instance
  const lobbyStore = useLobbyStore()
  
  // SolidJS 2025: Determine status with proper Option handling
  const status = createMemo(() => {
    if (props.connectionState) {
      return props.connectionState
    }
    
    // Default to lobby connection state
    const connectionState = lobbyStore.state.connection.state
    const hasConnectionError = lobbyStore.connectionError() !== null
    
    if (hasConnectionError) {
      return 'error'
    }
    
    switch (connectionState) {
      case 'connected':
        return 'connected'
      case 'connecting':
      case 'reconnecting':
        return 'connecting'
      case 'error':
        return 'error'
      case 'disconnected':
      default:
        return 'disconnected'
    }
  })
  
  // Size classes
  const sizeClasses = createMemo(() => {
    switch (props.size || 'md') {
      case 'sm':
        return 'w-2 h-2'
      case 'lg':
        return 'w-4 h-4'
      case 'md':
      default:
        return 'w-3 h-3'
    }
  })
  
  // Status-specific classes
  const statusClasses = createMemo(() => {
    switch (status()) {
      case 'connected':
      case 'streaming':
        return 'bg-green-500 animate-pulse'
      case 'connecting':
      case 'setup':
        return 'bg-blue-500 animate-pulse'
      case 'muted':
      case 'paused':
        return 'bg-yellow-500'
      case 'error':
        return 'bg-red-500 animate-pulse'
      case 'disconnected':
      default:
        return 'bg-red-500 animate-pulse'
    }
  })
  
  // SolidJS 2025: Use Show for conditional rendering and better accessibility
  return (
    <Show 
      when={status()}
      fallback={
        <div 
          class={`rounded-full ${sizeClasses()} bg-gray-500`}
          title="Status Unknown"
        />
      }
    >
      {(currentStatus) => (
        <div 
          class={`rounded-full ${sizeClasses()} ${statusClasses()}`}
          title={props.title || `Connection Status: ${currentStatus().toUpperCase()}`}
          role="status"
          aria-label={`Connection Status: ${currentStatus().toUpperCase()}`}
        />
      )}
    </Show>
  )
}