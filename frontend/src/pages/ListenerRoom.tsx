import { createSignal, onMount, onCleanup, Show } from 'solid-js'
import { useParams, useNavigate } from '@solidjs/router'
import { Effect } from 'effect'
import { joinRoomFlow } from '../effects/webrtc-flows'
import { StreamStatusBadge, type StreamStatus } from '../components/shared/StreamStatusBadge'
import { AudioVisualizer } from '../components/shared/AudioVisualizer'
import { VolumeControls } from '../components/controls/VolumeControls'

export default function ListenerRoom() {
  const params = useParams()
  const navigate = useNavigate()
  
  const [roomId] = createSignal(params.roomId)
  const [roomName, setRoomName] = createSignal('')
  const [status, setStatus] = createSignal<StreamStatus>('connecting')
  const [volume, setVolume] = createSignal(0.8)
  const [isMuted, setIsMuted] = createSignal(false)
  const [listenerCount, setListenerCount] = createSignal(0)
  const [audioStream, setAudioStream] = createSignal<MediaStream>()
  const [error, setError] = createSignal<string | null>(null)
  const [isInitializing, setIsInitializing] = createSignal(true)

  let consumer: any = null
  let transport: any = null
  let audioElement: HTMLAudioElement | undefined

  onMount(() => {
    joinRoom()
  })

  onCleanup(() => {
    cleanup()
  })

  const joinRoom = async () => {
    setIsInitializing(true)
    setStatus('connecting')
    setError(null)

    const program = Effect.gen(function* (_) {
      // The joinRoomFlow handles the entire listener workflow
      const result = yield* _(joinRoomFlow(roomId()))
      
      return result
    })

    try {
      const result = await Effect.runPromise(program)
      
      // Store references for controls
      consumer = result.consumer
      transport = result.transport
      
      if (result.consumer && result.consumer.track) {
        // Create audio stream from the received track
        const stream = new MediaStream([result.consumer.track])
        setAudioStream(stream)
        
        // Set up audio playback
        setupAudioPlayback(stream)
      }
      
      setStatus('live')
      setIsInitializing(false)
      setRoomName(`Room ${roomId()}`)
      
      // Set up WebSocket for real-time updates
      setupRealtimeUpdates()
      
    } catch (err: any) {
      console.error('Failed to join room:', err)
      if (err.status === 404) {
        setError('Room not found or no stream available')
      } else {
        setError(`Failed to join room: ${err.message}`)
      }
      setStatus('error')
      setIsInitializing(false)
    }
  }

  const setupAudioPlayback = (stream: MediaStream) => {
    try {
      // Create audio element for playback
      audioElement = new Audio()
      audioElement.srcObject = stream
      audioElement.autoplay = true
      audioElement.volume = isMuted() ? 0 : volume()
      
    } catch (err) {
      console.error('Failed to set up audio playback:', err)
    }
  }

  const setupRealtimeUpdates = () => {
    // TODO: Connect to WebSocket for real-time listener count updates
    // This would typically connect to the room's WebSocket endpoint
    // and listen for DJ status changes and listener count updates
    
    // Simulate listener count for demo
    setListenerCount(Math.floor(Math.random() * 10) + 1)
  }

  const handleVolumeChange = (newVolume: number) => {
    setVolume(newVolume)
    if (audioElement && !isMuted()) {
      audioElement.volume = newVolume
    }
  }

  const toggleMute = () => {
    const newMuted = !isMuted()
    setIsMuted(newMuted)
    
    if (audioElement) {
      audioElement.volume = newMuted ? 0 : volume()
    }
  }

  const leaveRoom = () => {
    cleanup()
    navigate('/')
  }

  const cleanup = () => {
    if (consumer) {
      consumer.close()
      consumer = null
    }
    
    if (transport) {
      transport.close()
      transport = null
    }

    if (audioElement) {
      audioElement.pause()
      audioElement.srcObject = null
      audioElement = undefined
    }

    const stream = audioStream()
    if (stream) {
      stream.getTracks().forEach(track => track.stop())
      setAudioStream(undefined)
    }
  }

  const goBack = () => {
    navigate('/')
  }

  return (
    <div class="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100">
      {/* Header */}
      <header class="bg-white/80 backdrop-blur-lg border-b border-white/20">
        <div class="max-w-4xl mx-auto px-6 py-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-4">
              <button
                onClick={goBack}
                class="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                title="Back to Lobby"
              >
                <span class="text-xl">←</span>
              </button>
              <div>
                <h1 class="text-xl font-bold text-gray-800">
                  🎧 Listener Mode
                </h1>
                <p class="text-sm text-gray-600">{roomName()}</p>
              </div>
            </div>
            
            <StreamStatusBadge status={status()} listenerCount={listenerCount()} />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main class="max-w-4xl mx-auto px-6 py-8">
        <Show when={error()}>
          <div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            <div class="flex items-center justify-between">
              <span>{error()}</span>
              <button 
                onClick={() => setError(null)}
                class="text-red-500 hover:text-red-700"
              >
                ✕
              </button>
            </div>
          </div>
        </Show>

        <Show when={isInitializing()}>
          <div class="text-center py-12">
            <div class="bg-white/70 backdrop-blur-sm rounded-2xl p-8 border border-white/30 shadow-lg max-w-md mx-auto">
              <div class="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
              <h2 class="text-xl font-semibold text-gray-800 mb-2">
                Connecting to Stream
              </h2>
              <p class="text-gray-600 mb-4">
                Finding the DJ and setting up audio connection...
              </p>
              <div class="text-sm text-gray-500">
                <div class="flex items-center justify-center gap-2">
                  <div class="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                  <span>This may take a few moments</span>
                </div>
              </div>
            </div>
          </div>
        </Show>

        <Show when={!isInitializing() && status() === 'connecting'}>
          <div class="text-center py-12">
            <div class="bg-white/70 backdrop-blur-sm rounded-2xl p-8 border border-white/30 shadow-lg max-w-md mx-auto">
              <div class="text-6xl mb-6">⏸️</div>
              <h2 class="text-xl font-semibold text-gray-800 mb-2">
                Waiting for DJ
              </h2>
              <p class="text-gray-600 mb-4">
                The DJ hasn't started streaming yet. You'll automatically connect when they go live.
              </p>
              <div class="flex items-center justify-center gap-2 text-sm text-gray-500">
                <div class="w-2 h-2 bg-orange-500 rounded-full animate-pulse"></div>
                <span>Listening for stream...</span>
              </div>
            </div>
          </div>
        </Show>

        <Show when={!isInitializing() && status() === 'live'}>
          <div class="grid lg:grid-cols-2 gap-8">
            {/* Left Column - Audio Visualization */}
            <div class="space-y-6">
              {/* Audio Visualizer */}
              <div class="bg-white/70 backdrop-blur-sm rounded-2xl p-6 border border-white/30 shadow-lg">
                <h3 class="text-lg font-semibold text-gray-800 mb-4">Live Audio</h3>
                
                <div class="bg-gradient-to-r from-purple-100 to-blue-100 rounded-xl p-6 mb-4">
                  <AudioVisualizer 
                    stream={audioStream()} 
                    isActive={status() === 'live'} 
                    class="mb-4"
                  />
                  
                  <div class="text-center">
                    <div class="text-4xl mb-2">🎵</div>
                    <p class="text-gray-700 font-medium">
                      {status() === 'live' ? 'Now Playing Live' : 'Stream Paused'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Now Playing Info */}
              <div class="bg-white/70 backdrop-blur-sm rounded-2xl p-6 border border-white/30 shadow-lg">
                <h3 class="text-lg font-semibold text-gray-800 mb-4">Now Playing</h3>
                
                <div class="space-y-3">
                  <div class="flex justify-between">
                    <span class="text-gray-600">Room:</span>
                    <span class="font-medium">{roomName()}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-gray-600">Stream Status:</span>
                    <span class={`font-medium ${
                      status() === 'live' ? 'text-green-600' :
                      status() === 'connecting' ? 'text-blue-600' :
                      'text-red-600'
                    }`}>
                      {status() === 'live' ? 'Live' :
                       status() === 'connecting' ? 'Connecting' :
                       'Error'}
                    </span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-gray-600">Listeners:</span>
                    <span class="font-medium">{listenerCount()}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column - Controls */}
            <div class="space-y-6">
              {/* Audio Controls */}
              <div class="bg-white/70 backdrop-blur-sm rounded-2xl p-6 border border-white/30 shadow-lg">
                <h3 class="text-lg font-semibold text-gray-800 mb-4">Audio Controls</h3>
                
                <div class="space-y-6">
                  <VolumeControls
                    volume={volume()}
                    isMuted={isMuted()}
                    onVolumeChange={handleVolumeChange}
                    onToggleMute={toggleMute}
                    disabled={status() !== 'live'}
                  />

                  <div class="pt-4 border-t border-gray-200">
                    <button
                      onClick={leaveRoom}
                      class="w-full px-4 py-3 bg-gray-500 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors"
                    >
                      Leave Room
                    </button>
                  </div>
                </div>
              </div>

              {/* Listener Tips */}
              <div class="bg-white/70 backdrop-blur-sm rounded-2xl p-6 border border-white/30 shadow-lg">
                <h3 class="text-lg font-semibold text-gray-800 mb-4">Listener Tips</h3>
                
                <div class="space-y-3 text-sm text-gray-600">
                  <div class="flex items-start gap-2">
                    <span>🔊</span>
                    <span>Adjust volume with the slider or use the mute button</span>
                  </div>
                  <div class="flex items-start gap-2">
                    <span>📊</span>
                    <span>The visualizer shows real-time audio from the DJ</span>
                  </div>
                  <div class="flex items-start gap-2">
                    <span>🔄</span>
                    <span>You'll automatically reconnect if the DJ pauses and resumes</span>
                  </div>
                  <div class="flex items-start gap-2">
                    <span>👥</span>
                    <span>See how many other listeners are enjoying the stream</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Show>

        <Show when={status() === 'error'}>
          <div class="text-center py-12">
            <div class="bg-white/70 backdrop-blur-sm rounded-2xl p-8 border border-white/30 shadow-lg max-w-md mx-auto">
              <div class="text-6xl mb-6">❌</div>
              <h2 class="text-xl font-semibold text-gray-800 mb-2">
                Connection Error
              </h2>
              <p class="text-gray-600 mb-6">
                There was a problem connecting to the stream. The room may not exist or the DJ may have ended their session.
              </p>
              <button
                onClick={joinRoom}
                class="px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg transition-colors mr-3"
              >
                Try Again
              </button>
              <button
                onClick={leaveRoom}
                class="px-6 py-3 bg-gray-500 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors"
              >
                Back to Lobby
              </button>
            </div>
          </div>
        </Show>
      </main>
    </div>
  )
}