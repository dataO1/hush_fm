import { createSignal, onMount, onCleanup, Show, createEffect } from 'solid-js'
import { useParams, useNavigate, useLocation } from '@solidjs/router'
import { Effect, Option } from 'effect'
import { createRoomStore } from '../../stores/room.store'
import { createLobbyStore } from '../../stores/lobby.store'
import { joinRoomAsListener, leaveRoomAsListener } from '../../services/flows/listener-flows.service'
import { leaveLobby } from '../../services/flows/lobby-flows.service'
import { ConnectionState } from '../../domain/schemas/room.schema'
import ConnectionStatusDot from '../components/ConnectionStatusDot'
import { Oscilloscope } from '../components/shared/Oscilloscope'

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
  const [needsUserPlay, setNeedsUserPlay] = createSignal(false)

  // Use session ID as the listener ID (single source of truth)
  const currentListenerId = () => {
    return navigationState.sessionId
  }
  
  const currentListener = () => {
    const sessionId = navigationState.sessionId
    if (!sessionId) return undefined
    return roomStore.getListener(sessionId)
  }

  // Use unified connection state from store as single source of truth
  const connectionState = () => roomStore.connectionState
  const isConnecting = () => connectionState() === ConnectionState.CONNECTING

  // Helper to convert ConnectionState to dot status
  const getDotStatus = () => {
    const state = connectionState()
    if (state === ConnectionState.STREAMING) return 'streaming'
    if (state === ConnectionState.PAUSED) return 'paused'
    if (state === ConnectionState.ERROR) return 'error'
    if (state === ConnectionState.CONNECTED) return 'connected'
    if (state === ConnectionState.CONNECTING || state === ConnectionState.DISCONNECTING) return 'connecting'
    return 'disconnected'
  }

  // Helper to get status text for accessibility
  const getStatusText = () => {
    const state = connectionState()
    if (state === ConnectionState.STREAMING) return 'LIVE'
    if (state === ConnectionState.PAUSED) return 'PAUSED'
    return state
  }
  const currentError = () => {
    const listener = currentListener()
    return listener ? Option.getOrNull(listener.stepError) : null
  }

  // Get listener audio stream from room store
  const listenerAudioStream = () => {
    const listener = currentListener()
    if (!listener) return null
    
    const mediaStreamOption = listener.audioPlayback.mediaStream as Option.Option<MediaStream>
    return Option.getOrNull(mediaStreamOption) as MediaStream | null
  }

  // 1. Ensure audioRef is typed correctly
  let audioRef: HTMLAudioElement | undefined

  // 2. Updated Effect with logging
  createEffect(() => {
    const listener = currentListener()
    if (!listener) return
    const streamOption = listener.audioPlayback.mediaStream as Option.Option<MediaStream>

    // Check both stream and ref presence
    if (Option.isSome(streamOption)) {
      if (audioRef) {
        const stream = streamOption.value as MediaStream

        // A. Set source
        audioRef.srcObject = stream

        // B. Set default volume
        audioRef.volume = 0.8

        // C. Explicit Play Attempt
        audioRef.play()
          .then(() => {
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
      // Error state is handled by the store via the service
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


  const joinRoom = async () => {
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
          
          // Start listener join flow - all state management handled by service and store
          await Effect.runPromise(
            joinRoomAsListener(roomStore, {
              roomId: roomId(),
              sessionId: navigationState.sessionId,
              listenerWebSocketUrl: navigationState.listenerWebSocketUrl,
              roomInfo: navigationState.roomInfo,
              listenerName: `Listener_${Math.random().toString(36).substr(2, 5)}`
            })
          )
          

      } catch (err: any) {
          console.error('Failed to join room:', err)

          // Enhanced error handling following reference Step 7b
          let shouldReturnToLobby = false

          if (err.message?.includes('Router incompatible') || err.message?.includes('Room join failed')) {
              shouldReturnToLobby = true
          } else if (err.message?.includes('Room not found') || err.message?.includes('producer')) {
              shouldReturnToLobby = true
          } else if (err.message?.includes('Transport') || err.message?.includes('Consumer')) {
              shouldReturnToLobby = true
          }

          // Step 7b: Return to lobby for certain error types
          if (shouldReturnToLobby) {
              setTimeout(() => {
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

  const leaveRoom = async () => {
    console.info('🚪 Initiating leave room flow')
    
    // 1. Cleanup Audio immediately
    if (audioRef) {
      audioRef.pause()
      audioRef.srcObject = null
      console.info('🔇 Audio element cleaned up')
    }

    // 2. Leave room using proper service flow if we have a listener ID
    const listenerId = currentListenerId()
    if (listenerId) {
      try {
        console.info('📡 Calling leaveRoomAsListener service with listenerId:', listenerId)
        // This will: 
        // 1. Send leaveRoom command to backend
        // 2. Close MediaSoup consumer and transport
        // 3. Close WebSocket connection  
        // 4. Update room state to DISCONNECTED
        // 5. Remove listener from store
        await Effect.runPromise(leaveRoomAsListener(roomStore, listenerId))
        console.info('✅ Leave room service flow completed')
      } catch (error) {
        console.error('❌ Error in leave room service flow:', error)
        // Fallback cleanup if service fails
        try {
          roomStore.actions.removeListener(listenerId)
          roomStore.actions.setConnectionState(ConnectionState.DISCONNECTED)
        } catch (fallbackError) {
          console.error('❌ Fallback cleanup also failed:', fallbackError)
        }
      }
    } else {
      console.warn('⚠️ No listener ID found for leave room flow')
    }

    // 3. Cleanup lobby connection if exists
    const lobbyWs = Option.getOrNull(lobbyStore.state.connection.websocket)
    if (lobbyWs) {
      try {
        console.info('🏢 Disconnecting from lobby')
        await Effect.runPromise(leaveLobby(lobbyWs))
        lobbyStore.actions.setDisconnected()
      } catch (error) {
        console.error('❌ Error disconnecting from lobby:', error)
      }
    }

    // 4. Navigate back to lobby
    console.info('🔙 Navigating back to lobby')
    navigate('/')
  }

  // Ensure this return block replaces your current broken return
  return (
    <div class="h-screen w-full bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 text-white flex flex-col items-center justify-center p-4 sm:p-6">

      {/* 1. The Audio Element (Essential!) */}
      <audio
        ref={audioRef}
        autoplay
        // playsinline
        controls={false} // Hidden controls, managed by UI below
      />

      <Show when={isConnecting()}>
        <div class="card bg-white/10 backdrop-blur-sm border border-white/20">
          <div class="card-body text-center py-8">
            <div class="loading loading-spinner loading-lg mx-auto mb-4"></div>
            <div class="text-lg sm:text-xl font-bold">Connecting...</div>
          </div>
        </div>
      </Show>

      <Show when={currentError()}>
         <div class="alert alert-error fixed top-4 right-4 left-4 sm:left-auto sm:w-auto shadow-lg z-50">
            <span class="text-sm sm:text-base">{currentError()}</span>
            <button onClick={() => {
              const listenerId = currentListenerId()
              if (listenerId) roomStore.actions.clearListenerError(listenerId)
            }} class="btn btn-sm btn-circle btn-ghost">✕</button>
         </div>
      </Show>

      <Show when={!isConnecting() && !currentError()}>
        <div class="card bg-white/10 backdrop-blur-sm border border-white/20 shadow-xl max-w-sm sm:max-w-md w-full mx-4">
          <div class="card-body flex flex-col items-center gap-6 sm:gap-8 p-4 sm:p-6">

            {/* Status Indicator - single source of truth from connection state */}
            <div class="flex flex-col items-center gap-2 sm:gap-3">
                <ConnectionStatusDot 
                  connectionState={getDotStatus()}
                  size="lg"
                  title={getStatusText()}
                />
                <span class="text-sm sm:text-base font-medium">{getStatusText()}</span>
            </div>

            {/* Audio Oscilloscope - show when we have audio stream */}
            <Show when={listenerAudioStream()}>
              <div class="w-full">
                <Oscilloscope stream={listenerAudioStream()!} height={60} class="mb-0" />
              </div>
            </Show>

            {/* Manual Play Button (Only if autoplay blocked) */}
            <Show when={needsUserPlay()}>
                <div class="alert alert-warning w-full">
                    <p class="mb-3 text-sm sm:text-base text-center">Click to start audio playback</p>
                    <button
                        onClick={handleManualPlay}
                        class="btn btn-primary btn-md sm:btn-lg gap-2 w-full sm:w-auto"
                    >
                        <span>▶</span> 
                        <span class="text-sm sm:text-base">Play Audio</span>
                    </button>
                </div>
            </Show>


            {/* Leave Button */}
            <button
                onClick={leaveRoom}
                class="btn btn-outline btn-sm sm:btn-md mt-4 w-full sm:w-auto border-red-500 text-red-500 hover:bg-red-500 hover:text-white"
            >
                <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span class="text-sm sm:text-base">Leave Room</span>
            </button>
          </div>
        </div>
      </Show>
    </div>
  )
}
