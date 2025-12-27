/**
 * ConnectionStatusGroup Component
 * 
 * Application-specific component for displaying streaming connection status
 * with both visual indicator (dot) and text label. Combines ConnectionStatusDot
 * with status text in configurable layouts.
 */

import type { JSX } from 'solid-js'
import ConnectionStatusDot from '../ConnectionStatusDot'
import { WebrtcConnectionState } from '../../../domain/schemas/connection.schema'

interface ConnectionStatusGroupProps {
  /** Reactive getter for WebRTC connection state */
  webrtcState: () => WebrtcConnectionState
  /** Reactive getter for audio pause state */
  isPaused?: () => boolean
  /** Connection dot size */
  dotSize?: 'sm' | 'md' | 'lg'
  /** Layout orientation */
  layout?: 'horizontal' | 'vertical'
  /** Additional CSS classes */
  class?: string
}

export function ConnectionStatusGroup(props: ConnectionStatusGroupProps): JSX.Element {
  const dotSize = () => props.dotSize || 'md'
  const layout = () => props.layout || 'horizontal'
  
  // Get status text using the same logic as ConnectionStatusDot
  const statusText = () => {
    const webrtcState = props.webrtcState()
    const paused = props.isPaused?.() ?? false
    
    if (webrtcState === WebrtcConnectionState.STREAMING && paused) {
      return 'MUTED'
    }
    if (webrtcState === WebrtcConnectionState.STREAMING) {
      return 'STREAMING'
    }
    if (webrtcState === WebrtcConnectionState.PAUSED) {
      return 'PAUSED'
    }
    if (webrtcState === WebrtcConnectionState.CONNECTED || webrtcState === WebrtcConnectionState.CONNECTING) {
      return 'SETUP'
    }
    
    return webrtcState || 'DISCONNECTED'
  }
  
  const containerClass = () => {
    const base = layout() === 'horizontal' 
      ? 'flex items-center gap-2' 
      : 'flex flex-col items-center gap-2 sm:gap-3'
    return `${base} ${props.class || ''}`
  }
  
  const textClass = () => {
    // Responsive text sizing based on dot size
    switch (dotSize()) {
      case 'sm':
        return 'text-xs sm:text-sm font-medium'
      case 'lg':
        return 'text-sm sm:text-base font-medium'
      case 'md':
      default:
        return 'text-xs sm:text-sm font-medium'
    }
  }

  return (
    <div class={containerClass()}>
      <ConnectionStatusDot 
        webrtcState={props.webrtcState}
        isPaused={props.isPaused}
        size={dotSize()}
        title={`Connection Status: ${statusText()}`}
      />
      <span class={textClass()}>
        {statusText()}
      </span>
    </div>
  )
}