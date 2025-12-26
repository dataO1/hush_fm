/**
 * User Interaction Modal Component
 * 
 * Modal that appears when browser requires user interaction for audio playback.
 * Shows when listener joins a room and browser blocks autoplay.
 */

import { Show } from 'solid-js'
import type { JSX } from 'solid-js'

interface UserInteractionModalProps {
  /** Whether the modal should be shown - comes from audio adapter */
  requiresUserInteraction: boolean
  /** Callback when user clicks to enable audio */
  onEnableAudio: () => void | Promise<void>
  /** Optional callback when user cancels */
  onCancel?: () => void
  /** Room name to show in modal */
  roomName?: string
}

export function UserInteractionModal(props: UserInteractionModalProps): JSX.Element {
  const handleEnableAudio = async () => {
    try {
      await props.onEnableAudio()
    } catch (error) {
      console.error('Failed to enable audio:', error)
    }
  }

  const handleCancel = () => {
    props.onCancel?.()
  }

  return (
    <Show when={props.requiresUserInteraction}>
      <div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div class="bg-white/10 backdrop-blur-md border border-white/20 text-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
          
          {/* Icon */}
          <div class="text-center mb-6">
            <div class="w-16 h-16 mx-auto bg-gradient-to-br from-pink-500 to-violet-500 rounded-full flex items-center justify-center mb-4">
              <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 14.142M8.464 8.464a5 5 0 000 7.072m-2.828-9.9a9 9 0 000 14.142" />
              </svg>
            </div>
            <h3 class="text-xl font-bold mb-2">Enable Audio Playback</h3>
            <p class="text-sm text-white/70 leading-relaxed">
              Your browser requires user interaction to play audio.
              {props.roomName && (
                <span class="block mt-1 font-medium">
                  Ready to join "{props.roomName}"?
                </span>
              )}
            </p>
          </div>

          {/* Buttons */}
          <div class="flex flex-col gap-3">
            <button
              onClick={handleEnableAudio}
              class="btn bg-gradient-to-r from-pink-500 to-violet-500 hover:from-pink-600 hover:to-violet-600 border-0 text-white font-medium w-full py-3 rounded-lg"
            >
              <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h2m4 0h2M7 7h10a2 2 0 012 2v8a2 2 0 01-2 2H7a2 2 0 01-2-2V9a2 2 0 012-2z" />
              </svg>
              Start Listening
            </button>
            
            <Show when={props.onCancel}>
              <button
                onClick={handleCancel}
                class="btn bg-white/10 hover:bg-white/20 border border-white/20 text-white w-full py-3 rounded-lg"
              >
                Cancel
              </button>
            </Show>
          </div>
          
        </div>
      </div>
    </Show>
  )
}