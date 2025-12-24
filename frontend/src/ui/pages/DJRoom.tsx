import { onCleanup, Show, createSignal, createEffect, createResource } from 'solid-js'
import { useParams, useNavigate, useLocation } from '@solidjs/router'
import { Option as O } from 'effect'
import { DeviceSelector } from '../components/controls/DeviceSelector'
import { useConnectionAdapter, useUserAdapter, useLobbyAdapter, useAudioAdapter, useAudioClient } from '../../App'
import { useDJService } from '../hooks/useEffectService'
import { WebrtcConnectionState, WsConnectionState } from '../../domain/schemas/connection.schema'
import { Oscilloscope } from '../components/shared/Oscilloscope'
import { WebRTCErrorHandler } from '../components/WebRTCErrorHandler'
import { RoomHeader } from '../components/room/RoomHeader'
import { ConnectionStatusGroup } from '../components/streaming/ConnectionStatusGroup'
import { StreamControls } from '../components/streaming/StreamControls'

export default function DJRoom() {
  const params = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  // SolidJS 2025: Use Effect services through hooks
  const djService = useDJService()

  // Use adapters for reactive state (read-only)
  const connectionAdapter = useConnectionAdapter()
  const userAdapter = useUserAdapter()
  const lobbyAdapter = useLobbyAdapter()
  const audioAdapter = useAudioAdapter()
  const audioClient = useAudioClient()

  // Get navigation state (from Landing.tsx room creation)
  const navigationState = location.state as {
    djWebSocketUrl?: string
  } || {}

  const [isRedirecting, setIsRedirecting] = createSignal(false)

  // Router state guard - redirect to lobby if missing critical state  
  createEffect(() => {
    // Check if we have valid navigation state to be in DJ room
    if (!navigationState.djWebSocketUrl && connectionState()?.wsConnectionState === WsConnectionState.DISCONNECTED) {
      console.info('No valid DJ WebSocket URL detected, redirecting to lobby')
      setIsRedirecting(true)
      setTimeout(() => navigate('/'), 1000) // Brief delay to show redirect message
    }
  })


  // Component initialization completed - no async setup needed

  onCleanup(() => {
    // SolidJS 2025: Cleanup handled by SolidJS onCleanup
    console.info('🧹 DJRoom: Component cleanup')
  })

  // Computed values from domain adapters (SolidJS 2025 + Effect Option patterns)
  const connectionState = () => connectionAdapter.getConnectionState()
  const isStreaming = () => audioAdapter.isPlaying()
  const djError = () => audioAdapter.getError()
  const isConnecting = () => connectionAdapter.isConnecting()
  const isPaused = () => !audioAdapter.isPlaying()
  const selectedDeviceId = () => audioAdapter.getCurrentDeviceId()
  
  // Connection error state
  const connectionError = () => connectionAdapter.getError()
  const hasConnectionError = () => connectionAdapter.hasError()
  
  // SolidJS 2025: Use reactive computeds with proper Option handling
  const roomId = () => params.roomId
  
  // Use Show components for Optional room metadata in template
  const roomMetadata = () => connectionAdapter.getRoomMetadata()

  // Helper to convert ConnectionState to dot status
  const getDotStatus = () => {
    const state = connectionState()
    const webrtcState = state?.webrtcConnectionState
    if (webrtcState === WebrtcConnectionState.STREAMING && isPaused()) return 'paused'
    if (webrtcState === WebrtcConnectionState.STREAMING) return 'streaming'
    if (webrtcState === WebrtcConnectionState.PAUSED) return 'paused'
    if (webrtcState === WebrtcConnectionState.ERROR) return 'error'
    if (webrtcState === WebrtcConnectionState.CONNECTED) return 'setup'
    if (webrtcState === WebrtcConnectionState.CONNECTING || webrtcState === WebrtcConnectionState.DISCONNECTING) return 'connecting'
    return 'disconnected'
  }

  // Helper to get status text for accessibility
  const getStatusText = () => {
    const state = connectionState()
    const webrtcState = state?.webrtcConnectionState
    if (webrtcState === WebrtcConnectionState.STREAMING && isPaused()) return 'MUTED'
    if (webrtcState === WebrtcConnectionState.STREAMING) return 'LIVE'
    if (webrtcState === WebrtcConnectionState.CONNECTED) return 'SETUP'
    return webrtcState || 'DISCONNECTED'
  }

  // Audio stream is accessed directly via signal in template

  // SolidJS 2025: Use signals and createResource for streaming operations
  const [streamingRequest, setStreamingRequest] = createSignal<{roomId: string, deviceId: string} | null>(null)
  
  const [streamingOperation] = createResource(streamingRequest, async (request) => {
    if (!request) return null
    
    console.info('🎤 Starting DJ stream via Application Service...')
    
    const result = await djService.publishToRoom(
      request.roomId, 
      navigationState.djWebSocketUrl!, 
      request.deviceId
    )
    
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

  // SolidJS 2025: Use signals and createResource for mute operations
  const [muteRequest, setMuteRequest] = createSignal<{action: 'pause' | 'resume'} | null>(null)
  
  const [muteOperation] = createResource(muteRequest, async (request) => {
    if (!request || !isStreaming()) return null
    
    console.info(`🎤 ${request.action === 'pause' ? 'Pausing' : 'Resuming'} DJ stream...`)
    
    const result = await djService.controlStreaming(roomId(), request.action)
    
    console.info('✅ DJ stream toggled successfully')
    return result
  })
  
  const toggleMute = () => {
    if (!isStreaming()) return // Only allow mute when streaming
    
    const action = isPaused() ? 'resume' : 'pause'
    setMuteRequest({ action })
  }

  // SolidJS 2025: Use signals and createResource for ending stream
  const [endStreamRequest, setEndStreamRequest] = createSignal<boolean>(false)
  
  const [endStreamOperation] = createResource(endStreamRequest, async (shouldEnd) => {
    if (!shouldEnd) return null
    
    console.info('🚪 Ending stream and closing DJ room')
    
    const result = await djService.stopStreaming(roomId())
    
    console.info('✅ DJ room closed successfully')
    
    // Navigate back to lobby after successful cleanup
    navigate('/')
    return result
  })
  
  const endStream = () => {
    setEndStreamRequest(true)
  }

  const goBack = () => {
    navigate('/')
  }

  const onDeviceSelected = (deviceId: string) => {
    audioAdapter.setCurrentDeviceId(deviceId)
  }

  return (
    <div class="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 text-white p-4 sm:p-6">
      
      <div class="max-w-sm sm:max-w-md lg:max-w-lg mx-auto">
        <Show when={isRedirecting()}>
          <div class="card bg-white/10 backdrop-blur-sm border border-white/20">
            <div class="card-body text-center py-8">
              <div class="loading loading-spinner loading-lg mx-auto mb-4"></div>
              <div class="text-lg sm:text-xl font-bold">Returning to lobby...</div>
              <div class="text-sm text-white/70 mt-2">Please create a new room</div>
            </div>
          </div>
        </Show>

        <Show when={!isRedirecting() && isConnecting()}>
          <div class="card bg-white/10 backdrop-blur-sm border border-white/20">
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
          <div class="card bg-white/10 backdrop-blur-sm border border-white/20">
            <div class="card-body p-4 sm:p-6">
              
              {/* Room Header - SolidJS 2025: Use Show for Option metadata */}
              <Show 
                when={O.getOrNull(roomMetadata())} 
                fallback={
                  <RoomHeader 
                    roomName={() => `Room ${roomId()}`}
                    djName={() => 'DJ'}
                    variant="center"
                    class="mb-4 sm:mb-6"
                  />
                }
              >
                {(metadata) => (
                  <RoomHeader 
                    roomName={() => metadata.name}
                    djName={() => metadata.djName}
                    variant="center"
                    class="mb-4 sm:mb-6"
                  />
                )}
              </Show>
              <div class="flex justify-between items-center mb-4 sm:mb-6">
                <button class="btn btn-sm sm:btn-md btn-ghost text-white hover:bg-white/20" onClick={goBack}>←</button>
                <ConnectionStatusGroup 
                  status={getDotStatus}
                  statusText={getStatusText}
                  dotSize="md"
                  layout="horizontal"
                />
              </div>

              <DeviceSelector 
                disabled={isStreaming()} 
                audioAdapter={audioAdapter}
                onDeviceSelected={onDeviceSelected}
              />
              
              {/* Audio Oscilloscope - SolidJS 2025 reactive signal pattern */}
              <Show when={O.getOrNull(audioClient.currentStream())} fallback={null}>
                {(stream) => (
                  <div class="w-full mb-4">
                    <Oscilloscope stream={stream()} height={60} class="mb-0" />
                  </div>
                )}
              </Show>
              
              {/* Show Go Live button when not streaming */}
              <Show when={!isStreaming()}>
                <div class="text-center mt-4 sm:mt-6">
                  <button
                    class="btn btn-primary btn-md sm:btn-lg w-full sm:w-auto px-8"
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
                  <div class="text-xs sm:text-sm text-white/60 mt-2">
                    Select an audio source to get started
                  </div>
                </div>
              </Show>

              {/* Stream Controls */}
              <StreamControls 
                isStreaming={isStreaming}
                isPaused={isPaused}
                isDisabled={() => connectionState()?.webrtcConnectionState === WebrtcConnectionState.ERROR || isConnecting() || muteOperation.loading || endStreamOperation.loading}
                onToggleMute={toggleMute}
                onEndStream={endStream}
              />
              
              {/* Show operation loading states and errors */}
              <Show when={muteOperation.loading}>
                <div class="text-center text-sm text-white/70 mt-2">
                  <span class="loading loading-spinner loading-sm mr-2"></span>
                  {isPaused() ? 'Resuming...' : 'Pausing...'}
                </div>
              </Show>
              
              <Show when={endStreamOperation.loading}>
                <div class="text-center text-sm text-white/70 mt-2">
                  <span class="loading loading-spinner loading-sm mr-2"></span>
                  Ending stream...
                </div>
              </Show>
              
              <Show when={muteOperation.error}>
                <div class="text-red-400 text-sm text-center mt-2">
                  Failed to toggle mute: {muteOperation.error.message}
                </div>
              </Show>
              
              <Show when={endStreamOperation.error}>
                <div class="text-red-400 text-sm text-center mt-2">
                  Failed to end stream: {endStreamOperation.error.message}
                </div>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </div>
  )
}
