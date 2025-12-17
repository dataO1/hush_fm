/**
 * Lobby Service - Handle room creation via WebSocket
 * 
 * This service connects to the lobby WebSocket endpoint and handles
 * DJ room creation requests, returning all necessary connection info.
 */

import { Effect, pipe } from 'effect'

export interface CreateDjRoomRequest {
  name: string
  description?: string
  tags?: string[]
  djName: string
}

export interface RoomAnnouncedResponse {
  room: {
    id: string
    name: string
    djName: string
    listenerCount: number
    isStreaming: boolean
    createdAt: string
    description?: string
    tags: string[]
  }
  wsUrl: string
}

export interface DjRoomCreatedResponse {
  room: {
    id: string
    name: string
    djName: string
    listenerCount: number
    isStreaming: boolean
    createdAt: string
    description?: string
    tags: string[]
  }
  transportOptions: {
    id: string
    iceParameters: unknown
    iceCandidates: unknown[]
    dtlsParameters: unknown
    sctpParameters?: unknown
  }
  rtpCapabilities: {
    codecs: unknown[]
    headerExtensions: unknown[]
  }
  wsUrl: string
}

export class LobbyServiceError extends Error {
  constructor(message: string, public code?: string) {
    super(message)
    this.name = 'LobbyServiceError'
  }
}

export const createDjRoomViaLobby = (
  request: CreateDjRoomRequest
): Effect.Effect<RoomAnnouncedResponse, LobbyServiceError> =>
  pipe(
    Effect.gen(function* (_) {
      // Connect to lobby WebSocket
      const ws = yield* _(Effect.tryPromise({
        try: () => new Promise<WebSocket>((resolve, reject) => {
          const socket = new WebSocket(`wss://${window.location.hostname}:3443/ws/lobby`)
          
          socket.onopen = () => resolve(socket)
          socket.onerror = () => reject(new Error('Failed to connect to lobby'))
          
          // Set a timeout for connection
          setTimeout(() => reject(new Error('Lobby connection timeout')), 5000)
        }),
        catch: (error) => new LobbyServiceError(
          error instanceof Error ? error.message : 'Failed to connect to lobby'
        )
      }))

      // Send room announcement command
      const command = {
        type: 'announceRoom',
        name: request.name,
        description: request.description,
        tags: request.tags,
        djName: request.djName,
        _traceContext: {
          traceparent: crypto.randomUUID(),
          tracestate: null,
          metadata: null
        }
      }

      yield* _(Effect.tryPromise({
        try: () => new Promise<void>((resolve) => {
          ws.send(JSON.stringify(command))
          resolve()
        }),
        catch: () => new LobbyServiceError('Failed to send room creation command')
      }))

      // Wait for response
      const response = yield* _(Effect.tryPromise({
        try: () => new Promise<RoomAnnouncedResponse>((resolve, reject) => {
          ws.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data)
              
              if (data.type === 'roomAnnounced') {
                ws.close()
                resolve({
                  room: data.room,
                  wsUrl: data.wsUrl
                })
              } else if (data.type === 'commandFailed') {
                ws.close()
                reject(new LobbyServiceError(data.error, data.command))
              }
            } catch (e) {
              ws.close()
              reject(new LobbyServiceError('Failed to parse lobby response'))
            }
          }
          
          ws.onerror = () => {
            reject(new LobbyServiceError('WebSocket error during room creation'))
          }
          
          // Set timeout for response
          setTimeout(() => {
            ws.close()
            reject(new LobbyServiceError('Room creation timeout'))
          }, 10000)
        }),
        catch: (error) => error instanceof LobbyServiceError 
          ? error 
          : new LobbyServiceError('Failed to receive room creation response')
      }))

      return response
    }),
    Effect.tap(() => Effect.logInfo('DJ room created successfully via lobby WebSocket'))
  )