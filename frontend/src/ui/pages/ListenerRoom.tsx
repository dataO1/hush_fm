import { Show, createResource, createSignal } from 'solid-js'
import { useParams, useNavigate, useLocation } from '@solidjs/router'
import { Option } from 'effect'
import { useConnectionAdapter, useUserAdapter, useAudioClient } from '../../App'
import { useListenerService } from '../hooks/useEffectService'
import { WebrtcConnectionState } from '../../domain/schemas/connection.schema'
import { Oscilloscope } from '../components/shared/Oscilloscope'
import { WebRTCErrorHandler } from '../components/WebRTCErrorHandler'
import { RoomHeader } from '../components/room/RoomHeader'
import { ConnectionStatusGroup } from '../components/streaming/ConnectionStatusGroup'

export default function ListenerRoom() {
  const params = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  // SolidJS 2025: Use Effect services through hooks
  const listenerService = useListenerService()

  // Use adapters for reactive state (read-only)
  const connectionAdapter = useConnectionAdapter()
  const userAdapter = useUserAdapter()
  const audioClient = useAudioClient()

  // Get data from navigation state (from Landing.tsx)
  const navigationState = location.state as {
    listenerWebSocketUrl?: string
    sessionId?: string
    isReturning?: boolean
    roomInfo?: {
      id: string
      name: string
      djName: string
      description?: string
      tags?: string[]
      listenerCount?: number
      isPublic?: boolean
    }
  } || {}

  // SolidJS 2025: Computed values from adapters (read-only)
  const connectionState = () => connectionAdapter.getConnectionState()
  const isConnecting = () => connectionState()?.webrtcConnectionState === WebrtcConnectionState.CONNECTING
  const connectionError = () => connectionAdapter.getError()
  const hasConnectionError = () => connectionAdapter.hasError()

  // Room information from params and navigation state
  const roomId = () => params.roomId
  const roomName = () => navigationState.roomInfo?.name || `Room ${roomId()}`
  const djName = () => navigationState.roomInfo?.djName || 'DJ'

  // Helper to convert ConnectionState to dot status
  const getDotStatus = () => {
    const state = connectionState()
    const webrtcState = state?.webrtcConnectionState
    if (webrtcState === WebrtcConnectionState.STREAMING) return 'streaming'
    if (webrtcState === WebrtcConnectionState.PAUSED) return 'paused'
    if (webrtcState === WebrtcConnectionState.ERROR) return 'error'
    if (webrtcState === WebrtcConnectionState.CONNECTED) return 'connected'
    if (webrtcState === WebrtcConnectionState.CONNECTING || webrtcState === WebrtcConnectionState.DISCONNECTING) return 'connecting'
    return 'disconnected'
  }

  // Helper to get status text for accessibility
  const getStatusText = () => {
    const state = connectionState()
    const webrtcState = state?.webrtcConnectionState
    if (webrtcState === WebrtcConnectionState.STREAMING) return 'LIVE'
    if (webrtcState === WebrtcConnectionState.PAUSED) return 'PAUSED'
    return webrtcState || 'DISCONNECTED'
  }

  // Audio stream is accessed directly via signal in template

  const needsUserPlay = () => {
    // Check if user interaction is needed for audio playback
    return connectionState()?.webrtcConnectionState === WebrtcConnectionState.CONNECTED
  }





  // SolidJS 2025: Use createResource for room joining
  const [joinRoomOperation] = createResource(async () => {
    const sessionId = navigationState.sessionId
    const listenerWebSocketUrl = navigationState.listenerWebSocketUrl
    const roomInfo = navigationState.roomInfo
    const isReturning = navigationState.isReturning

    if (!sessionId || !listenerWebSocketUrl) {
      console.error('Missing required data for listener join:', { sessionId, listenerWebSocketUrl })
      navigate('/')
      return null
    }
    
    console.info('🎧 Starting listener join flow via Application Service:', {
      roomId: roomId(),
      sessionId: sessionId,
      listenerWebSocketUrl: listenerWebSocketUrl,
      hasRoomInfo: !!roomInfo,
      isReturning: !!isReturning
    })
    
    const result = await listenerService.joinRoom(
      roomId(),
      sessionId,
      listenerWebSocketUrl
    )

    console.info('✅ Listener join flow completed successfully')
    return result
  })

  // Effect to set up audio playback when stream changes
  // createEffect(() => {
  //   const stream = currentStream()
  //   Option.match(stream, {
  //     onSome: (s) => setupAudioPlayback(s),
  //     onNone: () => {}
  //   })
  // })



  // SolidJS 2025: Use createResource for manual play
  const [manualPlayRequest, setManualPlayRequest] = createSignal<boolean>(false)
  
  const [manualPlayOperation] = createResource(manualPlayRequest, async (shouldPlay) => {
    if (!shouldPlay) return null
    
    const listenerId = roomId()
    if (!listenerId) {
      console.error('No listener ID available for manual play')
      return null
    }
    
    console.info('▶️ Handling manual play via Application Service')
    
    const result = await listenerService.handleManualPlay(listenerId)
    
    console.info('✅ Manual play completed successfully')
    return result
  })
  
  const handleManualPlay = () => {
    setManualPlayRequest(true)
    // Reset the signal after triggering
    setTimeout(() => setManualPlayRequest(false), 100)
  }

  // SolidJS 2025: Use createResource for leaving room
  const [leaveRoomRequest, setLeaveRoomRequest] = createSignal<boolean>(false)
  
  const [leaveRoomOperation] = createResource(leaveRoomRequest, async (shouldLeave) => {
    if (!shouldLeave) return null
    
    console.info('🚪 Initiating leave room flow via Application Service')
    
    const listenerId = roomId()
    if (listenerId) {
      console.info('📡 Calling leaveRoomAndNavigate Application Service')
      const result = await listenerService.leaveRoomAndNavigate(listenerId)
      console.info('✅ Leave room Application Service completed')
      
      // Navigate back to lobby after successful cleanup
      console.info('🔙 Navigating back to lobby')
      navigate('/')
      
      return result
    }
    
    // Navigate anyway if no listener ID
    navigate('/')
    return null
  })
  
  const leaveRoom = () => {
    setLeaveRoomRequest(true)
  }

  // Ensure this return block replaces your current broken return
  return (
    <div class="h-screen w-full bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 text-white flex flex-col items-center justify-center p-4 sm:p-6">

      {/* Audio managed by consumer service - no DOM element needed here */}

      {/* Connection Error Handler */}
      <WebRTCErrorHandler 
        error={connectionError()}
        show={hasConnectionError()}
        onDismiss={() => connectionAdapter.clearError()}
        onCancel={() => navigate('/')}
      />

      <Show when={isConnecting() || joinRoomOperation.loading}>
        <div class="card bg-white/10 backdrop-blur-sm border border-white/20">
          <div class="card-body text-center py-8">
            <div class="loading loading-spinner loading-lg mx-auto mb-4"></div>
            <div class="text-lg sm:text-xl font-bold">Connecting...</div>
          </div>
        </div>
      </Show>

      {/* Stream errors now handled by WebRTC error handler above */}
      
      {/* Join operation errors */}
      <Show when={joinRoomOperation.error}>
        <div class="fixed top-4 right-4 left-4 sm:left-auto sm:w-auto alert alert-error shadow-lg z-50">
          <span>Failed to join room: {joinRoomOperation.error.message}</span>
          <button 
            class="btn btn-sm btn-circle btn-ghost"
            onClick={() => navigate('/')}
          >
            ✕
          </button>
        </div>
      </Show>

      <Show when={!isConnecting() && !joinRoomOperation.loading && !joinRoomOperation.error}>
        <div class="card bg-white/10 backdrop-blur-sm border border-white/20 shadow-xl max-w-sm sm:max-w-md w-full mx-4">
          <div class="card-body flex flex-col items-center gap-6 sm:gap-8 p-4 sm:p-6">
            
            {/* Room Header */}
            <RoomHeader 
              roomName={roomName}
              djName={djName}
              variant="center"
            />

            {/* Status Indicator - single source of truth from connection state */}
            <ConnectionStatusGroup 
              status={getDotStatus}
              statusText={getStatusText}
              dotSize="lg"
              layout="vertical"
            />

            {/* Audio Oscilloscope - SolidJS 2025 reactive signal pattern */}
            <Show when={Option.getOrNull(audioClient.currentStream())} fallback={null}>
              {(stream) => (
                <div class="w-full">
                  <Oscilloscope 
                    stream={stream()}
                    height={60} 
                    class="mb-0"
                    userGestureAvailable={!needsUserPlay()}
                  />
                </div>
              )}
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
                      disabled={manualPlayOperation.loading}
                    >
                      {manualPlayOperation.loading ? (
                        <>
                          <span class="loading loading-spinner loading-sm"></span>
                          Resuming...
                        </>
                      ) : (
                        <>
                          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h2m4 0h2M7 7h10a2 2 0 012 2v8a2 2 0 01-2 2H7a2 2 0 01-2-2V9a2 2 0 012-2z" />
                          </svg>
                          Resume Audio
                        </>
                      )}
                    </button>
                    
                  </div>
                </div>
              </div>
            </Show>


            {/* Leave Button */}
            <button
                onClick={leaveRoom}
                class="btn btn-outline btn-sm sm:btn-md mt-4 w-full sm:w-auto border-red-500 text-red-500 hover:bg-red-500 hover:text-white"
                disabled={leaveRoomOperation.loading}
            >
                {leaveRoomOperation.loading ? (
                  <>
                    <span class="loading loading-spinner loading-sm mr-2"></span>
                    <span class="text-sm sm:text-base">Leaving...</span>
                  </>
                ) : (
                  <>
                    <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    <span class="text-sm sm:text-base">Leave Room</span>
                  </>
                )}
            </button>
            
            {/* Show leave operation errors */}
            <Show when={leaveRoomOperation.error}>
              <div class="text-red-400 text-sm text-center mt-2">
                Failed to leave room: {leaveRoomOperation.error.message}
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}
