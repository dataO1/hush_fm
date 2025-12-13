import { createSignal, onMount, onCleanup, Show, createEffect } from 'solid-js'
import { useParams, useNavigate } from '@solidjs/router'
import { Effect, Option } from 'effect'
import { publishRoomFlow, toggleProducerFlow } from '../effects/webrtc-flows'
// import { WaveformVisualizer } from '../components/shared/WaveformVisualizer'
import { DeviceSelector } from '../components/controls/DeviceSelector'
import { useWebRTC } from '../providers/WebRTCProvider'
import { useSignaling } from '../providers/SignalingProvider'
import { getWebSocketTraceContext } from '../telemetry'

type StreamStatus = 'idle' | 'ready' | 'connecting' | 'live' | 'muted' | 'error'

export default function DJRoom() {
  const params = useParams()
  const navigate = useNavigate()

  // Use new providers instead of local state
  const { connectionState, isStreaming, selectedDeviceId } = useWebRTC()
  const { connectToRoom, sendCommand, getRoomWebSocket } = useSignaling()

  const [roomId] = createSignal(params.roomId)
  const [status, setStatus] = createSignal<StreamStatus>('idle')
  const [error, setError] = createSignal<string | null>(null)
  const [isInitializing, setIsInitializing] = createSignal(true)

  // Simple state - streaming state managed by flows
  const [isMuted, setIsMuted] = createSignal(false)
  const [isRecording, setIsRecording] = createSignal(false)
  
  // Device selection state
  const [deviceSelected, setDeviceSelected] = createSignal(false)
  const [isReadyToStream, setIsReadyToStream] = createSignal(false)

  // Connect to room WebSocket on mount (but don't start streaming automatically)
  onMount(async () => {
    try {
      await connectToRoom(roomId())
      setIsInitializing(false)
      setIsReadyToStream(true)
      setStatus('ready') // Set to ready when WebSocket connected
    } catch (err: any) {
      console.error('Failed to connect to room:', err)
      setError(err.message)
      setStatus('error')
      setIsInitializing(false)
    }
  })

  onCleanup(() => {
    // Cleanup handled by providers
  })

  // Effect to monitor device selection
  createEffect(() => {
    const device = selectedDeviceId()
    setDeviceSelected(Option.isSome(device))
  })

  // Effect to sync status with provider state
  createEffect(() => {
    const connState = connectionState()
    const streaming = isStreaming()
    const muted = isMuted()

    // Only update status when actually streaming
    if (streaming) {
      setStatus(muted ? 'muted' : 'live')
      setIsInitializing(false)
      setError(null) // Clear any previous errors on success
    } else if (connState === 'failed') {
      setStatus('error')
      setIsInitializing(false)
    }
    // Don't set 'connecting' here - that's only for streaming
  })

  const startStreaming = async () => {
    // Check device selection first
    const deviceId = Option.getOrUndefined(selectedDeviceId())
    if (!deviceId) {
      setError('Please select an audio device first')
      return
    }

    setIsInitializing(true)
    setStatus('connecting')
    setError(null)

    // Get the WebSocket from SignalingProvider
    const roomWebSocketOption = getRoomWebSocket()
    const roomWebSocket = Option.match(roomWebSocketOption, {
      onNone: () => {
        setError('No WebSocket connection available')
        setStatus('error')
        setIsInitializing(false)
        return null
      },
      onSome: (ws) => ws
    })

    if (!roomWebSocket) return

    const program = Effect.gen(function* (_) {
      const result = yield* _(publishRoomFlow(`Room ${roomId()}`, roomWebSocket, deviceId))
      return result
    })

    try {
      await Effect.runPromise(program)
      setIsRecording(true) // Set recording state
      // State updates handled by providers through effects

    } catch (err: any) {
      console.error('Failed to start streaming:', err)
      setError(err.message)
      setStatus('error')
      setIsInitializing(false)
    }
  }

  const toggleMute = async () => {
    if (!isRecording()) return // Only allow mute when recording

    try {
      const currentMuted = isMuted()
      const program = toggleProducerFlow(!currentMuted) // pause = !currentMuted (if not muted, pause)
      await Effect.runPromise(program)
      setIsMuted(!currentMuted)
    } catch (err: any) {
      console.error('Failed to toggle mute:', err)
      setError(err.message)
    }
  }

  const toggleRecording = async () => {
    if (!isRecording()) {
      // Start recording (same as current startStreaming)
      await startStreaming()
    } else {
      // Stop recording but keep connection
      try {
        const program = toggleProducerFlow(true) // pause the stream
        await Effect.runPromise(program)
        setIsRecording(false)
        setIsMuted(false) // Reset mute state
        setStatus('ready')
      } catch (err: any) {
        console.error('Failed to stop recording:', err)
        setError(err.message)
      }
    }
  }

  const endStream = async () => {
    try {
      // Send delete room message to backend
      await sendCommand(roomId(), {
        type: 'closeRoom',
        _traceContext: getWebSocketTraceContext()
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
                  status() === 'ready' ? 'badge-info' :
                  'badge-ghost'
                }`}>
                  {status() === 'idle' ? 'SETUP' : status().toUpperCase()}
                </div>
              </div>

              <DeviceSelector disabled={isStreaming()} />
              {/*
              <WaveformVisualizer stream={currentStream() || undefined} />
                */}
              
              {/* Show Go Live button when not streaming */}
              <Show when={!isStreaming()}>
                <div class="text-center mt-4">
                  <button
                    class="btn btn-primary btn-lg"
                    onClick={startStreaming}
                    disabled={!deviceSelected() || !isReadyToStream() || status() === 'connecting'}
                  >
                    {status() === 'connecting' ? (
                      <>
                        <span class="loading loading-spinner loading-sm"></span>
                        Connecting...
                      </>
                    ) : (
                      'Go Live'
                    )}
                  </button>
                  <div class="text-sm text-base-content/60 mt-2">
                    Select a microphone to get started
                  </div>
                </div>
              </Show>

              {/* Show recording controls when connected */}
              <Show when={isReadyToStream() && !isInitializing()}>
                <div class="flex gap-2 justify-center mt-4">
                  
                  {/* Record/Stop Button */}
                  <button
                    class={`btn btn-circle btn-lg ${
                      isRecording() ? 'btn-error' : 'btn-primary'
                    }`}
                    onClick={toggleRecording}
                    disabled={status() === 'error' || status() === 'connecting'}
                  >
                    {isRecording() ? (
                      // Stop icon
                      <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                        <rect x="6" y="6" width="12" height="12" rx="2"/>
                      </svg>
                    ) : (
                      // Record icon
                      <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="6"/>
                      </svg>
                    )}
                  </button>

                  {/* Mute Button - only visible when recording */}
                  <Show when={isRecording()}>
                    <button
                      class={`btn btn-circle btn-md ${
                        isMuted() ? 'btn-warning' : 'btn-success'
                      }`}
                      onClick={toggleMute}
                      disabled={status() === 'error' || status() === 'connecting'}
                    >
                      {isMuted() ? (
                        // Muted icon
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                        </svg>
                      ) : (
                        // Unmuted icon
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                        </svg>
                      )}
                    </button>
                  </Show>

                  {/* End Stream Button */}
                  <button class="btn btn-error btn-sm" onClick={endStream}>
                    End
                  </button>
                  
                </div>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </div>
  )
}
