import { onMount, onCleanup, Show } from 'solid-js'
import { useParams, useNavigate } from '@solidjs/router'
import { Effect, Option } from 'effect'
import { DeviceSelector } from '../components/controls/DeviceSelector'
import { createRoomStore } from '../../stores/room.store'
import { publishDJRoom } from '../../services/flows/dj-flows.service'
import { Oscilloscope } from '../components/shared/Oscilloscope'
import { ConnectionState } from '../../domain/schemas/room.schema'

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

  // Get DJ source audio stream from room store
  const djSourceStream = () => {
    const dj = roomStore.djState as any
    if (!dj?.streams) return undefined
    
    const streams = Option.getOrUndefined(dj.streams) as any
    if (!streams?.localStream) return undefined
    
    return Option.getOrUndefined(streams.localStream) as MediaStream | undefined
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
      const result = await Effect.runPromise(
        publishDJRoom(roomStore, currentRoomId, String(deviceId))
      )
      
      console.log('DJ room published successfully:', result)

    } catch (err: any) {
      console.error('Failed to start streaming:', err)
      // Error state is handled by the store via the service
    }
  }

  const toggleMute = async () => {
    if (!isStreaming()) return // Only allow mute when streaming

    try {
      if (isPaused()) {
        roomStore.actions.resumeStreaming()
      } else {
        roomStore.actions.pauseStreaming()
      }
    } catch (err: any) {
      console.error('Failed to toggle mute:', err)
    }
  }

  const toggleRecording = async () => {
    if (!isStreaming()) {
      // Start recording (same as current startStreaming)
      await startStreaming()
    } else {
      // Stop recording but keep connection
      try {
        roomStore.actions.pauseStreaming()
      } catch (err: any) {
        console.error('Failed to stop recording:', err)
      }
    }
  }

  const endStream = async () => {
    try {
      // Stop streaming and disconnect from room
      roomStore.actions.stopStreaming()
      roomStore.actions.disconnectFromRoom()
    } catch (error) {
      console.error('Failed to end stream:', error)
    }

    navigate('/')
  }

  const goBack = () => {
    navigate('/')
  }

  const onDeviceSelected = (deviceId: string) => {
    roomStore.actions.setSelectedDeviceId(deviceId)
  }

  return (
    <div class="min-h-screen bg-base-100 p-4">
      
      <div class="max-w-md mx-auto">
        <Show when={isConnecting()}>
          <div class="card bg-base-200">
            <div class="card-body text-center">
              <div class="loading loading-spinner loading-lg mx-auto"></div>
              <h2>Connecting...</h2>
            </div>
          </div>
        </Show>

        <Show when={djError()}>
          <div class="alert alert-error mb-4">
            <span>{String(djError() || 'An error occurred')}</span>
            <button class="btn btn-sm btn-circle" onClick={() => roomStore.actions.clearDJError()}>✕</button>
          </div>
        </Show>

        <Show when={!isConnecting()}>
          <div class="card bg-base-200">
            <div class="card-body">
              <div class="flex justify-between items-center mb-4">
                <button class="btn btn-sm btn-ghost" onClick={goBack}>←</button>
                <div class={`badge ${
                  connectionState() === ConnectionState.STREAMING && !isPaused() ? 'badge-success' :
                  connectionState() === ConnectionState.PAUSED ? 'badge-warning' :
                  connectionState() === ConnectionState.ERROR ? 'badge-error' :
                  connectionState() === ConnectionState.CONNECTED || connectionState() === ConnectionState.IDLE ? 'badge-info' :
                  'badge-ghost'
                }`}>
                  {connectionState() === ConnectionState.IDLE ? 'SETUP' : 
                   connectionState() === ConnectionState.STREAMING && isPaused() ? 'MUTED' :
                   connectionState() === ConnectionState.STREAMING ? 'LIVE' :
                   connectionState()}
                </div>
              </div>

              <DeviceSelector 
                disabled={isStreaming()} 
                roomStore={roomStore} 
                onDeviceSelected={onDeviceSelected}
              />
              
              {/* Audio Oscilloscope - show when streaming with source */}
              <Show when={isStreaming() && djSourceStream()}>
                <Oscilloscope 
                  stream={djSourceStream()} 
                  height={80}
                  class="w-full"
                />
              </Show>
              
              {/* Show Go Live button when not streaming */}
              <Show when={!isStreaming()}>
                <div class="text-center mt-4">
                  <button
                    class="btn btn-primary btn-lg"
                    onClick={startStreaming}
                    disabled={!selectedDeviceId() || isConnecting()}
                  >
                    {isConnecting() ? (
                      <>
                        <span class="loading loading-spinner loading-sm"></span>
                        Connecting...
                      </>
                    ) : (
                      'Go Live'
                    )}
                  </button>
                  <div class="text-sm text-base-content/60 mt-2">
                    Select a microphone to get started
                  </div>
                </div>
              </Show>

              {/* Show recording controls when streaming */}
              <Show when={isStreaming()}>
                <div class="flex flex-col gap-4 items-center mt-6">
                  
                  {/* Main Record/Stop Button */}
                  <button
                    class={`btn btn-lg gap-3 min-w-32 ${
                      isStreaming() ? 'btn-error hover:btn-error' : 'btn-primary hover:btn-primary'
                    }`}
                    onClick={toggleRecording}
                    disabled={connectionState() === ConnectionState.ERROR || isConnecting()}
                  >
                    {isStreaming() ? (
                      <>
                        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                          <rect x="6" y="6" width="12" height="12" rx="2"/>
                        </svg>
                        Stop
                      </>
                    ) : (
                      <>
                        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                          <circle cx="12" cy="12" r="6"/>
                        </svg>
                        Record
                      </>
                    )}
                  </button>

                  {/* Secondary Controls - only visible when streaming */}
                  <Show when={isStreaming()}>
                    <div class="flex gap-3 items-center">
                      {/* Mute Button */}
                      <button
                        class={`btn btn-sm gap-2 ${
                          isPaused() ? 'btn-warning hover:btn-warning' : 'btn-success hover:btn-success'
                        }`}
                        onClick={toggleMute}
                        disabled={connectionState() === ConnectionState.ERROR || isConnecting()}
                      >
                        {isPaused() ? (
                          <>
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                            </svg>
                            Muted
                          </>
                        ) : (
                          <>
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                            </svg>
                            Live
                          </>
                        )}
                      </button>

                      {/* End Stream Button */}
                      <button 
                        class="btn btn-outline btn-error btn-sm gap-2" 
                        onClick={endStream}
                      >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        End Stream
                      </button>
                    </div>
                  </Show>
                  
                </div>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </div>
  )
}
