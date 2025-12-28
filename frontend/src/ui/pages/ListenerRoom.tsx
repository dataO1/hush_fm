import { Show, createResource, createSignal, onCleanup, createContext, useContext, ParentComponent } from 'solid-js'
import { useParams, useNavigate, useLocation } from '@solidjs/router'
import { Option, Effect, Context, ManagedRuntime, Layer } from 'effect'
import { useConnectionAdapter, useAudioAdapter, useUserAdapter, useAudioClient } from '../../App'
import { UserService, UserServiceLive } from '../../services/application/UserService'
import { AudioClient } from '../../services/infrastructure/AudioClient'
import { AudioAdapter } from '../../stores/audio'
import { UserAdapter, ConnectionAdapter } from '../../stores'
import { WebrtcConnectionState } from '../../domain/schemas/connection.schema'
import { Oscilloscope } from '../components/shared/Oscilloscope'
import { WebRTCErrorHandler } from '../components/WebRTCErrorHandler'
import { RoomHeader } from '../components/room/RoomHeader'
import { ConnectionStatusGroup } from '../components/streaming/ConnectionStatusGroup'
import { UserInteractionModal } from '../components/UserInteractionModal'
import { config } from '../../config'

// Utility function to construct WebSocket URLs from route params  
const constructListenerWebSocketUrl = (roomId: string, sessionId: string): string => {
  return `${config.websocket.baseUrl}/ws/listener/${roomId}/${sessionId}`
}

// User Feature Service Context (for Listener operations) - only User service needed
interface UserFeatureContextValue {
  userService: Context.Tag.Service<UserService>
}

const UserFeatureContext = createContext<UserFeatureContextValue>()

const UserFeatureProvider: ParentComponent = (props) => {
  // Create user feature services using scoped runtime to keep them alive for component lifecycle
  // Provide all necessary adapter dependencies (same pattern as DJRoom)
  const userAdapter = useUserAdapter()
  const connectionAdapter = useConnectionAdapter()
  const audioAdapter = useAudioAdapter()
  const audioClient = useAudioClient()
  
  const userServiceRuntime = ManagedRuntime.make(
    UserServiceLive.pipe(
      Layer.provide(Layer.succeed(UserAdapter, userAdapter)),
      Layer.provide(Layer.succeed(ConnectionAdapter, connectionAdapter)),
      Layer.provide(Layer.succeed(AudioAdapter, audioAdapter)),
      Layer.provide(Layer.succeed(AudioClient, audioClient))
    )
  )
  
  const userService = userServiceRuntime.runSync(UserService)
  
  const services: UserFeatureContextValue = {
    userService
  }
  
  // Cleanup on unmount
  onCleanup(async () => {
    console.info('🏠 UserFeatureProvider: Cleaning up on unmount')
    try {
      await userService.disconnect().pipe(Effect.runPromise)
      await userServiceRuntime.dispose()
    } catch (error) {
      console.warn('⚠️ UserFeatureProvider: Error during cleanup:', error)
    }
  })
  
  return (
    <UserFeatureContext.Provider value={services}>
      {props.children}
    </UserFeatureContext.Provider>
  )
}

const useUserFeature = () => {
  const context = useContext(UserFeatureContext)
  if (!context) {
    throw new Error('useUserFeature must be used within UserFeatureProvider')
  }
  return context
}


