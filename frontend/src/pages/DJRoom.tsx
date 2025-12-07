import { createSignal, onMount, onCleanup, Show } from 'solid-js'
import { useParams, useNavigate } from '@solidjs/router'
import { Effect } from 'effect'
import { publishRoomFlow } from '../effects/webrtc-flows'
import { StreamStatusBadge, type StreamStatus } from '../components/shared/StreamStatusBadge'
import { AudioLevelMeter } from '../components/shared/AudioLevelMeter'
import { MicControls } from '../components/controls/MicControls'

export default function DJRoom() {
  const params = useParams()
  const navigate = useNavigate()
  
  const [roomId] = createSignal(params.roomId)
  const [roomName, setRoomName] = createSignal('')
  const [status, setStatus] = createSignal<StreamStatus>('connecting')
  const [isMuted, setIsMuted] = createSignal(false)
  const [listenerCount] = createSignal(0)
  const [stream, setStream] = createSignal<MediaStream>()
  const [error, setError] = createSignal<string | null>(null)
  const [isInitializing, setIsInitializing] = createSignal(true)

  let producer: any = null
  let transport: any = null

  onMount(() => {
    startStreaming()
  })

  onCleanup(() => {
    cleanup()
  })

  const startStreaming = async () => {
    setIsInitializing(true)
    setStatus('connecting')
    setError(null)

    const program = Effect.gen(function* (_) {
      // The publishRoomFlow handles the entire DJ workflow
      const result = yield* _(publishRoomFlow(roomName() || `Room ${roomId()}`))
      
      return result
    })

    try {
      const result = await Effect.runPromise(program)
      
      // Store references for controls
      producer = result.producer
      transport = result.transport
      
      // Get the audio track from the producer
      if (result.producer && result.producer.track) {
        const stream = new MediaStream([result.producer.track])
        setStream(stream)
      }
      
      setStatus('live')
      setIsInitializing(false)
      setRoomName(`Room ${roomId()}`)
      
      // Set up WebSocket for listener count updates
      setupRealtimeUpdates()
      
    } catch (err: any) {
      console.error('Failed to start streaming:', err)
      setError(`Failed to start streaming: ${err.message}`)
      setStatus('error')
      setIsInitializing(false)
    }
  }

  const setupRealtimeUpdates = () => {
    // TODO: Connect to WebSocket for real-time listener count updates
    // This would typically connect to the room's WebSocket endpoint
    // and listen for listener join/leave events
  }

  const toggleMute = async () => {
    if (!producer) return

    try {
      if (isMuted()) {
        await producer.resume()
        setIsMuted(false)
        setStatus('live')
      } else {
        await producer.pause()
        setIsMuted(true)
        setStatus('muted')
      }
    } catch (err: any) {
      console.error('Failed to toggle mute:', err)
      setError(`Failed to ${isMuted() ? 'unmute' : 'mute'}: ${err.message}`)
    }
  }

  const endStream = () => {
    cleanup()
    navigate('/')
  }

  const cleanup = () => {
    if (producer) {
      producer.close()
      producer = null
    }
    
    if (transport) {
      transport.close()
      transport = null
    }

    const currentStream = stream()
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop())
      setStream(undefined)
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
                  🎤 DJ Mode
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
              <div class="w-16 h-16 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
              <h2 class="text-xl font-semibold text-gray-800 mb-2">
                Preparing Your Stream
              </h2>
              <p class="text-gray-600 mb-4">
                Setting up audio devices and connecting to the network...
              </p>
              <div class="text-sm text-gray-500">
                <div class="flex items-center justify-center gap-2">
                  <div class="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></div>
                  <span>This may take a few moments</span>
                </div>
              </div>
            </div>
          </div>
        </Show>

        <Show when={!isInitializing()}>
          <div class="grid lg:grid-cols-2 gap-8">
            {/* Left Column - Controls */}
            <div class="space-y-6">
              {/* Stream Controls */}
              <div class="bg-white/70 backdrop-blur-sm rounded-2xl p-6 border border-white/30 shadow-lg">
                <h3 class="text-lg font-semibold text-gray-800 mb-4">Stream Controls</h3>
                
                <div class="space-y-6">
                  <MicControls
                    isMuted={isMuted()}
                    isStreaming={status() === 'live' || status() === 'muted'}
                    onToggleMute={toggleMute}
                    onEndStream={endStream}
                    disabled={status() === 'error' || status() === 'connecting'}
                  />

                  <Show when={stream()}>
                    <AudioLevelMeter stream={stream()} class="mt-4" />
                  </Show>
                </div>
              </div>

              {/* Room Information */}
              <div class="bg-white/70 backdrop-blur-sm rounded-2xl p-6 border border-white/30 shadow-lg">
                <h3 class="text-lg font-semibold text-gray-800 mb-4">Room Information</h3>
                
                <div class="space-y-3">
                  <div class="flex justify-between">
                    <span class="text-gray-600">Room ID:</span>
                    <span class="font-mono text-sm">{roomId()}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-gray-600">Stream Status:</span>
                    <span class={`font-medium ${
                      status() === 'live' ? 'text-green-600' :
                      status() === 'muted' ? 'text-orange-600' :
                      status() === 'connecting' ? 'text-blue-600' :
                      'text-red-600'
                    }`}>
                      {status() === 'live' ? 'Live' :
                       status() === 'muted' ? 'Muted' :
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

            {/* Right Column - Visual Feedback */}
            <div class="space-y-6">
              {/* Audio Visualization */}
              <div class="bg-white/70 backdrop-blur-sm rounded-2xl p-6 border border-white/30 shadow-lg">
                <h3 class="text-lg font-semibold text-gray-800 mb-4">Audio Visualization</h3>
                
                <div class="bg-gradient-to-r from-purple-100 to-blue-100 rounded-xl p-6">
                  <div class="text-center">
                    <div class="text-6xl mb-4">
                      {status() === 'live' ? '🎵' : 
                       status() === 'muted' ? '🔇' :
                       status() === 'connecting' ? '⏳' :
                       '❌'}
                    </div>
                    <p class="text-gray-600">
                      {status() === 'live' ? 'Your audio is streaming live!' :
                       status() === 'muted' ? 'Microphone is muted' :
                       status() === 'connecting' ? 'Connecting to stream...' :
                       'Stream encountered an error'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Tips */}
              <div class="bg-white/70 backdrop-blur-sm rounded-2xl p-6 border border-white/30 shadow-lg">
                <h3 class="text-lg font-semibold text-gray-800 mb-4">DJ Tips</h3>
                
                <div class="space-y-3 text-sm text-gray-600">
                  <div class="flex items-start gap-2">
                    <span>🎤</span>
                    <span>Use the mute button to pause your stream without disconnecting listeners</span>
                  </div>
                  <div class="flex items-start gap-2">
                    <span>📊</span>
                    <span>Watch the input level meter to ensure optimal audio quality</span>
                  </div>
                  <div class="flex items-start gap-2">
                    <span>👥</span>
                    <span>Keep an eye on your listener count to gauge your audience</span>
                  </div>
                  <div class="flex items-start gap-2">
                    <span>🔊</span>
                    <span>Test your audio levels before starting to broadcast</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Show>
      </main>
    </div>
  )
}