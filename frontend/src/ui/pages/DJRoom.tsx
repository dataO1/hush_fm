import { onCleanup, onMount, Show, createSignal, createEffect, createResource, createContext, useContext, ParentComponent } from 'solid-js'
import { useParams, useNavigate, useLocation } from '@solidjs/router'
import { Option as O, Effect, Context, ManagedRuntime, Layer } from 'effect'
import { DeviceSelector } from '../components/controls/DeviceSelector'
import { useConnectionAdapter, useAudioAdapter, useUserAdapter, useGlobalRuntime, useAudioClient } from '../../App'
import { UserService, UserServiceLive } from '../../services/application/UserService'
import { AudioClient } from '../../services/infrastructure/AudioClient'
import { AudioAdapter } from '../../stores/audio'
import { UserAdapter, ConnectionAdapter } from '../../stores'
// WebSocketClient is now provided directly via UserService, not imported here
import { WebrtcConnectionState, WsConnectionState } from '../../domain/schemas/connection.schema'
import { Oscilloscope } from '../components/shared/Oscilloscope'
import { WebRTCErrorHandler } from '../components/WebRTCErrorHandler'
import { RoomHeader } from '../components/room/RoomHeader'
import { ConnectionStatusGroup } from '../components/streaming/ConnectionStatusGroup'
import { StreamControls } from '../components/streaming/StreamControls'

// User Feature Service Context (for DJ operations)
interface UserFeatureContextValue {
  userService: Context.Tag.Service<UserService>
}

const UserFeatureContext = createContext<UserFeatureContextValue>()

