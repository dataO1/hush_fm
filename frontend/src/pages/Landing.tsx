import { createSignal, createEffect, For } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { Effect } from 'effect'
import * as Api from '../api/client'
import { connectWebSocket, subscribeToMessages, BroadcastMessage } from '../ws/client'

interface Room {
  id: string
  name: string
  dj_id: string
  dj_streaming: boolean
  listener_count: number
}

export default function Landing() {
  const navigate = useNavigate()
  const [rooms, setRooms] = createSignal<Room[]>([])
  const [roomName, setRoomName] = createSignal('')
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  // Load initial rooms
  createEffect(() => {
    const program = Effect.gen(function* (_) {
      const roomList = yield* _(Api.listRooms())
      setRooms(roomList)
    })

    Effect.runPromise(program).catch((err) => {
      setError(`Failed to load rooms: ${err.message}`)
    })
  })

  // Subscribe to real-time room updates
  createEffect(() => {
    const program = Effect.gen(function* (_) {
      const ws = yield* _(connectWebSocket('ws://localhost:3000/ws/lobby'))
      
      yield* _(subscribeToMessages<BroadcastMessage>(ws, (message) => {
        switch (message.type) {
          case 'RoomAdded':
            if (message.room) {
              setRooms(prev => [...prev, message.room])
            }
            break
          case 'RoomUpdated':
            if (message.room) {
              setRooms(prev => prev.map(room => 
                room.id === message.room.id ? message.room : room
              ))
            }
            break
          case 'RoomRemoved':
            if (message.room_id) {
              setRooms(prev => prev.filter(room => room.id !== message.room_id))
            }
            break
        }
      }, (err) => {
        console.error('WebSocket error:', err)
      }))
    })

    Effect.runPromise(program).catch((err) => {
      console.error('Failed to connect to lobby WebSocket:', err)
    })
  })

  const createRoom = async () => {
    if (!roomName().trim()) {
      setError('Please enter a room name')
      return
    }

    setLoading(true)
    setError(null)

    const program = Effect.gen(function* (_) {
      const response = yield* _(Api.createRoom({ name: roomName().trim() }))
      navigate(`/dj/${response.room_id}`)
    })

    try {
      await Effect.runPromise(program)
    } catch (err: any) {
      setError(`Failed to create room: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const joinRoom = (roomId: string) => {
    navigate(`/listen/${roomId}`)
  }

  return (
    <div style={{
      'min-height': '100vh',
      'padding': '2rem',
      'background': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
    }}>
      <div style={{
        'max-width': '800px',
        'margin': '0 auto',
        'background': 'rgba(255, 255, 255, 0.95)',
        'border-radius': '12px',
        'padding': '2rem',
        'box-shadow': '0 20px 40px rgba(0, 0, 0, 0.1)'
      }}>
        <header style={{ 'text-align': 'center', 'margin-bottom': '3rem' }}>
          <h1 style={{
            'font-size': '3rem',
            'font-weight': 'bold',
            'background': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            '-webkit-background-clip': 'text',
            '-webkit-text-fill-color': 'transparent',
            'margin-bottom': '0.5rem'
          }}>
            🎵 HushFM
          </h1>
          <p style={{ 'color': '#666', 'font-size': '1.2rem' }}>
            Live Audio Streaming Platform
          </p>
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

        {/* Create Room Section */}
        <section style={{ 'margin-bottom': '3rem' }}>
          <h2 style={{ 'margin-bottom': '1rem', 'color': '#333' }}>
            Start Broadcasting
          </h2>
          <div style={{
            'display': 'flex',
            'gap': '1rem',
            'align-items': 'center',
            'flex-wrap': 'wrap'
          }}>
            <input
              type="text"
              placeholder="Enter room name..."
              value={roomName()}
              onInput={(e) => setRoomName(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && createRoom()}
              style={{
                'flex': '1',
                'min-width': '250px',
                'padding': '0.75rem 1rem',
                'border': '2px solid #e0e0e0',
                'border-radius': '8px',
                'font-size': '1rem',
                'outline': 'none',
                'transition': 'border-color 0.2s'
              }}
              disabled={loading()}
            />
            <button
              onClick={createRoom}
              disabled={loading() || !roomName().trim()}
              style={{
                'padding': '0.75rem 2rem',
                'background': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                'color': 'white',
                'border': 'none',
                'border-radius': '8px',
                'font-size': '1rem',
                'font-weight': 'bold',
                'cursor': loading() ? 'not-allowed' : 'pointer',
                'opacity': loading() ? '0.7' : '1',
                'transition': 'opacity 0.2s'
              }}
            >
              {loading() ? 'Creating...' : 'Create & Start DJing'}
            </button>
          </div>
        </section>

        {/* Room List Section */}
        <section>
          <h2 style={{ 'margin-bottom': '1rem', 'color': '#333' }}>
            Active Rooms ({rooms().length})
          </h2>
          
          {rooms().length === 0 ? (
            <div style={{
              'text-align': 'center',
              'padding': '3rem',
              'color': '#666',
              'border': '2px dashed #ddd',
              'border-radius': '8px'
            }}>
              <p>No rooms available. Be the first to create one!</p>
            </div>
          ) : (
            <div style={{
              'display': 'grid',
              'grid-template-columns': 'repeat(auto-fill, minmax(300px, 1fr))',
              'gap': '1rem'
            }}>
              <For each={rooms()}>
                {(room) => (
                  <div style={{
                    'background': '#f8f9fa',
                    'padding': '1.5rem',
                    'border-radius': '8px',
                    'border': '1px solid #e0e0e0',
                    'transition': 'transform 0.2s, box-shadow 0.2s',
                    'cursor': 'pointer'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px)'
                    e.currentTarget.style.boxShadow = '0 8px 16px rgba(0,0,0,0.1)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)'
                    e.currentTarget.style.boxShadow = 'none'
                  }}>
                    <h3 style={{
                      'margin-bottom': '0.5rem',
                      'color': '#333',
                      'font-size': '1.25rem'
                    }}>
                      {room.name}
                    </h3>
                    <div style={{
                      'display': 'flex',
                      'align-items': 'center',
                      'gap': '0.5rem',
                      'margin-bottom': '1rem',
                      'color': '#666'
                    }}>
                      <span style={{
                        'padding': '0.25rem 0.5rem',
                        'border-radius': '4px',
                        'font-size': '0.875rem',
                        'font-weight': 'bold',
                        'background': room.dj_streaming ? '#d4edda' : '#f8d7da',
                        'color': room.dj_streaming ? '#155724' : '#721c24'
                      }}>
                        {room.dj_streaming ? '🔴 LIVE' : '⏸️ Not streaming'}
                      </span>
                      <span style={{ 'font-size': '0.875rem' }}>
                        {room.listener_count} listeners
                      </span>
                    </div>
                    <button
                      onClick={() => joinRoom(room.id)}
                      style={{
                        'width': '100%',
                        'padding': '0.75rem',
                        'background': room.dj_streaming ? '#28a745' : '#6c757d',
                        'color': 'white',
                        'border': 'none',
                        'border-radius': '6px',
                        'font-weight': 'bold',
                        'cursor': 'pointer',
                        'transition': 'background 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = room.dj_streaming ? '#218838' : '#5a6268'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = room.dj_streaming ? '#28a745' : '#6c757d'
                      }}
                    >
                      Join as Listener
                    </button>
                  </div>
                )}
              </For>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}