import { createSignal, createEffect } from 'solid-js'
import { useParams, useNavigate } from '@solidjs/router'
import { Effect } from 'effect'
import * as Api from '../api/client'

export default function ListenerRoom() {
  const params = useParams()
  const navigate = useNavigate()
  
  const [roomId] = createSignal(params.roomId)
  const [loading, setLoading] = createSignal(true)
  const [playing, setPlaying] = createSignal(false)
  const [waiting, setWaiting] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  // const [roomName] = createSignal('') // Unused for now

  // Join room effect
  createEffect(async () => {
    const program = Effect.gen(function* (_) {
      const response = yield* _(Api.joinRoom(roomId()))
      
      if (response.producer_id) {
        // DJ is streaming, can connect immediately
        // TODO: Setup MediaSoup consumer here
        setWaiting(false)
        setPlaying(true)
      } else {
        // DJ not streaming yet, wait
        setWaiting(true)
        setPlaying(false)
      }
      
      setLoading(false)
    })

    try {
      await Effect.runPromise(program)
    } catch (err: any) {
      if (err.status === 404) {
        setError('Room not found')
      } else {
        setError(`Failed to join room: ${err.message}`)
      }
      setLoading(false)
    }
  })

  const leaveRoom = () => {
    navigate('/')
  }

  if (loading()) {
    return (
      <div style={{
        'min-height': '100vh',
        'display': 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        'background': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
      }}>
        <div style={{
          'background': 'rgba(255, 255, 255, 0.95)',
          'padding': '2rem',
          'border-radius': '12px',
          'text-align': 'center'
        }}>
          <div style={{
            'width': '40px',
            'height': '40px',
            'border': '4px solid #f3f3f3',
            'border-top': '4px solid #667eea',
            'border-radius': '50%',
            'animation': 'spin 1s linear infinite',
            'margin': '0 auto 1rem'
          }}></div>
          <p>Connecting to room...</p>
        </div>
      </div>
    )
  }

  if (error()) {
    return (
      <div style={{
        'min-height': '100vh',
        'display': 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        'background': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
      }}>
        <div style={{
          'background': 'rgba(255, 255, 255, 0.95)',
          'padding': '2rem',
          'border-radius': '12px',
          'text-align': 'center',
          'max-width': '400px'
        }}>
          <div style={{
            'font-size': '3rem',
            'margin-bottom': '1rem'
          }}>
            ❌
          </div>
          <h2 style={{ 'color': '#dc3545', 'margin-bottom': '1rem' }}>
            Connection Failed
          </h2>
          <p style={{ 'color': '#666', 'margin-bottom': '2rem' }}>
            {error()}
          </p>
          <button
            onClick={leaveRoom}
            style={{
              'padding': '0.75rem 2rem',
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
        </div>
      </div>
    )
  }

  return (
    <div style={{
      'min-height': '100vh',
      'background': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
    }}>
      {/* Top Navigation */}
      <nav style={{
        'background': 'rgba(255, 255, 255, 0.1)',
        'backdrop-filter': 'blur(10px)',
        'padding': '1rem 2rem',
        'display': 'flex',
        'justify-content': 'space-between',
        'align-items': 'center'
      }}>
        <h1 style={{
          'color': 'white',
          'font-size': '1.5rem',
          'font-weight': 'bold'
        }}>
          🎵 HushFM Listener
        </h1>
        <button
          onClick={leaveRoom}
          style={{
            'padding': '0.5rem 1rem',
            'background': 'rgba(255, 255, 255, 0.2)',
            'color': 'white',
            'border': 'none',
            'border-radius': '6px',
            'font-weight': 'bold',
            'cursor': 'pointer',
            'backdrop-filter': 'blur(10px)'
          }}
        >
          ← Leave Room
        </button>
      </nav>

      {/* Main Content */}
      <div style={{
        'display': 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        'min-height': 'calc(100vh - 80px)',
        'padding': '2rem'
      }}>
        <div style={{
          'background': 'rgba(255, 255, 255, 0.95)',
          'border-radius': '20px',
          'padding': '3rem',
          'text-align': 'center',
          'box-shadow': '0 20px 40px rgba(0, 0, 0, 0.1)',
          'max-width': '500px',
          'width': '100%'
        }}>
          {waiting() && (
            <>
              <div style={{
                'font-size': '4rem',
                'margin-bottom': '2rem'
              }}>
                ⏸️
              </div>
              <h2 style={{
                'color': '#333',
                'margin-bottom': '1rem',
                'font-size': '2rem'
              }}>
                Waiting for DJ
              </h2>
              <p style={{
                'color': '#666',
                'margin-bottom': '2rem',
                'font-size': '1.125rem'
              }}>
                The DJ hasn't started streaming yet. You'll automatically connect when they go live.
              </p>
              <div style={{
                'display': 'inline-flex',
                'align-items': 'center',
                'gap': '0.5rem',
                'padding': '1rem 1.5rem',
                'background': '#f8f9fa',
                'border-radius': '12px',
                'color': '#666'
              }}>
                <div style={{
                  'width': '12px',
                  'height': '12px',
                  'background': '#ffc107',
                  'border-radius': '50%',
                  'animation': 'pulse 1.5s ease-in-out infinite'
                }}></div>
                Listening for stream...
              </div>
            </>
          )}

          {playing() && (
            <>
              <div style={{
                'font-size': '4rem',
                'margin-bottom': '2rem'
              }}>
                🎵
              </div>
              <h2 style={{
                'color': '#333',
                'margin-bottom': '1rem',
                'font-size': '2rem'
              }}>
                Now Playing
              </h2>
              <p style={{
                'color': '#666',
                'margin-bottom': '2rem',
                'font-size': '1.125rem'
              }}>
                Enjoying the live stream from Room {roomId()}
              </p>
              
              {/* Audio Visualizer Placeholder */}
              <div style={{
                'width': '100%',
                'height': '100px',
                'background': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                'border-radius': '12px',
                'margin': '2rem 0',
                'display': 'flex',
                'align-items': 'center',
                'justify-content': 'center',
                'position': 'relative',
                'overflow': 'hidden'
              }}>
                {/* Simple wave animation */}
                {[...Array(20)].map((_, i) => (
                  <div style={{
                    'width': '4px',
                    'background': 'rgba(255, 255, 255, 0.8)',
                    'margin': '0 2px',
                    'border-radius': '2px',
                    'animation': `wave ${0.5 + i * 0.1}s ease-in-out infinite alternate`,
                    'height': '20px'
                  }}></div>
                ))}
              </div>

              <div style={{
                'display': 'inline-flex',
                'align-items': 'center',
                'gap': '0.5rem',
                'padding': '1rem 1.5rem',
                'background': '#d4edda',
                'border-radius': '12px',
                'color': '#155724',
                'font-weight': 'bold'
              }}>
                <div style={{
                  'width': '12px',
                  'height': '12px',
                  'background': '#28a745',
                  'border-radius': '50%'
                }}></div>
                Connected • Live Stream
              </div>
            </>
          )}
        </div>
      </div>

      {/* Add CSS animations */}
      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          
          @keyframes pulse {
            0%, 100% { opacity: 0.5; }
            50% { opacity: 1; }
          }
          
          @keyframes wave {
            0% { height: 20px; }
            100% { height: 60px; }
          }
        `}
      </style>
    </div>
  )
}