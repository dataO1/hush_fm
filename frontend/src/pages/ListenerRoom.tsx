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
  const { connectionState, isProducerPaused } = useWebRTC()
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
  const [_currentStream] = createSignal<Option.Option<MediaStream>>(Option.none())

  // For listeners: connected = has consumer AND DJ is actively streaming (not paused)
  const isConnected = () => connectionState() === 'connected' && Option.isSome(currentConsumerId())
  const isDJLive = () => isConnected() && !isProducerPaused()

  const [listenerWebSocket, setListenerWebSocket] = createSignal<Option.Option<WebSocket>>(Option.none())
  const [mediaStream, setMediaStream] = createSignal<Option.Option<MediaStream>>(Option.none())

  // 1. Ensure audioRef is typed correctly
  let audioRef: HTMLAudioElement | undefined

  // 2. Updated Effect with logging
  createEffect(() => {
    const streamOption = mediaStream()

    // Check both stream and ref presence
    if (Option.isSome(streamOption)) {
      if (audioRef) {
        console.log("🌊 Stream detected, attaching to audio element...", streamOption.value.id)

        // A. Set source
        audioRef.srcObject = streamOption.value

        // B. Update volume immediately
        audioRef.volume = isMuted() ? 0 : volume()

        // C. Explicit Play Attempt
        audioRef.play()
          .then(() => {
             console.log("✅ Audio playback started successfully")
             setNeedsUserPlay(false)
          })
          .catch(e => {
             console.warn("⚠️ Autoplay blocked or failed:", e)
             setNeedsUserPlay(true)
          })
      } else {
        console.error("❌ Stream is ready but audioRef is undefined!")
      }
    }
  })

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
  })

  // Effect to set up audio playback when stream changes
  // createEffect(() => {
  //   const stream = currentStream()
  //   Option.match(stream, {
  //     onSome: (s) => setupAudioPlayback(s),
  //     onNone: () => {}
  //   })
  // })

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
          // 1. Connect to WebSocket
          const ws = yield* _(connectWebSocket(`/ws/listen/${roomId()}`))
          setListenerWebSocket(Option.some(ws))

          // 2. Run the join flow (now returns stream, not audioElement)
          const result = yield* _(joinRoomFlow(roomId(), ws))

          return result
      })

      try {
          const result = await Effect.runPromise(program)

          // 3. Update State
          setCurrentConsumerId(Option.some(result.consumerId))

          // 4. Set the stream to the signal (triggers the createEffect for audio)
          // Ensure you have: const [currentStream, setCurrentStream] = createSignal<Option.Option<MediaStream>>(Option.none())
          setMediaStream(Option.some(result.stream))

          setIsInitializing(false)
          console.log("Join room success, stream set to state")

      } catch (err: any) {
          console.error('Failed to join room:', err)

          // Error handling logic
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

const handleManualPlay = () => {
    if (audioRef) {
      audioRef.play().then(() => setNeedsUserPlay(false))
    }
  }

  // Handle Volume Change
  const handleVolumeChange = (event: Event) => {
    const target = event.target as HTMLInputElement
    const newVolume = parseFloat(target.value)
    setVolume(newVolume)
    if (audioRef && !isMuted()) {
      audioRef.volume = newVolume
    }
  }

  // Handle Mute Toggle
  const toggleMute = () => {
    const newMuted = !isMuted()
    setIsMuted(newMuted)
    if (audioRef) {
      audioRef.volume = newMuted ? 0 : volume()
    }
  }

  const leaveRoom = () => {
    // 1. Cleanup Audio
    if (audioRef) {
      audioRef.pause()
      audioRef.srcObject = null
    }

    // 2. Cleanup WebSocket
    Option.match(listenerWebSocket(), {
      onSome: (ws) => {
        // Optional: Send leave command if your backend supports it explicitely
        // ws.send(JSON.stringify({ type: 'leaveRoom' }))
        ws.close()
        setListenerWebSocket(Option.none())
      },
      onNone: () => {}
    })

    // 3. Reset State
    setCurrentConsumerId(Option.none())
    setMediaStream(Option.none())

    // 4. Navigate Away
    navigate('/')
  }

  // Ensure this return block replaces your current broken return
  return (
    <div class="h-screen w-full bg-neutral-900 text-white flex flex-col items-center justify-center p-4">

      {/* 1. The Audio Element (Essential!) */}
      <audio
        ref={audioRef}
        autoplay
        // playsinline
        controls={false} // Hidden controls, managed by UI below
      />

      <Show when={isInitializing()}>
        <div class="text-2xl font-bold animate-pulse">Connecting...</div>
      </Show>

      <Show when={Option.isSome(error())}>
         <div class="fixed top-4 right-4 bg-red-500 text-white px-4 py-2 rounded shadow-lg flex items-center gap-2">
            <span>{Option.getOrElse(error(), () => '')}</span>
            <button onClick={() => setError(Option.none())} class="hover:bg-red-600 rounded p-1">✕</button>
         </div>
      </Show>

      <Show when={!isInitializing() && Option.isNone(error())}>
        <div class="flex flex-col items-center gap-8 max-w-md w-full">

            {/* Status Indicator */}
            <div class="flex flex-col items-center gap-2">
                <div class={`w-4 h-4 rounded-full ${isDJLive() ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`}></div>
                <div class="text-sm uppercase tracking-widest font-semibold">
                    {isDJLive() ? 'LIVE' : isConnected() ? 'PAUSED' : 'DISCONNECTED'}
                </div>
            </div>

            {/* Manual Play Button (Only if autoplay blocked) */}
            <Show when={needsUserPlay()}>
                <div class="bg-yellow-900/50 p-4 rounded-lg border border-yellow-700 text-center">
                    <p class="mb-4 text-yellow-200">Click to start audio playback</p>
                    <button
                        onClick={handleManualPlay}
                        class="bg-yellow-500 hover:bg-yellow-400 text-black font-bold py-3 px-8 rounded-full transition-all transform hover:scale-105"
                    >
                        ▶ Play Audio
                    </button>
                </div>
            </Show>

            {/* Volume Controls */}
            <div class="flex items-center gap-4 w-full bg-neutral-800 p-4 rounded-xl">
                <button onClick={toggleMute} class="p-2 hover:bg-neutral-700 rounded-full transition-colors">
                    {isMuted() ? (
                        <span>🔇</span> // Replace with Icon if you have one
                    ) : (
                        <span>🔊</span> // Replace with Icon if you have one
                    )}
                </button>

                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={volume()}
                    onInput={handleVolumeChange}
                    class="w-full accent-green-500 h-2 bg-neutral-600 rounded-lg appearance-none cursor-pointer"
                />
                <span class="w-12 text-right font-mono text-sm">{Math.round(volume() * 100)}%</span>
            </div>

            {/* Leave Button */}
            <button
                onClick={leaveRoom}
                class="mt-8 text-neutral-400 hover:text-white underline decoration-dotted underline-offset-4 transition-colors"
            >
                Leave Room
            </button>
        </div>
      </Show>
    </div>
  )
}
