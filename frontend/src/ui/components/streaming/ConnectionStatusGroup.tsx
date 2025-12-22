/**
 * ConnectionStatusGroup Component
 * 
 * Application-specific component for displaying streaming connection status
 * with both visual indicator (dot) and text label. Combines ConnectionStatusDot
 * with status text in configurable layouts.
 */

import type { JSX } from 'solid-js'
import ConnectionStatusDot from '../ConnectionStatusDot'

interface ConnectionStatusGroupProps {
  /** Reactive getter for connection status */
  status: () => string
  /** Reactive getter for status text */
  statusText: () => string
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
        connectionState={props.status() as any}
        size={dotSize()}
        title={props.statusText()}
      />
      <span class={textClass()}>
        {props.statusText()}
      </span>
    </div>
  )
}