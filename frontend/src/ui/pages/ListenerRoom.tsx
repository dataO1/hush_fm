import { onMount, onCleanup, Show } from 'solid-js'
import { useParams, useNavigate, useLocation } from '@solidjs/router'
import { Effect, Option } from 'effect'
import { getRoomStore } from '../../stores/room.store'
import { joinRoomAsListener, leaveRoomAsListener } from '../../services/flows/listener-flows.service'
import { ConnectionState, type WebRTCError } from '../../domain/schemas/room.schema'
import ConnectionStatusDot from '../components/ConnectionStatusDot'
import { Oscilloscope } from '../components/shared/Oscilloscope'
import { WebRTCErrorHandler } from '../components/WebRTCErrorHandler'
import { getNavigationCleanupService } from '../../services/navigation-cleanup.service'

export default function ListenerRoom() {
  const params = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  // Use room store
  const roomStore = getRoomStore()

  // Get data from navigation state (from Landing.tsx RequestJoin response)
  const navigationState = location.state as {
    listenerWebSocketUrl?: string
    roomInfo?: any
    sessionId?: string
  } || {}

  // Get autoplay blocked state from store
  const needsUserPlay = () => {
    const listener = currentListener()
    return listener ? listener.audioPlayback.autoplayBlocked : false
  }

  // Use session ID as the listener ID (single source of truth)  
  const currentListenerId = () => {
    // Try navigation state first (normal flow)
    if (navigationState.sessionId) {
      return navigationState.sessionId
    }
    
    // For page reload scenarios, we'll get the session ID after successful join
    // The join flow will populate the store with the listener using sessionId as key
    const listeners = roomStore.listeners
    if (listeners.length > 0) {
      // In our architecture, the listener ID is the session ID
      // We can extract it from the store keys (session IDs are used as listener IDs)
      const listenerIds = Object.keys(roomStore.state.participants.listeners as Record<string, any>)
      return listenerIds.length > 0 ? listenerIds[0] : null
    }
    
    return null
  }
  
  
  const currentListener = () => {
    const sessionId = navigationState.sessionId
    if (!sessionId) return undefined
    return roomStore.getListener(sessionId)
  }

  // Use unified connection state from store as single source of truth
  const connectionState = () => roomStore.connectionState
  const isConnecting = () => connectionState() === ConnectionState.CONNECTING
  
  // WebRTC error state
  const webrtcError = () => roomStore.webrtcError
  const hasWebRTCError = () => roomStore.hasWebRTCError

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
  
  // Room information - get room ID from store metadata or fallback to params
  const roomMetadata = () => roomStore.roomMetadata
  const roomId = () => roomMetadata()?.id || params.roomId
  const roomName = () => roomMetadata()?.name || `Room ${roomId()}`
  const djName = () => roomMetadata()?.djName || 'DJ'

  // Get listener audio stream from room store
  const listenerAudioStream = () => {
    const listener = currentListener()
    if (!listener) return null
    
    const mediaStreamOption = listener.audioPlayback.mediaStream as Option.Option<MediaStream>
    return Option.getOrNull(mediaStreamOption) as MediaStream | null
  }





  // Register with global navigation service and start join room flow
  onMount(async () => {
    // 1. Register component with global navigation cleanup service
    try {
      const navigationService = getNavigationCleanupService()
      
      // DISABLED: No cleanup effects during navigation to preserve connections
      // Create cleanup effect for this specific listener room
      // const listenerId = currentListenerId()
      // const baseCleanupEffect = listenerId 
      //   ? navigationService.cleanupListenerAndInitStore(listenerId)
      //   : navigationService.initLocalStore()
      
      // Enhance with HTMLAudioElement cleanup
      // const cleanupEffect = pipe(
      //   baseCleanupEffect,
      //   Effect.andThen(() => 
      //     Effect.sync(() => {
      //       // Component-specific HTMLAudioElement cleanup
      //       if (audioRef) {
      //         console.info('🔊 ListenerRoom: Cleaning up HTMLAudioElement...')
      //         try {
      //           audioRef.pause()
      //           audioRef.srcObject = null
      //           audioRef.removeAttribute('src')
      //           audioRef.load() // Force cleanup
      //           console.info('✅ ListenerRoom: HTMLAudioElement cleaned up')
      //         } catch (error) {
      //           console.warn('⚠️ ListenerRoom: Audio element cleanup failed:', error)
      //         }
      //       }
      //     })
      //   )
      // )
      
      // Register component with global service (no cleanup effect)
      await Effect.runPromise(
        navigationService.registerComponent('listener-room', Effect.void, location.pathname)
      )
      console.info('🔧 ListenerRoom: Component registered with global navigation service')
    } catch (error) {
      console.error('❌ Failed to register with navigation service:', error)
    }
    
    // 2. Start join room flow
    try {
      await joinRoom()
    } catch (err: any) {
      console.error('Failed to join room:', err)
      // Error state is handled by the store via the service
    }

  })

  onCleanup(async () => {
    // Unregister from global navigation service
    try {
      const navigationService = getNavigationCleanupService()
      await Effect.runPromise(navigationService.unregisterComponent('listener-room'))
      console.info('🧹 ListenerRoom: Component unregistered from global navigation service')
    } catch (error) {
      console.error('❌ Failed to unregister from navigation service:', error)
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
      // Use navigation state (should be available from normal join flow via lobby)
      const sessionId = navigationState.sessionId
      const listenerWebSocketUrl = navigationState.listenerWebSocketUrl
      const roomInfo = navigationState.roomInfo

      
      if (!sessionId || !listenerWebSocketUrl) {
        console.error('Missing required data for listener join:', { sessionId, listenerWebSocketUrl })
        navigate('/')
        return
      }
      
      console.info('🎧 Starting listener join flow:', {
        roomId: roomId(),
        sessionId: sessionId,
        listenerWebSocketUrl: listenerWebSocketUrl,
        hasRoomInfo: !!roomInfo
      })
      
      // Start listener join flow - all state management handled by service and store
      await Effect.runPromise(
        joinRoomAsListener(roomStore, {
          roomId: roomId(),
          sessionId: sessionId,
          listenerWebSocketUrl: listenerWebSocketUrl,
          roomInfo: roomInfo,
          listenerName: `Listener_${Math.random().toString(36).substr(2, 5)}`
        })
      )


    } catch (err: any) {
      console.error('Failed to join room:', err)

      // Return to lobby on any join failure
      setTimeout(() => {
        navigate('/')
      }, 3000) // Give user time to read the error message
    }
  }

const handleManualPlay = () => {
    const listener = currentListener()
    if (listener && Option.isSome(listener.audioPlayback.audioElement)) {
      const audioElement = listener.audioPlayback.audioElement.value as HTMLAudioElement
      audioElement.play().then(() => {
        // Update store to clear autoplay blocked state
        const listenerId = currentListenerId()
        if (listenerId) {
          roomStore.actions.setListenerAutoplayBlocked(listenerId, false)
        }
      })
    }
  }

  const leaveRoom = async () => {
    console.info('🚪 Initiating leave room flow')
    
    // 1. Leave room using service (handles MediaSoup cleanup and backend notification)
    const listenerId = currentListenerId()
    if (listenerId) {
      try {
        console.info('📡 Calling leaveRoomAsListener service')
        await Effect.runPromise(leaveRoomAsListener(roomStore, listenerId))
        console.info('✅ Leave room service completed')
      } catch (error) {
        console.error('❌ Error in leave room service:', error)
      }
    }

    // 2. Reset store state using navigation service
    try {
      console.info('🧹 Resetting store state')
      const navigationService = getNavigationCleanupService()
      await Effect.runPromise(navigationService.initLocalStore())
      console.info('✅ Store state reset completed')
    } catch (error) {
      console.error('❌ Error resetting store state:', error)
    }

    // 3. Navigate back to lobby
    console.info('🔙 Navigating back to lobby')
    navigate('/')
  }

  // Ensure this return block replaces your current broken return
  return (
    <div class="h-screen w-full bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 text-white flex flex-col items-center justify-center p-4 sm:p-6">

      {/* Audio managed by consumer service - no DOM element needed here */}

      {/* WebRTC Error Handler */}
      <WebRTCErrorHandler 
        error={webrtcError() as WebRTCError | null}
        show={hasWebRTCError()}
        onDismiss={() => roomStore.actions.clearWebRTCStatus()}
        onCancel={() => navigate('/')}
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
            
            {/* Room Header */}
            <div class="text-center">
              <h1 class="text-lg sm:text-xl font-semibold text-white/90 mb-1">{roomName()}</h1>
              <p class="text-sm text-white/60">DJ: {djName()}</p>
            </div>

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
                <Oscilloscope 
                  stream={listenerAudioStream()!} 
                  height={60} 
                  class="mb-0"
                  userGestureAvailable={!needsUserPlay()}
                />
              </div>
            </Show>

            {/* User Interaction Modal (Only if autoplay blocked) */}
            <Show when={needsUserPlay()}>
              {/* Modal Background Overlay - Click outside to resume */}
              <div 
                class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
                onClick={handleManualPlay}
              >
                {/* Modal Container */}
                <div 
                  class="card bg-white/10 backdrop-blur-sm border border-white/20 shadow-xl max-w-sm w-full mx-4 animate-in fade-in-0 zoom-in-95 duration-200"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div class="card-body p-6 text-center">
                    
                    {/* Icon */}
                    <div class="flex justify-center mb-4">
                      <div class="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center">
                        <svg class="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 14.142M9 9a3 3 0 000 6h3v-6H9zM21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                    </div>
                    
                    {/* Title and Message */}
                    <h3 class="text-lg sm:text-xl font-semibold text-white mb-2">
                      Enable Audio Playback
                    </h3>
                    <p class="text-sm sm:text-base text-white/70 mb-6 leading-relaxed">
                      Your browser requires user interaction before playing audio. Click anywhere to start listening to the live stream.
                    </p>
                    
                    {/* Action Button */}
                    <button
                      onClick={handleManualPlay}
                      class="btn btn-primary btn-lg w-full gap-2 text-base"
                    >
                      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h2m4 0h2M7 7h10a2 2 0 012 2v8a2 2 0 01-2 2H7a2 2 0 01-2-2V9a2 2 0 012-2z" />
                      </svg>
                      Resume Audio
                    </button>
                    
                  </div>
                </div>
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