const UserFeatureProvider: ParentComponent = (props) => {
  // Create user feature services using scoped runtime to keep them alive for component lifecycle
  // Provide all necessary adapter dependencies
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

function DJRoomContent() {
  const params = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  // SolidJS 2025: Use Effect services through hooks

  // Use adapters for reactive state (read-only)
  const connectionAdapter = useConnectionAdapter()
  const audioAdapter = useAudioAdapter()
  const globalRuntime = useGlobalRuntime()
  
  // Get scoped user feature services
  const { userService } = useUserFeature()
  
  // Get global audio client
  const audioClient = useAudioClient()

  // Get navigation state (from Landing.tsx room creation)
  const navigationState = location.state as {
    djWebSocketUrl?: string
    roomName?: string
    djName?: string
  } || {}

  const [isRedirecting, setIsRedirecting] = createSignal(false)

  // Router state guard - redirect to lobby if missing critical state  
  createEffect(() => {
    // Check if we have valid navigation state to be in DJ room
    if (!navigationState.djWebSocketUrl && connectionState()?.roomWsState === WsConnectionState.DISCONNECTED) {
      console.info('No valid DJ WebSocket URL detected, redirecting to lobby')
      setIsRedirecting(true)
      setTimeout(() => navigate('/'), 1000) // Brief delay to show redirect message
    }
  })

  // Connect to DJ WebSocket once on mount
  onMount(async () => {
    const djUrl = navigationState.djWebSocketUrl
    if (djUrl && !connectionAdapter.isConnecting() && !connectionAdapter.isRoomConnected()) {
      console.info('🔗 DJRoom: Connecting to DJ WebSocket on mount...', { djUrl })
      
      try {
        await userService.connect(djUrl).pipe(Effect.runPromise)
        console.info('✅ DJRoom: DJ WebSocket connected successfully')
      } catch (error) {
        console.error('❌ DJRoom: Failed to connect DJ WebSocket:', error)
      }
    }
  })

  // Component initialization completed

  onCleanup(async () => {
    // SolidJS 2025: Cleanup handled by SolidJS onCleanup
    console.info('🧹 DJRoom: Component cleanup - disconnecting user service')
    try {
      await userService.disconnect().pipe(Effect.runPromise)
    } catch (error) {
      console.warn('⚠️ DJRoom: Error during cleanup:', error)
    }
  })

  // Computed values from domain adapters (SolidJS 2025 + Effect Option patterns)
  const connectionState = () => connectionAdapter.getConnectionState()
  const isConnecting = () => connectionAdapter.isConnecting()
  const isPaused = () => !audioAdapter.isPlaying()
  const selectedDeviceId = () => audioAdapter.getCurrentDeviceId()
  
  // Connection error state  
  const connectionError = () => O.getOrNull(connectionAdapter.getError())
  const hasConnectionError = () => connectionAdapter.hasError()
  
  // SolidJS 2025: Use reactive computeds with proper Option handling
  const roomId = () => params.roomId
  
  // Use Show components for Optional room metadata in template
  // Note: Room metadata would come from a room adapter if needed

  // Get WebRTC state getter for connection dot
  const getWebrtcState = () => connectionState()?.webrtcConnectionState || WebrtcConnectionState.DISCONNECTED

  // Audio stream is accessed directly via signal in template

  // SolidJS 2025: Use signals and createResource for streaming operations
  const [streamingRequest, setStreamingRequest] = createSignal<{roomId: string, deviceId: string} | null>(null)
  
  const [streamingOperation] = createResource(streamingRequest, async (request) => {
    if (!request) return null
    
    console.info('🎤 Starting DJ stream via Application Service...')
    
    const result = await userService.publishDJRoom(
      request.roomId, 
      navigationState.djWebSocketUrl!, 
      request.deviceId
    ).pipe(Effect.runPromise)
    
    console.info('✅ DJ stream started successfully')
    return result
  })
  
  const startStreaming = () => {
    const deviceId = selectedDeviceId()
    if (!deviceId) {
      console.error('Please select an audio device first')
      return
    }

    const currentRoomId = roomId()
    if (!currentRoomId) {
      console.error('Room ID is required')
      return
    }
    
    // Trigger the resource by setting the signal
    setStreamingRequest({ roomId: currentRoomId, deviceId: String(deviceId) })
  }


  const goBack = () => {
    navigate('/')
  }

  return (
    <div class="min-h-screen bg-hush-main text-gruvbox-fg p-4 sm:p-6">
      
      <div class="max-w-sm sm:max-w-md lg:max-w-lg mx-auto">
        <Show when={isRedirecting()}>
          <div class="card card-glass">
            <div class="card-body text-center py-8">
              <div class="loading loading-spinner loading-lg mx-auto mb-4"></div>
              <div class="text-lg sm:text-xl font-bold">Returning to lobby...</div>
              <div class="text-sm text-gruvbox-fg-3 mt-2">Please create a new room</div>
            </div>
          </div>
        </Show>

        <Show when={!isRedirecting() && isConnecting()}>
          <div class="card card-glass">
            <div class="card-body text-center py-8">
              <div class="loading loading-spinner loading-lg mx-auto mb-4"></div>
              <h2 class="text-lg sm:text-xl">Connecting...</h2>
            </div>
          </div>
        </Show>

        {/* Stream errors now handled globally in AppLayout */}

        {/* WebRTC Error Handler */}
        <WebRTCErrorHandler 
          error={connectionError()}
          show={hasConnectionError()}
          onDismiss={() => connectionAdapter.clearError()}
          onCancel={() => navigate('/')}
        />

        <Show when={!isRedirecting() && !isConnecting()}>
          <div class="card card-glass">
            <div class="card-body p-4 sm:p-6">
              
              {/* Back Button */}
              <div class="flex justify-start mb-4">
                <button class="btn btn-sm sm:btn-md btn-ghost text-gruvbox-fg hover:bg-gruvbox-bg-2/60" onClick={goBack}>←</button>
              </div>

              {/* Room Header */}
              <RoomHeader 
                roomName={() => navigationState.roomName || `Room ${roomId()}`}
                variant="center"
              />

              {/* Status Indicator - single source of truth from connection state */}
              <ConnectionStatusGroup 
                webrtcState={getWebrtcState}
                isPaused={isPaused}
                dotSize="lg"
                layout="vertical"
              />

              {/* Show DeviceSelector only when WebRTC is not connected */}
              <Show when={!connectionAdapter.isConnected()}>
                <DeviceSelector 
                  getAudioDevices={async () => await globalRuntime.runPromise(
                    Effect.provideService(audioClient.getAudioDevices(), AudioAdapter, audioAdapter)
                  )}
                  selectDevice={async (deviceId) => await globalRuntime.runPromise(
                    Effect.provideService(audioClient.selectDevice(deviceId), AudioAdapter, audioAdapter)
                  )}
                />
              </Show>
              
              {/* Audio Oscilloscope - SolidJS 2025 reactive signal pattern */}
              <Show when={O.getOrNull(audioClient.currentStream())} fallback={null}>
                {(stream) => (
                  <div class="w-full">
                    <Oscilloscope stream={stream()} height={60} class="mb-0" />
                  </div>
                )}
              </Show>
              
              {/* Show Go Live button when not connected and not connecting */}
              <Show when={!connectionAdapter.isConnected() && !isConnecting()}>
                <div class="text-center mt-4 sm:mt-6">
                  <button
                    class={`btn btn-md sm:btn-lg w-full sm:w-auto px-8 ${
                      !selectedDeviceId() || isConnecting() || streamingOperation.loading 
                        ? 'btn-disabled opacity-50 cursor-not-allowed' 
                        : 'btn-primary hover:btn-primary-focus'
                    }`}
                    onClick={startStreaming}
                    disabled={!selectedDeviceId() || isConnecting() || streamingOperation.loading}
                  >
                    {(isConnecting() || streamingOperation.loading) ? (
                      <>
                        <span class="loading loading-spinner loading-sm"></span>
                        <span class="ml-2">Connecting...</span>
                      </>
                    ) : (
                      <>
                        <svg class="w-4 h-4 sm:w-5 sm:h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h2m4 0h2M7 7h10a2 2 0 012 2v8a2 2 0 01-2 2H7a2 2 0 01-2-2V9a2 2 0 012-2z" />
                        </svg>
                        Go Live
                      </>
                    )}
                  </button>
                  
                  {/* Show streaming operation errors */}
                  <Show when={streamingOperation.error}>
                    <div class="text-red-400 text-sm mt-2">
                      Failed to start streaming: {streamingOperation.error.message}
                    </div>
                  </Show>
                  <div class="text-xs sm:text-sm text-gruvbox-fg-3 mt-2">
                    <Show when={!selectedDeviceId()} fallback="Ready to go live">
                      Select an audio source to get started
                    </Show>
                  </div>
                </div>
              </Show>

              {/* Stream Controls - only show when connected */}
              <Show when={connectionAdapter.isConnected()}>
                <StreamControls 
                  toggleMute={async () => {
                    // Send pause/resume command to server as oneshot command
                    const isPausedNow = isPaused()
                    try {
                      if (isPausedNow) {
                        await userService.resumeStream().pipe(Effect.runPromise)
                      } else {
                        await userService.pauseStream().pipe(Effect.runPromise)
                      }
                    } catch (error) {
                      console.error('❌ Failed to toggle mute:', error)
                    }
                  }}
                  endStream={async () => {
                    await userService.closeDJRoom().pipe(Effect.runPromise)
                    navigate('/')
                  }}
                  isPaused={isPaused}
                />
              </Show>
              
            </div>
          </div>
        </Show>
      </div>
    </div>
  )
}

export default function DJRoom() {
  return (
    <UserFeatureProvider>
      <DJRoomContent />
    </UserFeatureProvider>
  )
}
