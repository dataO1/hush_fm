import { Effect, pipe } from 'effect'
import { listRooms as listRoomsGenerated, createRoom as createRoomGenerated } from '../generated/rooms/rooms'
import type { Room, CreateRoomRequest, CreateRoomResponse } from '../generated/api.schemas'

/**
 * API Error class for Effect-TS integration
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public step: string = 'unknown',
    public cause?: unknown
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Effect-wrapped API functions for the Landing page
 * These work directly with the Effect-returning generated functions
 */

export const listRooms = (): Effect.Effect<Room[], ApiError> =>
  pipe(
    listRoomsGenerated(),
    Effect.map((response) => response.data),
    Effect.mapError((error) => new ApiError('Failed to list rooms', 'api_call', error))
  )

export const createRoom = (request: CreateRoomRequest): Effect.Effect<CreateRoomResponse, ApiError> =>
  pipe(
    createRoomGenerated(request),
    Effect.flatMap((response) => {
      if (response.status === 201) {
        return Effect.succeed(response.data)
      }
      return Effect.fail(new ApiError(`Failed to create room: ${response.status}`, 'api_call'))
    }),
    Effect.mapError((error) => new ApiError('Failed to create room', 'api_call', error))
  )
