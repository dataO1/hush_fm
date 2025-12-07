import { createSignal, onMount, onCleanup, Show } from 'solid-js'
import { useParams, useNavigate } from '@solidjs/router'
import { Effect } from 'effect'
import { joinRoomFlow } from '../effects/webrtc-flows'
import { WaveformVisualizer } from '../components/shared/WaveformVisualizer'

export default function ListenerRoom() {
  const params = useParams()
  const navigate = useNavigate()
  
  const [roomId] = createSignal(params.roomId)
  const [volume, setVolume] = createSignal(0.8)
  const [isMuted, setIsMuted] = createSignal(false)
  const [audioStream, setAudioStream] = createSignal<MediaStream>()
  const [error, setError] = createSignal<string | null>(null)
  const [isInitializing, setIsInitializing] = createSignal(true)
  const [isConnected, setIsConnected] = createSignal(false)

  let consumer: any = null
  let transport: any = null
  let audioElement: HTMLAudioElement | undefined

  onMount(() => {
    joinRoom()
  })

  onCleanup(() => {
    cleanup()
  })

  const joinRoom = async () => {
    setIsInitializing(true)
    setError(null)

    const program = Effect.gen(function* (_) {
      const result = yield* _(joinRoomFlow(roomId()))
      return result
    })

    try {
      const result = await Effect.runPromise(program)
      
      consumer = result.consumer
      transport = result.transport
      
      if (result.consumer && result.consumer.track) {
        const stream = new MediaStream([result.consumer.track])
        setAudioStream(stream)
        setupAudioPlayback(stream)
      }
      
      setIsConnected(true)
      setIsInitializing(false)
      
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
    cleanup()
    navigate('/')
  }

  const cleanup = () => {
    if (consumer) {
      consumer.close()
      consumer = null
    }
    
    if (transport) {
      transport.close()
      transport = null
    }

    if (audioElement) {
      audioElement.pause()
      audioElement.srcObject = null
      audioElement = undefined
    }

    const stream = audioStream()
    if (stream) {
      stream.getTracks().forEach(track => track.stop())
      setAudioStream(undefined)
    }
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

              <WaveformVisualizer stream={audioStream()} />

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