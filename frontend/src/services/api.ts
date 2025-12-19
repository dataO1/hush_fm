// src/services/api.ts - API client with internal type conversions
import { Effect, pipe } from 'effect'
import {
  listRooms as listRoomsGenerated
} from './generated/rooms/rooms'
import type {
  RoomInfo
} from './generated/hushFMAPI.schemas'


export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public cause?: unknown
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// ✅ PERFECT: Wraps clean Promise API
export const listRooms = (): Effect.Effect<RoomInfo[], ApiError> =>
  pipe(
    Effect.tryPromise({
      try: () => listRoomsGenerated(),
      catch: error => new ApiError('Network error', 0, error)
    }),
    Effect.flatMap((response: any) => {
      if (response.status === 200 && Array.isArray(response.data)) {
        return Effect.succeed(response.data)
      }
      return Effect.fail(new ApiError(
        `Invalid response: ${response.status}`,
        response.status
      ))
    })
  )



