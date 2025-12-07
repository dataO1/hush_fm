import { Effect } from 'effect'

export interface DJMessage {
  type: 'ConnectTransport' | 'Produce' | 'StopProducing' | 'DeleteRoom'
  dtls_parameters?: any
  rtp_parameters?: any
}

export interface ServerMessage {
  type: 'ProducerCreated' | 'RoomDeleted' | 'ListenerJoined' | 'ListenerLeft' | 'Error'
  producer_id?: string
  count?: number
  message?: string
}

export interface BroadcastMessage {
  type: 'RoomAdded' | 'RoomUpdated' | 'RoomRemoved'
  room?: any
  room_id?: string
}

class WebSocketError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebSocketError'
  }
}

export const connectWebSocket = (url: string): Effect.Effect<WebSocket, WebSocketError> =>
  Effect.async<WebSocket, WebSocketError>((resume) => {
    const ws = new WebSocket(url)
    
    ws.onopen = () => {
      resume(Effect.succeed(ws))
    }
    
    ws.onerror = () => {
      resume(Effect.fail(new WebSocketError(`Failed to connect to ${url}`)))
    }
    
    return Effect.sync(() => {
      ws.close()
    })
  })

export const sendMessage = (ws: WebSocket, message: DJMessage): Effect.Effect<void, WebSocketError> =>
  Effect.sync(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message))
    } else {
      throw new WebSocketError('WebSocket not connected')
    }
  })

export const subscribeToMessages = <T>(
  ws: WebSocket,
  onMessage: (message: T) => void,
  onError?: (error: Error) => void
): Effect.Effect<void, never> =>
  Effect.sync(() => {
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)
        onMessage(message)
      } catch (error) {
        onError?.(error as Error)
      }
    }
    
    ws.onerror = (_) => {
      onError?.(new Error('WebSocket error'))
    }
  })