/**
 * StreamControls Component
 *
 * Stateless component for DJ streaming controls when WebRTC is connected.
 * Provides mute/unmute and end stream functionality.
 *
 * D2: "Stop" is destructive and irreversible for every listener, so it is
 * gated behind a client-side confirmation modal (mirrors the createRoomModal
 * <dialog class="modal"> pattern in Landing.tsx). endStream() is only invoked
 * on an explicit "End" confirmation — never on the first tap. The confirm
 * dialog lives in local UI signal state; no backend/protocol change.
 *
 * D3: Mute is state-coloured (green = live / tap-to-mute, yellow = currently
 * muted) and Stop is a distinct solid-red destructive style, with extra gap so
 * a drunk thumb in the dark can't confuse the two.
 */

import { Show, createSignal } from 'solid-js'
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
  // D2: client-side confirmation state for the destructive end-room action.
  const [showEndConfirm, setShowEndConfirm] = createSignal(false)
  const [isEnding, setIsEnding] = createSignal(false)

  const openEndConfirm = () => setShowEndConfirm(true)
  const cancelEndConfirm = () => setShowEndConfirm(false)

  const confirmEnd = async () => {
    setIsEnding(true)
    try {
      await props.endStream()
    } finally {
      // Component typically unmounts (navigate to '/') after a successful end,
      // but reset defensively in case it doesn't.
      setIsEnding(false)
      setShowEndConfirm(false)
    }
  }

  // Close the dialog when the backdrop itself is tapped (mobile-friendly),
  // matching Landing.tsx handleModalClick.
  const handleModalClick = (e: Event) => {
    if (e.target && (e.target as HTMLElement).tagName === 'DIALOG') {
      cancelEndConfirm()
    }
  }

  return (
    <div class={`flex flex-col sm:flex-row gap-6 justify-center items-center mt-6 ${props.class || ''}`}>

      {/* Mute/Unmute Button — D3: state-coloured solid fill */}
      <button
        class={`btn btn-md sm:btn-lg gap-2 w-36 sm:w-40 border-0 shadow-none ${
          props.isPaused()
            ? 'bg-gruvbox-yellow-bright hover:bg-gruvbox-yellow text-gruvbox-bg-0'
            : 'bg-gruvbox-green-bright hover:bg-gruvbox-green text-gruvbox-bg-0'
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

      {/* End Stream Button — D3: distinct solid-red destructive style.
          D2: opens the confirmation dialog instead of ending immediately. */}
      <button
        class="btn btn-md sm:btn-lg gap-2 w-36 sm:w-40 border-0 shadow-none bg-gruvbox-red-bright hover:bg-gruvbox-red text-gruvbox-bg-0"
        onClick={openEndConfirm}
      >
        <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
        <span class="text-sm sm:text-base">Stop</span>
      </button>

      {/* D2: End-room confirmation modal (mirrors createRoomModal in Landing.tsx). */}
      <Show when={showEndConfirm()}>
        <dialog class="modal modal-open" onClick={handleModalClick}>
          <div
            class="modal-box max-w-sm modal-glass text-gruvbox-fg p-6 sm:p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 class="font-bold text-xl sm:text-2xl mb-3 text-center text-gruvbox-red-bright">
              End the room for everyone?
            </h3>
            <p class="text-sm sm:text-base text-gruvbox-fg-3 text-center mb-8">
              This stops the stream for all listeners and can't be undone.
            </p>

            <div class="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                type="button"
                class="btn btn-md sm:btn-lg w-full sm:w-40 border-0 shadow-none bg-gruvbox-bg-3 hover:bg-gruvbox-bg-4 text-gruvbox-fg"
                onClick={cancelEndConfirm}
                disabled={isEnding()}
              >
                <span class="text-sm sm:text-base">Cancel</span>
              </button>

              <button
                type="button"
                class="btn btn-md sm:btn-lg w-full sm:w-40 border-0 shadow-none bg-gruvbox-red-bright hover:bg-gruvbox-red text-gruvbox-bg-0 disabled:opacity-50"
                onClick={confirmEnd}
                disabled={isEnding()}
              >
                <Show when={isEnding()} fallback={<span class="text-sm sm:text-base">End</span>}>
                  <>
                    <span class="loading loading-spinner loading-sm"></span>
                    <span class="ml-2 text-sm sm:text-base">Ending…</span>
                  </>
                </Show>
              </button>
            </div>
          </div>
        </dialog>
      </Show>

    </div>
  )
}
