import { createSignal, onMount, onCleanup, Show, createEffect } from 'solid-js'
import { useParams, useNavigate, useLocation } from '@solidjs/router'
import { Effect, Option } from 'effect'
import { createRoomStore } from '../../stores/room.store'
import { createLobbyStore } from '../../stores/lobby.store'
import { joinRoomAsListener } from '../../services/flows/listener-flows.service'
import { leaveLobby } from '../../services/flows/lobby-flows.service'

export default function ListenerRoom() {
  const params = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  // Use room store and lobby store
  const roomStore = createRoomStore()
  const lobbyStore = createLobbyStore()

  // Get data from navigation state (from Landing.tsx RequestJoin response)
  const navigationState = location.state as {
    listenerWebSocketUrl?: string
    roomInfo?: any
    sessionId?: string
  } || {}

  const [roomId] = createSignal(params.roomId)
  const [volume, setVolume] = createSignal(0.8)
  const [isMuted, setIsMuted] = createSignal(false)
  const [error, setError] = createSignal<Option.Option<string>>(Option.none())
  const [isInitializing, setIsInitializing] = createSignal(true)
  const [needsUserPlay, setNeedsUserPlay] = createSignal(false)

  // Read state from store instead of local state
  const currentListenerId = () => {
    const listeners = roomStore.listeners
    return listeners.length > 0 ? (listeners[0] as any).id : undefined
  }
  
  const currentListener = () => {
    const listeners = roomStore.listeners
    return listeners.length > 0 ? listeners[0] : undefined
  }

  const connectionState = () => {
    const listener = currentListener()
    if (!listener) return 'connecting'
    
    // Check listener flow step for connection state
    switch (listener.currentStep) {
      case 'streaming':
        return 'connected'
      case 'error':
        return 'failed'
      default:
        return 'connecting'
    }
  }
  
  const isConnected = () => connectionState() === 'connected' && roomStore.isConnected && !!currentListenerId()
  const isDJLive = () => isConnected() && roomStore.isStreaming

  const mediaStream = () => {
    const listener = currentListener()
    if (!listener) return Option.none()
    return listener.audioPlayback.mediaStream as Option.Option<MediaStream>
  }

  // 1. Ensure audioRef is typed correctly
  let audioRef: HTMLAudioElement | undefined

  // 2. Updated Effect with logging
  createEffect(() => {
    const streamOption = mediaStream()

    // Check both stream and ref presence
    if (Option.isSome(streamOption)) {
      if (audioRef) {
        const stream = streamOption.value as MediaStream
        console.log("🌊 Stream detected, attaching to audio element...", stream.id)

        // A. Set source
        audioRef.srcObject = stream

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

  onCleanup(async () => {
    // Cleanup using room store
    try {
      roomStore.actions.disconnectFromRoom()
    } catch (error) {
      console.error('Error during cleanup:', error)
    }
    
    // Disconnect from lobby
    const lobbyWs = Option.getOrNull(lobbyStore.state.connection.websocket)
    if (lobbyWs) {
      try {
        await Effect.runPromise(leaveLobby(lobbyWs))
        lobbyStore.actions.setDisconnected()
      } catch (error) {
        console.error('Error disconnecting from lobby:', error)
      }
    }
  })

  // Effect to set up audio playback when stream changes
  // createEffect(() => {
  //   const stream = currentStream()
  //   Option.match(stream, {
  //     onSome: (s) => setupAudioPlayback(s),
  //     onNone: () => {}
  //   })
  // })

  // Effect to sync initialization state with room store state
  createEffect(() => {
    const connState = connectionState()
    const listenerId = currentListenerId()
    const roomConnected = roomStore.isConnected

    if (connState === 'connected' && listenerId && roomConnected) {
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

      try {
          // Check if we have the required navigation state
          if (!navigationState.listenerWebSocketUrl || !navigationState.sessionId) {
              throw new Error('Missing listener WebSocket URL or session ID from navigation state')
          }
          
          console.info('🎧 Starting listener join flow with navigation state:', {
              roomId: roomId(),
              sessionId: navigationState.sessionId,
              listenerWebSocketUrl: navigationState.listenerWebSocketUrl,
              hasRoomInfo: !!navigationState.roomInfo
          })
          
          // Start listener join flow with proper parameters
          const result = await Effect.runPromise(
            joinRoomAsListener(roomStore, {
              roomId: roomId(),
              sessionId: navigationState.sessionId,
              listenerWebSocketUrl: navigationState.listenerWebSocketUrl,
              roomInfo: navigationState.roomInfo,
              listenerName: `Listener_${Math.random().toString(36).substr(2, 5)}`
            })
          )

          // State is now managed by the store - just update initialization
          setIsInitializing(false)
          
          console.log("Join room success:", result)

      } catch (err: any) {
          console.error('Failed to join room:', err)

          // Enhanced error handling following reference Step 7b
          let errorMessage = err.message || 'Unknown error occurred'
          let shouldReturnToLobby = false

          if (err.message?.includes('Router incompatible') || err.message?.includes('Room join failed')) {
              // Step 6b-7b: Router compatibility error
              errorMessage = err.message
              shouldReturnToLobby = true
          } else if (err.message?.includes('Room not found') || err.message?.includes('producer')) {
              errorMessage = 'This room is no longer available or the DJ has stopped streaming.'
              shouldReturnToLobby = true
          } else if (err.message?.includes('Transport') || err.message?.includes('Consumer')) {
              errorMessage = 'Failed to establish connection to the room. This may be due to network issues or room incompatibility.'
              shouldReturnToLobby = true
          } else if (err.message?.includes('Failed to connect')) {
              errorMessage = 'Could not connect to the room. Please check your network connection and try again.'
          } else if (err.message?.includes('WebSocket')) {
              errorMessage = 'Connection lost to the room. Please try again.'
          }

          setError(Option.some(errorMessage))
          setIsInitializing(false)
          // Connection state is now read from store

          // Step 7b: Return to lobby for certain error types
          if (shouldReturnToLobby) {
              setTimeout(() => {
                  console.log('Returning to lobby due to error:', errorMessage)
                  navigate('/')
              }, 3000) // Give user time to read the error message
          }
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

  const leaveRoom = async () => {
    // 1. Cleanup Audio
    if (audioRef) {
      audioRef.pause()
      audioRef.srcObject = null
    }

    // 2. Leave room using listener flows if we have a listener ID
    const listenerId = currentListenerId()
    if (listenerId) {
      try {
        // Import and use leaveRoomAsListener when available
        console.log('Leaving room as listener:', listenerId)
        roomStore.actions.removeListener(listenerId)
      } catch (error) {
        console.error('Error leaving room:', error)
      }
    }

    // 3. Disconnect from room store
    try {
      roomStore.actions.disconnectFromRoom()
    } catch (error) {
      console.error('Error disconnecting from room:', error)
    }

    // 4. State is now managed by store - no manual reset needed

    // 5. Navigate Away
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
