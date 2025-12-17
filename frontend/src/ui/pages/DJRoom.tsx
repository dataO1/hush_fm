import { onMount, onCleanup, Show } from 'solid-js'
import { useParams, useNavigate } from '@solidjs/router'
import { Effect, Option } from 'effect'
import { DeviceSelector } from '../components/controls/DeviceSelector'
import { createRoomStore } from '../../stores/room.store'
import { publishDJRoom, toggleDJStream, closeDJRoom } from '../../services/flows/dj-flows.service'
import { ConnectionState } from '../../domain/schemas/room.schema'
import type { DJState } from '../../domain/schemas/dj.schema'
import ConnectionStatusDot from '../components/ConnectionStatusDot'
import { Oscilloscope } from '../components/shared/Oscilloscope'

export default function DJRoom() {
  const params = useParams()
  const navigate = useNavigate()

  // Use room store for DJ state management - all state comes from here
  const roomStore = createRoomStore()

  // Get room data from route params
  const roomId = () => params.roomId

  // Initialize room as ready on mount
  onMount(async () => {
    try {
      // Room is ready for streaming setup
      roomStore.actions.setConnectionState(ConnectionState.IDLE)
    } catch (err: any) {
      console.error('Failed to initialize DJ room:', err)
      roomStore.actions.setConnectionState(ConnectionState.ERROR)
    }
  })

  onCleanup(() => {
    // Cleanup handled by store
  })

  // Computed values from store
  const connectionState = () => roomStore.connectionState
  const isStreaming = () => roomStore.isDJStreaming
  const djError = () => roomStore.djError
  const isConnecting = () => roomStore.isConnecting
  const isPaused = () => roomStore.isPaused
  const selectedDeviceId = () => roomStore.selectedDeviceId

  // Helper to convert ConnectionState to dot status
  const getDotStatus = () => {
    const state = connectionState()
    if (state === ConnectionState.STREAMING && isPaused()) return 'paused'
    if (state === ConnectionState.STREAMING) return 'streaming'
    if (state === ConnectionState.PAUSED) return 'paused'
    if (state === ConnectionState.ERROR) return 'error'
    if (state === ConnectionState.CONNECTED || state === ConnectionState.IDLE) return 'setup'
    if (state === ConnectionState.CONNECTING || state === ConnectionState.DISCONNECTING) return 'connecting'
    return 'disconnected'
  }

  // Helper to get status text for accessibility
  const getStatusText = () => {
    const state = connectionState()
    if (state === ConnectionState.STREAMING && isPaused()) return 'MUTED'
    if (state === ConnectionState.STREAMING) return 'LIVE'
    if (state === ConnectionState.IDLE) return 'SETUP'
    return state
  }

  // Get DJ audio stream from room store
  const djAudioStream = () => {
    const dj = roomStore.djState as DJState | null
    if (!dj) return null
    
    // Get stream from the DJ's streams state
    const streamsOption = dj.streams
    if (Option.isNone(streamsOption)) return null
    
    const streams = Option.getOrNull(streamsOption)
    if (!streams) return null
    
    return Option.getOrNull(streams.localStream) as MediaStream | null
  }

  const startStreaming = async () => {
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

    try {
      // Start DJ publishing flow - service will handle WebSocket connection and state
      await Effect.runPromise(
        publishDJRoom(roomStore, currentRoomId, String(deviceId))
      )

    } catch (err: any) {
      console.error('Failed to start streaming:', err)
      // Error state is handled by the store via the service
    }
  }

  const toggleMute = async () => {
    if (!isStreaming()) return // Only allow mute when streaming

    try {
      await Effect.runPromise(toggleDJStream(roomStore))
    } catch (err: any) {
      console.error('Failed to toggle mute:', err)
    }
  }

  const endStream = async () => {
    try {
      // Get DJ WebSocket from store  
      const djState = roomStore.djState as DJState | null
      if (!djState) {
        console.warn('No DJ state found for room closure')
        navigate('/')
        return
      }

      let djWebSocket: WebSocket | null = null
      Option.match(djState.websocket.websocket, {
        onSome: (ws) => { djWebSocket = ws as WebSocket },
        onNone: () => { djWebSocket = null }
      })
      
      if (!djWebSocket) {
        console.warn('No valid DJ WebSocket found for room closure')
        navigate('/')
        return
      }

      // Use proper cleanup service following the established pattern
      console.info('🚪 Ending stream and closing DJ room')
      await Effect.runPromise(closeDJRoom(roomStore, djWebSocket))
      console.info('✅ DJ room closed successfully')
      
      // Navigate back to lobby after successful cleanup
      navigate('/')
    } catch (error) {
      console.error('❌ Failed to end stream and close room:', error)
      // Navigate anyway to prevent stuck state
      navigate('/')
    }
  }

  const goBack = () => {
    navigate('/')
  }

  const onDeviceSelected = (deviceId: string) => {
    roomStore.actions.setSelectedDeviceId(deviceId)
  }

  return (
    <div class="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 text-white p-4 sm:p-6">
      
      <div class="max-w-sm sm:max-w-md lg:max-w-lg mx-auto">
        <Show when={isConnecting()}>
          <div class="card bg-white/10 backdrop-blur-sm border border-white/20">
            <div class="card-body text-center py-8">
              <div class="loading loading-spinner loading-lg mx-auto mb-4"></div>
              <h2 class="text-lg sm:text-xl">Connecting...</h2>
            </div>
          </div>
        </Show>

        <Show when={djError()}>
          <div class="alert alert-error mb-4 text-sm sm:text-base">
            <span>{String(djError() || 'An error occurred')}</span>
            <button class="btn btn-sm btn-circle" onClick={() => roomStore.actions.clearDJError()}>✕</button>
          </div>
        </Show>

        <Show when={!isConnecting()}>
          <div class="card bg-white/10 backdrop-blur-sm border border-white/20">
            <div class="card-body p-4 sm:p-6">
              <div class="flex justify-between items-center mb-4 sm:mb-6">
                <button class="btn btn-sm sm:btn-md btn-ghost text-white hover:bg-white/20" onClick={goBack}>←</button>
                <div class="flex items-center gap-2">
                  <ConnectionStatusDot 
                    connectionState={getDotStatus()}
                    size="md"
                    title={getStatusText()}
                  />
                  <span class="text-xs sm:text-sm font-medium">{getStatusText()}</span>
                </div>
              </div>

              <DeviceSelector 
                disabled={isStreaming()} 
                roomStore={roomStore} 
                onDeviceSelected={onDeviceSelected}
              />
              
              {/* Audio Oscilloscope - show when streaming with audio stream */}
              <Show when={isStreaming() && djAudioStream()}>
                <div class="w-full mb-4">
                  <Oscilloscope stream={djAudioStream()!} height={60} class="mb-0" />
                </div>
              </Show>
              
              {/* Show Go Live button when not streaming */}
              <Show when={!isStreaming()}>
                <div class="text-center mt-4 sm:mt-6">
                  <button
                    class="btn btn-primary btn-md sm:btn-lg w-full sm:w-auto px-8"
                    onClick={startStreaming}
                    disabled={!selectedDeviceId() || isConnecting()}
                  >
                    {isConnecting() ? (
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
                  <div class="text-xs sm:text-sm text-white/60 mt-2">
                    Select a microphone to get started
                  </div>
                </div>
              </Show>

              {/* Show streaming controls when streaming */}
              <Show when={isStreaming()}>
                <div class="flex flex-col sm:flex-row gap-3 justify-center items-center mt-6">
                  
                  {/* Mute/Unmute Button */}
                  <button
                    class={`btn btn-md sm:btn-lg gap-2 w-full sm:w-auto sm:min-w-32 ${
                      isPaused() ? 'btn-warning hover:btn-warning' : 'btn-success hover:btn-success'
                    }`}
                    onClick={toggleMute}
                    disabled={connectionState() === ConnectionState.ERROR || isConnecting()}
                  >
                    {isPaused() ? (
                      <>
                        <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                        </svg>
                        <span class="text-sm sm:text-base">Unmute</span>
                      </>
                    ) : (
                      <>
                        <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                        </svg>
                        <span class="text-sm sm:text-base">Mute</span>
                      </>
                    )}
                  </button>

                  {/* End Stream Button */}
                  <button 
                    class="btn btn-outline btn-error btn-md sm:btn-lg gap-2 w-full sm:w-auto border-red-500 text-red-500 hover:bg-red-500 hover:text-white" 
                    onClick={endStream}
                  >
                    <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    <span class="text-sm sm:text-base">End Stream</span>
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
