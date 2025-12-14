import { createSignal, onMount, onCleanup, Show, createEffect } from 'solid-js'
import { useParams, useNavigate } from '@solidjs/router'
import { Effect, Option } from 'effect'
import { joinRoomFlow } from '../effects/webrtc-flows'
import { connectWebSocket } from '../ws/client'
// import { WaveformVisualizer } from '../components/shared/WaveformVisualizer'
import { useWebRTC } from '../providers/WebRTCProvider'
import { useSignaling } from '../providers/SignalingProvider'

export default function ListenerRoom() {
  const params = useParams()
  const navigate = useNavigate()

  // Use new providers instead of local state
  const { connectionState, isStreaming, isProducerPaused } = useWebRTC()
  // Listeners only need lobby updates, not room WebSocket
  const { } = useSignaling()

  const [roomId] = createSignal(params.roomId)
  const [volume, setVolume] = createSignal(0.8)
  const [isMuted, setIsMuted] = createSignal(false)
  const [error, setError] = createSignal<Option.Option<string>>(Option.none())
  const [isInitializing, setIsInitializing] = createSignal(true)
  const [needsUserPlay, setNeedsUserPlay] = createSignal(false)

  // Simple state - managed by flows
  const [currentConsumerId, setCurrentConsumerId] = createSignal<Option.Option<string>>(Option.none())
  const [currentStream] = createSignal<Option.Option<MediaStream>>(Option.none())
  
  // For listeners: connected = has consumer AND DJ is actively streaming (not paused)
  const isConnected = () => connectionState() === 'connected' && Option.isSome(currentConsumerId())
  const isDJLive = () => isConnected() && isStreaming() && !isProducerPaused()

  const [audioElement, setAudioElement] = createSignal<Option.Option<HTMLAudioElement>>(Option.none())
  const [listenerWebSocket, setListenerWebSocket] = createSignal<Option.Option<WebSocket>>(Option.none())

  // Start join room flow on mount (create WebSocket connection for listeners)
  onMount(async () => {
    try {
      await joinRoom()
    } catch (err: any) {
      console.error('Failed to join room:', err)
      setError(err.message)
      setIsInitializing(false)
    }
  })

  onCleanup(() => {
    // Cleanup WebSocket and audio element
    Option.match(listenerWebSocket(), {
      onSome: (ws) => {
        ws.close()
        setListenerWebSocket(Option.none())
      },
      onNone: () => {}
    })
    
    Option.match(audioElement(), {
      onSome: (audio) => {
        audio.pause()
        audio.srcObject = null
        setAudioElement(Option.none())
      },
      onNone: () => {}
    })
  })

  // Effect to set up audio playback when stream changes
  createEffect(() => {
    const stream = currentStream()
    Option.match(stream, {
      onSome: (s) => setupAudioPlayback(s),
      onNone: () => {}
    })
  })

  // Effect to sync initialization state with provider state
  createEffect(() => {
    const connState = connectionState()
    const consumerId = currentConsumerId()

    if (connState === 'connected' && Option.isSome(consumerId)) {
      setIsInitializing(false)
    } else if (connState === 'connecting') {
      // Keep initializing state
    } else if (connState === 'failed') {
      setIsInitializing(false)
      Option.match(error(), {
        onNone: () => setError(Option.some('Connection failed')),
        onSome: () => {}
      })
    }
  })

  const joinRoom = async () => {
    setIsInitializing(true)
    setError(Option.none())

    const program = Effect.gen(function* (_) {
      // Connect to WebSocket and wait for connection to be established
      const ws = yield* _(connectWebSocket(`ws://localhost:3000/ws/listen/${roomId()}`))
      setListenerWebSocket(Option.some(ws))
      
      // Now proceed with join flow using connected WebSocket
      const result = yield* _(joinRoomFlow(roomId(), ws))
      return result
    })

    try {
      const result = await Effect.runPromise(program)
      setCurrentConsumerId(Option.some(result.consumerId))
      
      // Set up audio playbook with the received audio element
      const audio = result.audioElement
      audio.volume = volume()
      audio.muted = isMuted()
      setAudioElement(Option.some(audio))
      
      // Check if autoplay was blocked
      if (audio.getAttribute('data-autoplay-blocked') === 'true') {
        setNeedsUserPlay(true)
      }
      
      setIsInitializing(false)

    } catch (err: any) {
      console.error('Failed to join room:', err)
      
      // Provide more specific error messages
      let errorMessage = err.message || 'Unknown error occurred'
      if (err.message?.includes('Failed to connect')) {
        errorMessage = 'Could not connect to the room. Please check your network connection and try again.'
      } else if (err.message?.includes('WebSocket')) {
        errorMessage = 'Connection lost to the room. Please try again.'
      } else if (err.message?.includes('Room not found') || err.message?.includes('producer')) {
        errorMessage = 'This room is no longer available or the DJ has stopped streaming.'
      }
      
      setError(Option.some(errorMessage))
      setIsInitializing(false)
    }
  }

  const setupAudioPlayback = async (stream: MediaStream) => {
    try {
      const audio = new Audio()
      audio.srcObject = stream
      audio.volume = isMuted() ? 0 : volume()
      // Required for iOS - set as attribute
      audio.setAttribute('playsinline', 'true')
      setAudioElement(Option.some(audio))

      // Try to auto-play, handle autoplay policy blocking
      try {
        await audio.play()
        console.log("Audio auto-playing successfully")
      } catch (autoplayError) {
        console.warn("Autoplay blocked, waiting for user interaction", autoplayError)
        // Mark that autoplay was blocked so UI can show play button
        audio.setAttribute('data-autoplay-blocked', 'true')
        setNeedsUserPlay(true)
      }

    } catch (err) {
      console.error('Failed to set up audio playback:', err)
    }
  }

  const handleVolumeChange = (event: Event) => {
    const target = event.target as HTMLInputElement
    const newVolume = parseFloat(target.value)
    setVolume(newVolume)

    Option.match(audioElement(), {
      onSome: (audio) => {
        if (!isMuted()) {
          audio.volume = newVolume
        }
      },
      onNone: () => {}
    })
  }

  const toggleMute = () => {
    const newMuted = !isMuted()
    setIsMuted(newMuted)

    Option.match(audioElement(), {
      onSome: (audio) => {
        audio.volume = newMuted ? 0 : volume()
      },
      onNone: () => {}
    })
  }

  const handleManualPlay = async () => {
    Option.match(audioElement(), {
      onSome: async (audio) => {
        try {
          await audio.play()
          setNeedsUserPlay(false)
          audio.removeAttribute('data-autoplay-blocked')
        } catch (error) {
          console.error('Failed to start playback:', error)
          setError(Option.some('Failed to start audio playback'))
        }
      },
      onNone: () => {}
    })
  }

  const leaveRoom = () => {
    // Cleanup audio element
    Option.match(audioElement(), {
      onSome: (audio) => {
        audio.pause()
        audio.srcObject = null
        setAudioElement(Option.none())
      },
      onNone: () => {}
    })
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

        <Show when={Option.isSome(error())}>
          <div class="alert alert-error mb-4">
            <span>{Option.getOrElse(error(), () => '')}</span>
            <button class="btn btn-sm btn-circle" onClick={() => setError(Option.none())}>✕</button>
          </div>
        </Show>

        <Show when={!isInitializing()}>
          <div class="card bg-base-200">
            <div class="card-body">
              <div class="flex justify-between items-center mb-4">
                <button class="btn btn-sm btn-ghost" onClick={goBack}>←</button>
                <div class={`badge ${isDJLive() ? 'badge-success' : isConnected() ? 'badge-warning' : 'badge-error'}`}>
                  {isDJLive() ? 'LIVE' : isConnected() ? 'PAUSED' : 'DISCONNECTED'}
                </div>
              </div>

              <Show when={needsUserPlay()}>
                <div class="alert alert-info mb-4">
                  <svg class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 19c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  <span>Click to start audio playback</span>
                  <button class="btn btn-sm btn-success" onClick={handleManualPlay}>
                    ▶ Play
                  </button>
                </div>
              </Show>

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
