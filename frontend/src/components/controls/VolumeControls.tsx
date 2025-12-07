import { createSignal, Show } from 'solid-js'

interface VolumeControlsProps {
  volume: number
  isMuted: boolean
  onVolumeChange: (volume: number) => void
  onToggleMute: () => void
  disabled?: boolean
}

export function VolumeControls(props: VolumeControlsProps) {
  const [isAdjusting, setIsAdjusting] = createSignal(false)

  const handleVolumeChange = (event: Event) => {
    const target = event.target as HTMLInputElement
    const newVolume = parseFloat(target.value)
    props.onVolumeChange(newVolume)
  }

  const handleMuteToggle = () => {
    setIsAdjusting(true)
    try {
      props.onToggleMute()
    } finally {
      setTimeout(() => setIsAdjusting(false), 200)
    }
  }

  return (
    <div class="flex items-center gap-4">
      {/* Mute/Unmute Button */}
      <button
        onClick={handleMuteToggle}
        disabled={props.disabled || isAdjusting()}
        class={`
          w-12 h-12 rounded-full flex items-center justify-center text-xl transition-all duration-200 hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50
          ${props.isMuted 
            ? 'bg-red-100 hover:bg-red-200 text-red-600' 
            : 'bg-blue-100 hover:bg-blue-200 text-blue-600'
          }
        `}
        title={props.isMuted ? 'Unmute Audio' : 'Mute Audio'}
      >
        <Show when={isAdjusting()}>
          <div class="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
        </Show>
        <Show when={!isAdjusting()}>
          <span>
            {props.isMuted ? '🔇' : 
             props.volume === 0 ? '🔈' :
             props.volume < 0.5 ? '🔉' :
             '🔊'}
          </span>
        </Show>
      </button>

      {/* Volume Slider */}
      <div class="flex-1 flex items-center gap-3">
        <span class="text-sm text-gray-600 font-medium min-w-[60px]">Volume:</span>
        <div class="flex-1 relative">
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={props.volume}
            onInput={handleVolumeChange}
            disabled={props.disabled}
            class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${props.volume * 100}%, #e5e7eb ${props.volume * 100}%, #e5e7eb 100%)`
            }}
          />
        </div>
        <span class="text-xs text-gray-500 w-8 text-right">
          {Math.round(props.volume * 100)}%
        </span>
      </div>
    </div>
  )
}