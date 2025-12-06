import { Effect } from 'effect'

const API_BASE_URL = 'http://localhost:3000/api'

export interface Room {
  id: string
  name: string
  dj_id: string
  dj_streaming: boolean
  listener_count: number
}

export interface CreateRoomRequest {
  name: string
}

export interface CreateRoomResponse {
  room_id: string
  dj_token: string
  transport_options: any
  ws_url: string
}

export interface JoinRoomResponse {
  transport_options: any
  producer_id: string | null
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

const fetchJson = <T>(url: string, options?: RequestInit): Effect.Effect<T, ApiError> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
        ...options,
      })
      
      if (!response.ok) {
        throw new ApiError(response.status, response.statusText)
      }
      
      return response.json()
    },
    catch: (error) => {
      if (error instanceof ApiError) return error
      return new ApiError(500, String(error))
    }
  })

export const createRoom = (request: CreateRoomRequest): Effect.Effect<CreateRoomResponse, ApiError> =>
  fetchJson(`${API_BASE_URL}/rooms`, {
    method: 'POST',
    body: JSON.stringify(request),
  })

export const listRooms = (): Effect.Effect<Room[], ApiError> =>
  fetchJson(`${API_BASE_URL}/rooms`)

export const joinRoom = (roomId: string): Effect.Effect<JoinRoomResponse, ApiError> =>
  fetchJson(`${API_BASE_URL}/rooms/${roomId}/join`, {
    method: 'POST',
  })