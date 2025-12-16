import { createSignal, onMount, onCleanup, Show, createEffect } from 'solid-js'
import { useParams, useNavigate } from '@solidjs/router'
import { Effect } from 'effect'
import { DeviceSelector } from '../components/controls/DeviceSelector'
import { createRoomStore } from '../../stores/room.store'
import { publishDJRoom } from '../../services/flows/dj-flows.service'

type StreamStatus = 'idle' | 'ready' | 'connecting' | 'live' | 'muted' | 'error'


export default function DJRoom() {
  const params = useParams()
  const navigate = useNavigate()

  // Use room store for DJ state management
  const roomStore = createRoomStore()

  // Get room data from route params
  const roomId = () => params.roomId
  const [status, setStatus] = createSignal<StreamStatus>('idle')
  const [error, setError] = createSignal<string | null>(null)
  const [isInitializing, setIsInitializing] = createSignal(true)
  const [selectedDeviceId, setSelectedDeviceId] = createSignal<string | undefined>()

  // Simple state - streaming state managed by flows
  const [isRecording, setIsRecording] = createSignal(false)
  
  // Device selection state
  const [deviceSelected, setDeviceSelected] = createSignal(false)
  const [isReadyToStream, setIsReadyToStream] = createSignal(false)

  // Connect to room WebSocket on mount (but don't start streaming automatically)
  onMount(async () => {
    try {
      setIsInitializing(false)
      setIsReadyToStream(true)
      setStatus('ready') // Set to ready when WebSocket connected
      
    } catch (err: any) {
      console.error('Failed to connect to room:', err)
      setError(err.message)
      setStatus('error')
      setIsInitializing(false)
      
    }
  })

  onCleanup(() => {
    // Cleanup handled by providers
  })

  // Effect to monitor room store DJ state and sync UI
  createEffect(() => {
    const djFlowStep = roomStore.djFlowStep
    
    // Update status based on DJ flow step
    switch (djFlowStep) {
      case 'idle':
        setStatus('idle')
        setIsInitializing(false)
        break
      case 'initializing':
      case 'connecting':
      case 'requesting_media':
      case 'creating_transport':
        setStatus('connecting')
        setIsInitializing(true)
        break
      case 'streaming':
        setStatus(roomStore.isPaused ? 'muted' : 'live')
        setIsInitializing(false)
        setIsReadyToStream(true)
        setError(null)
        break
      case 'error':
        setStatus('error')
        setIsInitializing(false)
        const errorMsg = roomStore.djError
        setError(typeof errorMsg === 'string' ? errorMsg : 'An error occurred')
        break
      default:
        setStatus('ready')
        setIsInitializing(false)
    }
    
    // Update device selection status
    setDeviceSelected(!!selectedDeviceId())
  })

  // Computed signal for streaming status
  const isStreaming = () => roomStore.isDJStreaming

  const startStreaming = async () => {
    const deviceId = selectedDeviceId()
    if (!deviceId) {
      setError('Please select an audio device first')
      return
    }

    const currentRoomId = roomId()
    if (!currentRoomId) {
      setError('Room ID is required')
      return
    }

    setIsInitializing(true)
    setStatus('connecting')
    setError(null)

    try {
      // Start DJ publishing flow - service will handle WebSocket connection
      const result = await Effect.runPromise(
        publishDJRoom(roomStore, currentRoomId, deviceId)
      )
      
      setIsRecording(true)
      console.log('DJ room published successfully:', result)

    } catch (err: any) {
      console.error('Failed to start streaming:', err)
      setError(err.message)
      setStatus('error')
      setIsInitializing(false)
    }
  }

  const toggleMute = async () => {
    if (!isRecording()) return // Only allow mute when recording

    try {
      if (roomStore.isPaused) {
        roomStore.actions.resumeStreaming()
      } else {
        roomStore.actions.pauseStreaming()
      }
    } catch (err: any) {
      console.error('Failed to toggle mute:', err)
      setError(err.message)
    }
  }

  const toggleRecording = async () => {
    if (!isRecording()) {
      // Start recording (same as current startStreaming)
      await startStreaming()
    } else {
      // Stop recording but keep connection
      try {
        roomStore.actions.pauseStreaming()
        setIsRecording(false)
        setStatus('ready')
      } catch (err: any) {
        console.error('Failed to stop recording:', err)
        setError(err.message)
      }
    }
  }

  const endStream = async () => {
    try {
      // Stop streaming and disconnect from room
      roomStore.actions.disconnectFromRoom()
      roomStore.actions.stopStreaming()
    } catch (error) {
      console.error('Failed to notify backend of room deletion:', error)
    }

    navigate('/')
  }

  const goBack = () => {
    navigate('/')
  }

  return (
    <div class="min-h-screen bg-base-100 p-4">
      
      <div class="max-w-md mx-auto">
        <Show when={isInitializing()}>
          <div class="card bg-base-200">
            <div class="card-body text-center">
              <div class="loading loading-spinner loading-lg mx-auto"></div>
              <h2>Connecting...</h2>
            </div>
          </div>
        </Show>

        <Show when={error()}>
          <div class="alert alert-error mb-4">
            <span>{error()}</span>
            <button class="btn btn-sm btn-circle" onClick={() => setError(null)}>✕</button>
          </div>
        </Show>

        <Show when={!isInitializing()}>
          <div class="card bg-base-200">
            <div class="card-body">
              <div class="flex justify-between items-center mb-4">
                <button class="btn btn-sm btn-ghost" onClick={goBack}>←</button>
                <div class={`badge ${
                  status() === 'live' ? 'badge-success' :
                  status() === 'muted' ? 'badge-warning' :
                  status() === 'error' ? 'badge-error' :
                  status() === 'ready' ? 'badge-info' :
                  'badge-ghost'
                }`}>
                  {status() === 'idle' ? 'SETUP' : status().toUpperCase()}
                </div>
              </div>

              <DeviceSelector 
                disabled={isStreaming()} 
                roomStore={roomStore} 
                onDeviceSelected={setSelectedDeviceId}
              />
              {/*
              <WaveformVisualizer stream={currentStream() || undefined} />
                */}
              
              {/* Show Go Live button when not streaming */}
              <Show when={!isStreaming()}>
                <div class="text-center mt-4">
                  <button
                    class="btn btn-primary btn-lg"
                    onClick={startStreaming}
                    disabled={!deviceSelected() || !isReadyToStream() || status() === 'connecting'}
                  >
                    {status() === 'connecting' ? (
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
                      isRecording() ? 'btn-error hover:btn-error' : 'btn-primary hover:btn-primary'
                    }`}
                    onClick={toggleRecording}
                    disabled={status() === 'error' || status() === 'connecting'}
                  >
                    {isRecording() ? (
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

                  {/* Secondary Controls - only visible when recording */}
                  <Show when={isRecording()}>
                    <div class="flex gap-3 items-center">
                      {/* Mute Button */}
                      <button
                        class={`btn btn-sm gap-2 ${
                          roomStore.isPaused ? 'btn-warning hover:btn-warning' : 'btn-success hover:btn-success'
                        }`}
                        onClick={toggleMute}
                        disabled={status() === 'error' || status() === 'connecting'}
                      >
                        {roomStore.isPaused ? (
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
