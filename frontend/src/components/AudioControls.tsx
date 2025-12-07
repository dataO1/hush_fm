import { createSignal, createEffect, Show, For } from 'solid-js'
import { Effect } from 'effect'
import { toggleProducerFlow } from '../effects/webrtc-flows'
import { useWebRTC, webrtcStore } from '../webrtc/store'
import { consumerManager } from '../webrtc/consumer-manager'

/**
 * Audio Controls Component
 * Provides play/pause controls and volume management
 */
export function AudioControls() {
  const [volume, setVolume] = createSignal(1.0)
  const [isMuted, setIsMuted] = createSignal(false)
  const [audioLevel, setAudioLevel] = createSignal(0)
  const [isOperating, setIsOperating] = createSignal(false)

  const { isStreaming, connectionState } = useWebRTC()

  // Get active producer and consumers from store
  const activeProducers = () => Array.from(webrtcStore.producers.values())
  const activeConsumers = () => Array.from(webrtcStore.consumers.values())

  // Handle producer pause/resume
  const handleToggleProducer = async (producerId: string, currentlyPaused: boolean) => {
    setIsOperating(true)
    
    const effect = toggleProducerFlow(producerId, !currentlyPaused)
    
    Effect.runPromise(effect)
      .catch((error) => {
        console.error('Failed to toggle producer:', error)
      })
      .finally(() => {
        setIsOperating(false)
      })
  }

  // Handle consumer volume change
  const handleVolumeChange = async (consumerId: string, newVolume: number) => {
    const effect = consumerManager.setVolume(consumerId, newVolume)
    
    Effect.runPromise(effect)
      .catch((error) => {
        console.error('Failed to set volume:', error)
      })
  }

  // Handle consumer mute/unmute
  const handleToggleMute = async (consumerId: string, currentlyMuted: boolean) => {
    const effect = consumerManager.setMuted(consumerId, !currentlyMuted)
    
    Effect.runPromise(effect)
      .catch((error) => {
        console.error('Failed to toggle mute:', error)
      })
  }

  // Audio level monitoring (placeholder for future implementation)
  createEffect(() => {
    if (!isStreaming()) return

    const interval = setInterval(() => {
      // This would integrate with actual audio analysis
      // For now, simulate audio levels
      setAudioLevel(Math.random() * 100)
    }, 100)

    return () => clearInterval(interval)
  })

  // Update volume for all consumers when global volume changes
  createEffect(() => {
    const newVolume = volume()
    activeConsumers().forEach(consumer => {
      if (consumer.consumer) {
        handleVolumeChange(consumer.id, newVolume)
      }
    })
  })

  return (
    <div class="bg-white rounded-lg shadow-lg p-6 w-full max-w-md">
      <h2 class="text-lg font-semibold mb-4 text-gray-800">
        Audio Controls
      </h2>

      {/* Producer Controls (for DJ/streamer) */}
      <Show when={activeProducers().length > 0}>
        <div class="mb-6">
          <h3 class="text-md font-medium mb-2 text-gray-700">
            Your Stream
          </h3>
          <For each={activeProducers()}>
            {(producer) => (
              <div class="flex items-center justify-between p-3 bg-blue-50 rounded-lg mb-2">
                <div class="flex items-center space-x-3">
                  <div class="text-blue-600 font-medium">
                    🎙️ {producer.kind === 'audio' ? 'Audio' : 'Video'}
                  </div>
                  <Show when={connectionState() === 'connected'}>
                    <div class="flex items-center space-x-1">
                      <div class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                      <span class="text-xs text-green-600">Live</span>
                    </div>
                  </Show>
                </div>
                <button
                  onClick={() => handleToggleProducer(producer.id, producer.paused)}
                  disabled={isOperating()}
                  class={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                    producer.paused 
                      ? 'bg-green-500 text-white hover:bg-green-600' 
                      : 'bg-red-500 text-white hover:bg-red-600'
                  } disabled:bg-gray-400`}
                >
                  {producer.paused ? '▶️ Resume' : '⏸️ Pause'}
                </button>
              </div>
            )}
          </For>
          
          {/* Audio Level Indicator */}
          <Show when={isStreaming()}>
            <div class="mt-2">
              <div class="text-xs text-gray-600 mb-1">Audio Level</div>
              <div class="w-full bg-gray-200 rounded-full h-2">
                <div 
                  class={`h-2 rounded-full transition-all duration-100 ${
                    audioLevel() > 80 ? 'bg-red-500' :
                    audioLevel() > 50 ? 'bg-yellow-500' : 'bg-green-500'
                  }`}
                  style={{ width: `${audioLevel()}%` }}
                ></div>
              </div>
            </div>
          </Show>
        </div>
      </Show>

      {/* Consumer Controls (for listeners) */}
      <Show when={activeConsumers().length > 0}>
        <div class="mb-4">
          <h3 class="text-md font-medium mb-2 text-gray-700">
            Listening To
          </h3>
          
          {/* Global Volume Control */}
          <div class="mb-3">
            <div class="flex items-center justify-between mb-1">
              <label class="text-sm text-gray-600">Volume</label>
              <span class="text-sm text-gray-600">{Math.round(volume() * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume()}
              onInput={(e) => setVolume(parseFloat(e.target.value))}
              class="w-full"
            />
          </div>

          {/* Global Mute */}
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm text-gray-600">Mute All</span>
            <button
              onClick={() => {
                const newMuted = !isMuted()
                setIsMuted(newMuted)
                activeConsumers().forEach(consumer => {
                  handleToggleMute(consumer.id, !newMuted)
                })
              }}
              class={`px-3 py-1 rounded text-sm ${
                isMuted() 
                  ? 'bg-red-500 text-white' 
                  : 'bg-gray-200 text-gray-700'
              }`}
            >
              {isMuted() ? '🔇 Muted' : '🔊 Unmuted'}
            </button>
          </div>

          {/* Individual Consumer Controls */}
          <For each={activeConsumers()}>
            {(consumer) => (
              <div class="flex items-center justify-between p-2 bg-green-50 rounded-lg mb-2">
                <div class="flex items-center space-x-2">
                  <span class="text-green-600">🎧</span>
                  <span class="text-sm text-gray-700">
                    Stream {consumer.kind}
                  </span>
                </div>
                <div class="flex items-center space-x-2">
                  <Show when={consumer.paused}>
                    <span class="text-xs text-red-600">Paused</span>
                  </Show>
                  <Show when={connectionState() === 'connected' && !consumer.paused}>
                    <div class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* Connection Status */}
      <div class="border-t pt-4">
        <div class="flex items-center justify-between text-sm">
          <span class="text-gray-600">Status:</span>
          <span class={`font-medium ${
            connectionState() === 'connected' ? 'text-green-600' :
            connectionState() === 'connecting' ? 'text-yellow-600' :
            connectionState() === 'failed' ? 'text-red-600' : 'text-gray-600'
          }`}>
            {connectionState().charAt(0).toUpperCase() + connectionState().slice(1)}
          </span>
        </div>
        
        <Show when={activeProducers().length === 0 && activeConsumers().length === 0}>
          <div class="text-center text-gray-500 text-sm mt-2">
            No active audio streams
          </div>
        </Show>
      </div>
    </div>
  )
}