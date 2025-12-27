/**
 * User Interaction Modal Component
 * 
 * Modal that appears when browser requires user interaction for audio playback.
 * Shows when listener joins a room and browser blocks autoplay.
 */

import { createEffect } from 'solid-js'
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
  let dialogRef: HTMLDialogElement | undefined

  const handleEnableAudio = async () => {
    try {
      await props.onEnableAudio()
      dialogRef?.close()
    } catch (error) {
      console.error('Failed to enable audio:', error)
    }
  }

  // Open/close modal based on requiresUserInteraction prop
  createEffect(() => {
    if (props.requiresUserInteraction && dialogRef && !dialogRef.open) {
      dialogRef.showModal()
    } else if (!props.requiresUserInteraction && dialogRef && dialogRef.open) {
      dialogRef.close()
    }
  })

  // Handle background click to close (DaisyUI feature)
  const handleDialogClick = (e: Event) => {
    const target = e.target as HTMLElement
    if (target.tagName === 'DIALOG') {
      props.onCancel?.()
    }
  }

  return (
    <dialog 
      ref={dialogRef}
      class="modal"
      onClick={handleDialogClick}
    >
      <div class="modal-box max-w-sm modal-glass text-gruvbox-fg p-6">
        
        {/* Icon */}
        <div class="text-center mb-6">
          <div class="w-16 h-16 mx-auto bg-gruvbox-yellow-bright rounded-sm flex items-center justify-center mb-4">
            <svg class="w-8 h-8 text-gruvbox-bg-hard" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 14.142M8.464 8.464a5 5 0 000 7.072m-2.828-9.9a9 9 0 000 14.142" />
            </svg>
          </div>
          <h3 class="text-xl font-bold mb-2">Enable Audio Playback</h3>
          <p class="text-sm text-gruvbox-fg-3 leading-relaxed">
            Your browser requires user interaction to play audio.
            {props.roomName && (
              <span class="block mt-1 font-medium">
                Ready to join "{props.roomName}"?
              </span>
            )}
          </p>
        </div>

        {/* Single Button */}
        <div class="flex justify-center">
          <button
            onClick={handleEnableAudio}
            class="btn btn-hush w-full py-3"
          >
            <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h2m4 0h2M7 7h10a2 2 0 012 2v8a2 2 0 01-2 2H7a2 2 0 01-2-2V9a2 2 0 012-2z" />
            </svg>
            Start Listening
          </button>
        </div>
        
      </div>
    </dialog>
  )
}