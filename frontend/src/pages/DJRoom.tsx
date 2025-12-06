import { createSignal, createEffect, onCleanup } from 'solid-js'
import { useParams, useNavigate } from '@solidjs/router'
import { Effect } from 'effect'
import { connectWebSocket, sendMessage, subscribeToMessages, DJMessage, ServerMessage } from '../ws/client'

export default function DJRoom() {
  const params = useParams()
  const navigate = useNavigate()
  
  const [roomId] = createSignal(params.roomId)
  const [connected, setConnected] = createSignal(false)
  const [streaming, setStreaming] = createSignal(false)
  const [listenerCount, setListenerCount] = createSignal(0)
  const [audioDevices, setAudioDevices] = createSignal<MediaDeviceInfo[]>([])
  const [selectedDevice, setSelectedDevice] = createSignal('')
  const [error, setError] = createSignal<string | null>(null)
  const [ws, setWs] = createSignal<WebSocket | null>(null)

  // Initialize WebSocket connection
  createEffect(async () => {
    const wsUrl = `ws://localhost:3000/ws/room/${roomId()}`
    
    const program = Effect.gen(function* (_) {
      const socket = yield* _(connectWebSocket(wsUrl))
      setWs(socket)
      setConnected(true)
      
      // Subscribe to server messages
      yield* _(subscribeToMessages<ServerMessage>(socket, (message) => {
        switch (message.type) {
          case 'ProducerCreated':
            setStreaming(true)
            setError(null)
            break
          case 'ListenerJoined':
            if (message.count !== undefined) {
              setListenerCount(message.count)
            }
            break
          case 'ListenerLeft':
            if (message.count !== undefined) {
              setListenerCount(message.count)
            }
            break
          case 'Error':
            setError(message.message || 'Unknown error')
            break
          case 'RoomDeleted':
            navigate('/')
            break
        }
      }, (err) => {
        setError(`WebSocket error: ${err.message}`)
        setConnected(false)
      }))
    })

    try {
      await Effect.runPromise(program)
    } catch (err: any) {
      setError(`Failed to connect: ${err.message}`)
    }
  })

  // Get available audio devices
  createEffect(async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true })
      const devices = await navigator.mediaDevices.enumerateDevices()
      const audioInputs = devices.filter(device => device.kind === 'audioinput')
      setAudioDevices(audioInputs)
      
      if (audioInputs.length > 0 && !selectedDevice()) {
        setSelectedDevice(audioInputs[0].deviceId)
      }
    } catch (err) {
      setError('Failed to access audio devices. Please grant microphone permission.')
    }
  })

  const sendWSMessage = (message: DJMessage) => {
    const socket = ws()
    if (!socket) {
      setError('Not connected to server')
      return
    }

    const program = sendMessage(socket, message)
    Effect.runPromise(program).catch((err) => {
      setError(`Failed to send message: ${err.message}`)
    })
  }

  const startStreaming = async () => {
    if (!selectedDevice()) {
      setError('Please select an audio input device')
      return
    }

    try {
      setError(null)
      
      // For now, simulate the streaming process
      // TODO: Integrate actual MediaSoup client
      sendWSMessage({
        type: 'ConnectTransport',
        dtls_parameters: { /* TODO: Real DTLS parameters */ }
      })

      // Simulate producer creation
      setTimeout(() => {
        sendWSMessage({
          type: 'Produce',
          rtp_parameters: { /* TODO: Real RTP parameters */ }
        })
      }, 1000)

    } catch (err: any) {
      setError(`Failed to start streaming: ${err.message}`)
    }
  }

  const stopStreaming = () => {
    sendWSMessage({ type: 'StopProducing' })
    setStreaming(false)
  }

  const deleteRoom = () => {
    if (confirm('Are you sure you want to delete this room? This will kick all listeners.')) {
      sendWSMessage({ type: 'DeleteRoom' })
    }
  }

  onCleanup(() => {
    const socket = ws()
    if (socket) {
      socket.close()
    }
  })

  return (
    <div style={{
      'min-height': '100vh',
      'padding': '2rem',
      'background': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
    }}>
      <div style={{
        'max-width': '600px',
        'margin': '0 auto',
        'background': 'rgba(255, 255, 255, 0.95)',
        'border-radius': '12px',
        'padding': '2rem',
        'box-shadow': '0 20px 40px rgba(0, 0, 0, 0.1)'
      }}>
        <header style={{ 'text-align': 'center', 'margin-bottom': '2rem' }}>
          <h1 style={{
            'font-size': '2rem',
            'font-weight': 'bold',
            'color': '#333',
            'margin-bottom': '0.5rem'
          }}>
            🎛️ DJ Control Panel
          </h1>
          <p style={{ 'color': '#666' }}>Room ID: {roomId()}</p>
          <div style={{
            'display': 'flex',
            'justify-content': 'center',
            'align-items': 'center',
            'gap': '1rem',
            'margin-top': '1rem'
          }}>
            <span style={{
              'padding': '0.25rem 0.75rem',
              'border-radius': '20px',
              'font-size': '0.875rem',
              'font-weight': 'bold',
              'background': connected() ? '#d4edda' : '#f8d7da',
              'color': connected() ? '#155724' : '#721c24'
            }}>
              {connected() ? '🟢 Connected' : '🔴 Disconnected'}
            </span>
            <span style={{ 'color': '#666' }}>
              👥 {listenerCount()} listeners
            </span>
          </div>
        </header>

        {error() && (
          <div style={{
            'background': '#fee',
            'color': '#c33',
            'padding': '1rem',
            'border-radius': '8px',
            'margin-bottom': '2rem'
          }}>
            {error()}
          </div>
        )}

        {/* Audio Input Selection */}
        <section style={{ 'margin-bottom': '2rem' }}>
          <h3 style={{ 'margin-bottom': '1rem', 'color': '#333' }}>
            Audio Input
          </h3>
          <select
            value={selectedDevice()}
            onChange={(e) => setSelectedDevice(e.target.value)}
            disabled={streaming()}
            style={{
              'width': '100%',
              'padding': '0.75rem',
              'border': '2px solid #e0e0e0',
              'border-radius': '8px',
              'font-size': '1rem',
              'background': 'white',
              'cursor': streaming() ? 'not-allowed' : 'pointer',
              'opacity': streaming() ? '0.7' : '1'
            }}
          >
            <option value="">Select Audio Input</option>
            {audioDevices().map(device => (
              <option value={device.deviceId}>
                {device.label || `Audio Input ${device.deviceId.slice(0, 8)}...`}
              </option>
            ))}
          </select>
          {streaming() && (
            <p style={{
              'color': '#666',
              'font-size': '0.875rem',
              'margin-top': '0.5rem'
            }}>
              Stop streaming to change audio input
            </p>
          )}
        </section>

        {/* Stream Controls */}
        <section style={{ 'margin-bottom': '2rem' }}>
          <h3 style={{ 'margin-bottom': '1rem', 'color': '#333' }}>
            Stream Control
          </h3>
          <div style={{ 'display': 'flex', 'gap': '1rem' }}>
            {!streaming() ? (
              <button
                onClick={startStreaming}
                disabled={!connected() || !selectedDevice()}
                style={{
                  'flex': '1',
                  'padding': '1rem',
                  'background': 'linear-gradient(135deg, #28a745, #20c997)',
                  'color': 'white',
                  'border': 'none',
                  'border-radius': '8px',
                  'font-size': '1.125rem',
                  'font-weight': 'bold',
                  'cursor': (!connected() || !selectedDevice()) ? 'not-allowed' : 'pointer',
                  'opacity': (!connected() || !selectedDevice()) ? '0.5' : '1',
                  'transition': 'opacity 0.2s'
                }}
              >
                🔴 Go Live
              </button>
            ) : (
              <button
                onClick={stopStreaming}
                style={{
                  'flex': '1',
                  'padding': '1rem',
                  'background': 'linear-gradient(135deg, #dc3545, #c82333)',
                  'color': 'white',
                  'border': 'none',
                  'border-radius': '8px',
                  'font-size': '1.125rem',
                  'font-weight': 'bold',
                  'cursor': 'pointer'
                }}
              >
                ⏹️ Stop Streaming
              </button>
            )}
          </div>
          
          {streaming() && (
            <div style={{
              'text-align': 'center',
              'margin-top': '1rem',
              'padding': '1rem',
              'background': '#d4edda',
              'color': '#155724',
              'border-radius': '8px',
              'font-weight': 'bold'
            }}>
              🎵 You are now LIVE!
            </div>
          )}
        </section>

        {/* Room Management */}
        <section>
          <h3 style={{ 'margin-bottom': '1rem', 'color': '#333' }}>
            Room Management
          </h3>
          <div style={{ 'display': 'flex', 'gap': '1rem' }}>
            <button
              onClick={() => navigate('/')}
              style={{
                'flex': '1',
                'padding': '0.75rem',
                'background': '#6c757d',
                'color': 'white',
                'border': 'none',
                'border-radius': '8px',
                'font-weight': 'bold',
                'cursor': 'pointer'
              }}
            >
              ← Back to Lobby
            </button>
            <button
              onClick={deleteRoom}
              style={{
                'flex': '1',
                'padding': '0.75rem',
                'background': '#dc3545',
                'color': 'white',
                'border': 'none',
                'border-radius': '8px',
                'font-weight': 'bold',
                'cursor': 'pointer'
              }}
            >
              🗑️ Delete Room
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}