function ListenerRoomContent() {
  const params = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  // SolidJS 2025: Use Effect services through hooks
  // Use adapters for reactive state (read-only)
  const connectionAdapter = useConnectionAdapter()
  const audioAdapter = useAudioAdapter()
  const userAdapter = useUserAdapter()
  
  // Get scoped user feature services
  const { userService } = useUserFeature()
  
  // Get global audio client
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
  const connectionError = () => Option.getOrNull(connectionAdapter.getError())
  const hasConnectionError = () => connectionAdapter.hasError()

  // Room information from params and navigation state
  const roomId = () => params.roomId
  const roomName = () => navigationState.roomInfo?.name || `Room ${roomId()}`

  // Get WebRTC state getter for connection dot
  const getWebrtcState = () => connectionState()?.webrtcConnectionState || WebrtcConnectionState.DISCONNECTED

  // Audio stream is accessed directly via signal in template

  // SolidJS 2025: Use createResource for room joining with connection setup
  const [joinRoomOperation] = createResource(async () => {
    let sessionId = navigationState.sessionId
    let listenerWebSocketUrl = navigationState.listenerWebSocketUrl
    const roomInfo = navigationState.roomInfo
    const isReturning = navigationState.isReturning
    const currentRoomId = roomId()

    // Handle missing data (direct URL access or reload)
    if (!sessionId || !listenerWebSocketUrl) {
      console.info('🔄 ListenerRoom: Missing session data, inferring from URL...', {
        roomId: currentRoomId,
        hasSessionId: !!sessionId,
        hasWebSocketUrl: !!listenerWebSocketUrl
      })
      
      // Use existing session ID from user adapter (global session)
      if (!sessionId) {
        const existingSessionId = userAdapter.getSessionId()
        if (Option.isSome(existingSessionId)) {
          sessionId = existingSessionId.value
          console.info('🆔 ListenerRoom: Using existing session ID from user adapter:', sessionId)
        } else {
          console.error('❌ ListenerRoom: No session ID available - user not initialized')
          navigate('/')
          return null
        }
      }
      
      // Construct WebSocket URL directly from route params (no lobby service needed)
      try {
        listenerWebSocketUrl = constructListenerWebSocketUrl(currentRoomId, sessionId)
        console.info('✅ ListenerRoom: Constructed listener WebSocket URL from route params:', listenerWebSocketUrl)
        
      } catch (error) {
        console.error('❌ ListenerRoom: Failed to construct listener connection URL:', error)
        navigate('/')
        return null
      }
    }
    
    console.info('🎧 Starting listener join flow via Application Service:', {
      roomId: currentRoomId,
      sessionId: sessionId,
      listenerWebSocketUrl: listenerWebSocketUrl,
      hasRoomInfo: !!roomInfo,
      isReturning: !!isReturning
    })
    
    // Connect to WebSocket and start join flow - services handle internal state/checks
    console.info('🔗 ListenerRoom: Connecting to listener WebSocket...', { listenerWebSocketUrl })
    await userService.connect(listenerWebSocketUrl).pipe(Effect.runPromise)
    console.info('✅ ListenerRoom: Listener WebSocket connected successfully')
    
    // Start the join flow
    const result = await userService.joinRoomAsListener(
      currentRoomId, 
      sessionId
    ).pipe(Effect.runPromise)

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




  // SolidJS 2025: Use createResource for leaving room
  const [leaveRoomRequest, setLeaveRoomRequest] = createSignal<boolean>(false)
  
  const [leaveRoomOperation] = createResource(leaveRoomRequest, async (shouldLeave) => {
    if (!shouldLeave) return null
    
    console.info('🚪 Initiating leave room flow via Application Service')
    
    const listenerId = roomId()
    if (listenerId) {
      console.info('📡 Calling leaveRoomAndNavigate Application Service')
      
      const result = await userService.leaveListenerRoom(listenerId).pipe(Effect.runPromise)
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

  // Cleanup on component unmount
  onCleanup(async () => {
    console.info('🧹 ListenerRoom: Component cleanup - disconnecting user service')
    try {
      await userService.disconnect().pipe(Effect.runPromise)
    } catch (error) {
      console.warn('⚠️ ListenerRoom: Error during cleanup:', error)
    }
  })

  // Ensure this return block replaces your current broken return
  return (
    <div class="h-screen w-full bg-hush-main text-gruvbox-fg flex flex-col items-center justify-center p-4 sm:p-6">

      {/* Audio managed by consumer service - no DOM element needed here */}

      {/* Connection Error Handler */}
      <WebRTCErrorHandler 
        error={connectionError()}
        show={hasConnectionError()}
        onDismiss={() => connectionAdapter.clearError()}
        onCancel={() => navigate('/')}
      />

      <div class="card card-glass shadow-xl max-w-sm sm:max-w-md w-full mx-4">
        <div class="card-body flex flex-col items-center gap-6 sm:gap-8 p-4 sm:p-6">

          {/* Join operation errors */}
          <Show when={joinRoomOperation.error}>
            <div class="w-full space-y-4">
              <div class="error-panel px-4 py-3 rounded-lg w-full">
                <div class="flex justify-between items-center">
                  <span class="text-sm">Failed to join room: {joinRoomOperation.error.message}</span>
                  <button 
                    class="text-gruvbox-red-bright hover:text-gruvbox-fg ml-4"
                    onClick={() => navigate('/')}
                  >
                    ✕
                  </button>
                </div>
              </div>
              
              <div class="text-center">
                <button
                  onClick={() => navigate('/')}
                  class="btn btn-outline btn-sm sm:btn-md w-36 sm:w-40 border-gruvbox-fg-2 text-gruvbox-fg-1 hover:bg-gruvbox-fg-2 hover:text-gruvbox-bg-hard"
                >
                  <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                  Back
                </button>
              </div>
            </div>
          </Show>

          <Show when={isConnecting() || joinRoomOperation.loading}>
            <div class="text-center py-8">
              <div class="loading loading-spinner loading-lg mx-auto mb-4"></div>
              <div class="text-lg sm:text-xl font-bold">Connecting...</div>
            </div>
          </Show>

          <Show when={!isConnecting() && !joinRoomOperation.loading && !joinRoomOperation.error}>
            
            {/* Room Header */}
            <RoomHeader 
              roomName={roomName}
              variant="center"
            />

            {/* Status Indicator - single source of truth from connection state */}
            <ConnectionStatusGroup 
              webrtcState={getWebrtcState}
              dotSize="lg"
              layout="vertical"
            />

            {/* Audio Oscilloscope - only show when stream exists AND user interaction is available */}
            <Show when={!audioAdapter.requiresUserGesture() && Option.getOrNull(audioClient.currentStream())} fallback={null}>
              {(stream) => (
                <div class="w-full">
                  <Oscilloscope 
                    stream={stream()}
                    height={60} 
                    class="mb-0"
                  />
                </div>
              )}
            </Show>

            {/* User Interaction Modal */}
            <UserInteractionModal
              requiresUserInteraction={audioAdapter.requiresUserGesture()}
              roomName={roomName()}
              onEnableAudio={async () => {
                try {
                  // Clear the requiresUserGesture flag and try to resume audio playback
                  audioAdapter.updateStreamState({ requiresUserGesture: false })
                  
                  // Try to resume the stream if there's one available
                  const currentStream = audioClient.currentStream()
                  if (Option.isSome(currentStream)) {
                    console.info('🔊 ListenerRoom: Attempting to resume audio after user interaction')
                    await audioClient.connectRemoteStream(currentStream.value).pipe(
                      Effect.provideService(AudioAdapter, audioAdapter),
                      Effect.runPromise
                    )
                  }
                } catch (error) {
                  console.error('❌ Failed to enable audio after user interaction:', error)
                }
              }}
              onCancel={() => navigate('/')}
            />


            {/* Leave Button */}
            <button
                onClick={leaveRoom}
                class="btn btn-outline btn-sm sm:btn-md mt-4 w-36 sm:w-40 border-gruvbox-red-bright text-gruvbox-red-bright hover:bg-gruvbox-red-bright hover:text-gruvbox-bg-hard gap-2"
                disabled={leaveRoomOperation.loading}
            >
                {leaveRoomOperation.loading ? (
                  <>
                    <span class="loading loading-spinner loading-sm"></span>
                    <span class="text-sm sm:text-base">Leaving...</span>
                  </>
                ) : (
                  <>
                    <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    <span class="text-sm sm:text-base">Leave</span>
                  </>
                )}
            </button>
            
            {/* Show leave operation errors */}
            <Show when={leaveRoomOperation.error}>
              <div class="text-red-400 text-sm text-center mt-2">
                Failed to leave room: {leaveRoomOperation.error.message}
              </div>
            </Show>

          </Show>
        </div>
      </div>
    </div>
  )
}

export default function ListenerRoom() {
  return (
    <UserFeatureProvider>
      <ListenerRoomContent />
    </UserFeatureProvider>
  )
}
