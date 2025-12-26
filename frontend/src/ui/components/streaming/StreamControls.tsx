/**
 * StreamControls Component
 * 
 * Stateless component for DJ streaming controls when WebRTC is connected.
 * Provides mute/unmute and end stream functionality.
 */

import { Show } from 'solid-js'
import type { JSX } from 'solid-js'

interface StreamControlsProps {
  /** Method to toggle mute state */
  toggleMute: () => Promise<void>
  /** Method to end stream */
  endStream: () => Promise<void>
  /** Reactive getter for paused/muted state */
  isPaused: () => boolean
  /** Additional CSS classes */
  class?: string
}

export function StreamControls(props: StreamControlsProps): JSX.Element {

  return (
    <div class={`flex flex-col sm:flex-row gap-3 justify-center items-center mt-6 ${props.class || ''}`}>
      
      {/* Mute/Unmute Button */}
      <button
        class={`btn btn-md sm:btn-lg gap-2 w-full sm:w-auto sm:min-w-32 ${
          props.isPaused() ? 'btn-warning hover:btn-warning' : 'btn-success hover:btn-success'
        }`}
        onClick={() => props.toggleMute()}
      >
        <Show 
          when={props.isPaused()}
          fallback={
            <>
              <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              <span class="text-sm sm:text-base">Mute</span>
            </>
          }
        >
          <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
          </svg>
          <span class="text-sm sm:text-base">Unmute</span>
        </Show>
      </button>

      {/* End Stream Button */}
      <button 
        class="btn btn-outline btn-error btn-md sm:btn-lg gap-2 w-full sm:w-auto border-gruvbox-red-bright text-gruvbox-red-bright hover:bg-gruvbox-red-bright hover:text-gruvbox-bg-hard" 
        onClick={() => props.endStream()}
      >
        <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
        <span class="text-sm sm:text-base">End Stream</span>
      </button>
      
    </div>
  )
}