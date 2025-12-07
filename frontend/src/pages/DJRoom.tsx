import { createSignal, onMount, onCleanup, Show, createEffect } from 'solid-js'
import { useParams, useNavigate } from '@solidjs/router'
import { Effect } from 'effect'
import { publishRoomFlow } from '../effects/webrtc-flows'
// import { WaveformVisualizer } from '../components/shared/WaveformVisualizer'
import { DeviceSelector } from '../components/controls/DeviceSelector'
import { useWebRTC } from '../providers/WebRTCProvider'
import { useSignaling } from '../providers/SignalingProvider'

type StreamStatus = 'connecting' | 'live' | 'muted' | 'error'

export default function DJRoom() {
  const params = useParams()
  const navigate = useNavigate()

  // Use new providers instead of local state
  const { state: webrtcState, connectionState, isStreaming } = useWebRTC()
  const { connectToRoom, sendDJMessage } = useSignaling()

  const [roomId] = createSignal(params.roomId)
  const [status, setStatus] = createSignal<StreamStatus>('connecting')
  const [error, setError] = createSignal<string | null>(null)
  const [isInitializing, setIsInitializing] = createSignal(true)

  // Derive state from providers
  const activeProducer = () => Array.from(webrtcState.producers.values()).find(p => p.producer && !p.paused)
  const currentStream = () => webrtcState.localStream
  const isMuted = () => activeProducer()?.paused || false

  // Connect to room WebSocket on mount
  onMount(async () => {
    try {
      await connectToRoom(roomId())
      startStreaming()
    } catch (err: any) {
      console.error('Failed to connect to room:', err)
      setError(err.message)
      setStatus('error')
    }
  })

  onCleanup(() => {
    // Cleanup handled by providers
  })

  // Effect to sync status with provider state
  createEffect(() => {
    const connState = connectionState()
    const streaming = isStreaming()
    const producer = activeProducer()

    if (connState === 'connected' && streaming && producer) {
      setStatus(producer.paused ? 'muted' : 'live')
      setIsInitializing(false)
    } else if (connState === 'connecting') {
      setStatus('connecting')
    } else if (connState === 'failed') {
      setStatus('error')
      setIsInitializing(false)
    }
  })

  const startStreaming = async () => {
    setIsInitializing(true)
    setStatus('connecting')
    setError(null)

    const program = Effect.gen(function* (_) {
      const result = yield* _(publishRoomFlow(`Room ${roomId()}`))
      return result
    })

    try {
      await Effect.runPromise(program)
      // State updates handled by providers through effects

    } catch (err: any) {
      console.error('Failed to start streaming:', err)
      setError(err.message)
      setStatus('error')
      setIsInitializing(false)
    }
  }

  const toggleMute = async () => {
    const producer = activeProducer()
    if (!producer?.producer) return

    try {
      if (producer.paused) {
        await producer.producer.resume()
        // Send WebSocket message to backend
        await sendDJMessage(roomId(), {
          type: 'Produce',
          rtp_parameters: producer.producer.rtpParameters
        })
      } else {
        await producer.producer.pause()
        // Send pause message to backend
        await sendDJMessage(roomId(), {
          type: 'StopProducing'
        })
      }
    } catch (err: any) {
      console.error('Failed to toggle mute:', err)
      setError(err.message)
    }
  }

  const endStream = async () => {
    try {
      // Send delete room message to backend
      await sendDJMessage(roomId(), {
        type: 'DeleteRoom'
      })
    } catch (error) {
      console.error('Failed to notify backend of room deletion:', error)
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
                <div class={`badge ${
                  status() === 'live' ? 'badge-success' :
                  status() === 'muted' ? 'badge-warning' :
                  status() === 'error' ? 'badge-error' :
                  'badge-info'
                }`}>
                  {status().toUpperCase()}
                </div>
              </div>

              <DeviceSelector />
              {/*
              <WaveformVisualizer stream={currentStream() || undefined} />
                */}
              <div class="flex gap-2 justify-center mt-4">
                <button
                  class={`btn btn-circle btn-lg ${
                    isMuted() ? 'btn-error' : 'btn-success'
                  }`}
                  onClick={toggleMute}
                  disabled={status() === 'error' || status() === 'connecting'}
                >
                  {isMuted() ? (
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clip-rule="evenodd" />
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                    </svg>
                  ) : (
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                  )}
                </button>

                <button class="btn btn-error btn-sm" onClick={endStream}>
                  End
                </button>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </div>
  )
}
