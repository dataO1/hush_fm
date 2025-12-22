/**
 * StreamError Component
 * 
 * Application-specific component for displaying streaming-related errors
 * with dismiss functionality. Supports both inline and floating variants
 * for different UI contexts (DJ vs Listener rooms).
 */

import { Show } from 'solid-js'
import type { JSX } from 'solid-js'

interface StreamErrorProps {
  /** Reactive getter for error message (null when no error) */
  error: () => string | null
  /** Error dismiss handler */
  onDismiss: () => void
  /** Error display variant */
  variant?: 'inline' | 'floating'
  /** Additional CSS classes */
  class?: string
}

export function StreamError(props: StreamErrorProps): JSX.Element {
  const variant = () => props.variant || 'inline'
  
  const alertClass = () => {
    const base = 'alert alert-error text-sm sm:text-base'
    const variantClass = variant() === 'floating' 
      ? 'fixed top-4 right-4 left-4 sm:left-auto sm:w-auto shadow-lg z-50'
      : 'mb-4'
    return `${base} ${variantClass} ${props.class || ''}`
  }
  
  const buttonClass = () => {
    return variant() === 'floating' 
      ? 'btn btn-sm btn-circle btn-ghost'
      : 'btn btn-sm btn-circle'
  }

  return (
    <Show when={props.error()} fallback={null}>
      {(error) => (
        <div class={alertClass()}>
          <span>{error()}</span>
          <button 
            class={buttonClass()} 
            onClick={props.onDismiss}
          >
            ✕
          </button>
        </div>
      )}
    </Show>
  )
}