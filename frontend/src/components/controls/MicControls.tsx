import { createSignal, Show } from 'solid-js'

interface MicControlsProps {
  isMuted: boolean
  isStreaming: boolean
  onToggleMute: () => void
  onEndStream?: () => void
  disabled?: boolean
}

export function MicControls(props: MicControlsProps) {
  const [isToggling, setIsToggling] = createSignal(false)

  const handleToggleMute = async () => {
    setIsToggling(true)
    try {
      await props.onToggleMute()
    } finally {
      setIsToggling(false)
    }
  }

  return (
    <div class="flex items-center justify-center gap-4">
      {/* Main Mute/Unmute Button */}
      <button
        onClick={handleToggleMute}
        disabled={props.disabled || isToggling() || !props.isStreaming}
        class={`
          w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold transition-all duration-200 transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50
          ${props.isMuted 
            ? 'bg-red-500 hover:bg-red-600 text-white shadow-lg' 
            : 'bg-green-500 hover:bg-green-600 text-white shadow-lg'
          }
        `}
        title={props.isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
      >
        <Show when={isToggling()}>
          <div class="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
        </Show>
        <Show when={!isToggling()}>
          <span>{props.isMuted ? '🔇' : '🎤'}</span>
        </Show>
      </button>

      {/* End Stream Button */}
      <Show when={props.onEndStream}>
        <button
          onClick={props.onEndStream}
          disabled={props.disabled}
          class="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="End Stream"
        >
          End Stream
        </button>
      </Show>
    </div>
  )
}