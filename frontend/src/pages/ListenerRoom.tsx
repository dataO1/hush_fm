import { createSignal, onMount, onCleanup, Show, createEffect } from 'solid-js'
import { useParams, useNavigate } from '@solidjs/router'
import { Effect } from 'effect'
import { joinRoomFlow } from '../effects/webrtc-flows'
// import { WaveformVisualizer } from '../components/shared/WaveformVisualizer'
import { useWebRTC } from '../providers/WebRTCProvider'
import { useSignaling } from '../providers/SignalingProvider'

export default function ListenerRoom() {
  const params = useParams()
  const navigate = useNavigate()

  // Use new providers instead of local state
  const { state: webrtcState, connectionState } = useWebRTC()
  const { connectToRoom, sendCommand } = useSignaling()

  const [roomId] = createSignal(params.roomId)
  const [volume, setVolume] = createSignal(0.8)
  const [isMuted, setIsMuted] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [isInitializing, setIsInitializing] = createSignal(true)

  // Derive state from providers
  const activeConsumer = () => Array.from(webrtcState.consumers.values()).find(c => c.consumer && !c.paused)
  const currentStream = () => {
    const consumer = activeConsumer()
    return consumer?.track ? new MediaStream([consumer.track]) : null
  }
  const isConnected = () => connectionState() === 'connected' && activeConsumer() != null

  let audioElement: HTMLAudioElement | undefined

  // Connect to room WebSocket on mount
  onMount(async () => {
    try {
      await connectToRoom(roomId())
      joinRoom()
    } catch (err: any) {
      console.error('Failed to connect to room:', err)
      setError(err.message)
      setIsInitializing(false)
    }
  })

  onCleanup(() => {
    // Cleanup handled by providers and audio element cleanup
    if (audioElement) {
      audioElement.pause()
      audioElement.srcObject = null
      audioElement = undefined
    }
  })

  // Effect to set up audio playback when stream changes
  createEffect(() => {
    const stream = currentStream()
    if (stream) {
      setupAudioPlayback(stream)
    }
  })

  // Effect to sync initialization state with provider state
  createEffect(() => {
    const connState = connectionState()
    const consumer = activeConsumer()

    if (connState === 'connected' && consumer) {
      setIsInitializing(false)
    } else if (connState === 'connecting') {
      // Keep initializing state
    } else if (connState === 'failed') {
      setIsInitializing(false)
      if (!error()) {
        setError('Connection failed')
      }
    }
  })

  const joinRoom = async () => {
    setIsInitializing(true)
    setError(null)

    const program = Effect.gen(function* (_) {
      const result = yield* _(joinRoomFlow(roomId(), sendCommand))
      return result
    })

    try {
      await Effect.runPromise(program)
      // State updates handled by providers through effects

    } catch (err: any) {
      console.error('Failed to join room:', err)
      setError(err.message)
      setIsInitializing(false)
    }
  }

  const setupAudioPlayback = (stream: MediaStream) => {
    try {
      audioElement = new Audio()
      audioElement.srcObject = stream
      audioElement.autoplay = true
      audioElement.volume = isMuted() ? 0 : volume()

    } catch (err) {
      console.error('Failed to set up audio playback:', err)
    }
  }

  const handleVolumeChange = (event: Event) => {
    const target = event.target as HTMLInputElement
    const newVolume = parseFloat(target.value)
    setVolume(newVolume)

    if (audioElement && !isMuted()) {
      audioElement.volume = newVolume
    }
  }

  const toggleMute = () => {
    const newMuted = !isMuted()
    setIsMuted(newMuted)

    if (audioElement) {
      audioElement.volume = newMuted ? 0 : volume()
    }
  }

  const leaveRoom = () => {
    // Cleanup audio element
    if (audioElement) {
      audioElement.pause()
      audioElement.srcObject = null
      audioElement = undefined
    }
    navigate('/')
  }

  const goBack = () => {
    navigate('/')
  }

  return (
    <div class="min-h-screen bg-base-100 p-4">
      <div class="max-w-md mx-auto">
        <Show when={isInitializing()}>
          <div class="card bg-base-200">
            <div class="card-body text-center">
              <div class="loading loading-spinner loading-lg mx-auto"></div>
              <h2>Connecting...</h2>
            </div>
          </div>
        </Show>

        <Show when={error()}>
          <div class="alert alert-error mb-4">
            <span>{error()}</span>
            <button class="btn btn-sm btn-circle" onClick={() => setError(null)}>✕</button>
          </div>
        </Show>

        <Show when={!isInitializing()}>
          <div class="card bg-base-200">
            <div class="card-body">
              <div class="flex justify-between items-center mb-4">
                <button class="btn btn-sm btn-ghost" onClick={goBack}>←</button>
                <div class={`badge ${isConnected() ? 'badge-success' : 'badge-error'}`}>
                  {isConnected() ? 'LIVE' : 'DISCONNECTED'}
                </div>
              </div>

              {/*
              <WaveformVisualizer stream={currentStream() || undefined} />
                */}

              <div class="space-y-4 mt-4">
                {/* Volume Control */}
                <div class="flex items-center gap-3">
                  <button
                    class="btn btn-sm btn-circle"
                    onClick={toggleMute}
                  >
                    {isMuted() ? (
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                      </svg>
                    ) : (
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728" />
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      </svg>
                    )}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={volume()}
                    class="range range-sm flex-1"
                    onInput={handleVolumeChange}
                  />
                  <span class="text-sm">{Math.round(volume() * 100)}%</span>
                </div>

                {/* Leave Button */}
                <button class="btn btn-sm btn-block" onClick={leaveRoom}>
                  Leave
                </button>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </div>
  )
}
