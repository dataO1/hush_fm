// src/effects/api.ts - 100% WORKING
import { Effect, pipe } from 'effect'
import {
  listRooms as listRoomsGenerated,
  createRoom as createRoomGenerated,
  joinRoom as joinRoomGenerated,
  getRoomInfo as getRoomInfoGenerated
} from '../generated/rooms/rooms'
import type {
  Room,
  CreateRoomRequest,
  CreateRoomResponse,
  JoinRoomResponse,
  JoinRoomRequest,
  RoomInfoResponse
} from '../generated/api.schemas'  // ✅ Import from schemas

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
export const listRooms = (): Effect.Effect<Room[], ApiError> =>
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

export const createRoom = (
  request: CreateRoomRequest
): Effect.Effect<CreateRoomResponse, ApiError> =>
  pipe(
    Effect.tryPromise({
      try: () => createRoomGenerated(request),
      catch: error => new ApiError('Network error', 0, error)
    }),
    Effect.flatMap((response: any) => {
      if (response.status === 201 && response.data) {
        return Effect.succeed(response.data)
      }
      return Effect.fail(new ApiError(
        `Create failed: ${response.status}`,
        response.status
      ))
    })
  )

export const getRoomInfo = (roomId: string): Effect.Effect<RoomInfoResponse, ApiError> =>
  pipe(
    Effect.tryPromise({
      try: () => getRoomInfoGenerated(roomId),
      catch: error => new ApiError('Network error', 0, error)
    }),
    Effect.flatMap((response: any) => {
      if (response.status === 200 && response.data) {
        return Effect.succeed(response.data)
      }
      return Effect.fail(new ApiError(
        `Get room info failed: ${response.status}`,
        response.status
      ))
    })
  )

export const joinRoom = (roomId: string, request: JoinRoomRequest): Effect.Effect<JoinRoomResponse, ApiError> =>
  pipe(
    Effect.tryPromise({
      try: () => joinRoomGenerated(roomId, request),
      catch: error => new ApiError('Network error', 0, error)
    }),
    Effect.flatMap((response: any) => {
      if (response.status === 200 && response.data) {
        return Effect.succeed(response.data)
      }
      return Effect.fail(new ApiError(
        `Join failed: ${response.status}`,
        response.status
      ))
    })
  )
