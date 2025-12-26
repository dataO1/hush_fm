/**
 * Connection Status Dot Component
 * 
 * A reusable component that shows connection status as a colored, pulsing dot.
 * Pure component that only uses props - no direct store access.
 * 
 * Colors:
 * - Green (pulsing): Streaming/Active
 * - Blue (pulsing): Connecting/Setup
 * - Yellow (solid): Paused/Muted
 * - Red (pulsing): Error/Disconnected
 */

import { createMemo } from 'solid-js'
import { WebrtcConnectionState } from '../../domain/schemas/connection.schema'

interface ConnectionStatusDotProps {
  /** Reactive getter for WebRTC connection state */
  webrtcState: () => WebrtcConnectionState
  /** Reactive getter for audio pause state */
  isPaused?: () => boolean
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
  /** Optional tooltip text override */
  title?: string
}

export default function ConnectionStatusDot(props: ConnectionStatusDotProps) {
  // Map WebRTC connection state to visual status
  const status = createMemo(() => {
    const webrtcState = props.webrtcState()
    const paused = props.isPaused?.() ?? false
    
    // Handle combined audio pause + streaming state
    if (webrtcState === WebrtcConnectionState.STREAMING && paused) {
      return 'paused'
    }
    
    // Map WebRTC states to visual states
    switch (webrtcState) {
      case WebrtcConnectionState.STREAMING:
        return 'streaming'
      case WebrtcConnectionState.CONNECTED:
        return 'setup'
      case WebrtcConnectionState.CONNECTING:
      case WebrtcConnectionState.DISCONNECTING:
        return 'connecting'
      case WebrtcConnectionState.PAUSED:
        return 'paused'
      case WebrtcConnectionState.ERROR:
        return 'error'
      case WebrtcConnectionState.DISCONNECTED:
      default:
        return 'disconnected'
    }
  })
  
  // Get status text for accessibility
  const statusText = createMemo(() => {
    const webrtcState = props.webrtcState()
    const paused = props.isPaused?.() ?? false
    
    if (webrtcState === WebrtcConnectionState.STREAMING && paused) {
      return 'MUTED'
    }
    if (webrtcState === WebrtcConnectionState.STREAMING) {
      return 'STREAMING'
    }
    if (webrtcState === WebrtcConnectionState.CONNECTED || webrtcState === WebrtcConnectionState.CONNECTING) {
      return 'SETUP'
    }
    
    return webrtcState || 'DISCONNECTED'
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
      case 'streaming':
        return 'bg-green-500 animate-pulse'
      case 'connecting':
      case 'setup':
        return 'bg-blue-500 animate-pulse'
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
    <div 
      class={`rounded-full ${sizeClasses()} ${statusClasses()}`}
      title={props.title || `Connection Status: ${statusText()}`}
      role="status"
      aria-label={`Connection Status: ${statusText()}`}
    />
  )
}