// src/effects/api.ts - API client with internal type conversions
import { Effect, pipe } from 'effect'
import { types } from 'mediasoup-client'
import {
  listRooms as listRoomsGenerated,
  createRoom as createRoomGenerated,
  getRoomInfo as getRoomInfoGenerated
} from '../generated/rooms/rooms'
import type {
  Room,
  CreateRoomRequest as GeneratedCreateRoomRequest,
  CreateRoomResponse as GeneratedCreateRoomResponse,
  RoomInfoResponse,
  TransportOptions,
  RoomInfo
} from '../generated/api.schemas'

// Internal response types using native MediaSoup types
export interface CreateRoomResponse {
  djToken: string
  room: RoomInfo
  rtpCapabilities: types.RtpCapabilities  // Native type
  transportOptions: TransportOptions
  wsUrl: string
}

// Convert generated API response to internal format
const convertCreateRoomResponse = (apiResponse: GeneratedCreateRoomResponse): CreateRoomResponse => ({
  djToken: apiResponse.djToken,
  room: apiResponse.room,
  rtpCapabilities: {
    codecs: apiResponse.rtpCapabilities.codecs as any,
    headerExtensions: apiResponse.rtpCapabilities.headerExtensions as any
  } as types.RtpCapabilities,
  transportOptions: apiResponse.transportOptions,
  wsUrl: apiResponse.wsUrl
})

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

// Internal request types (native MediaSoup compatible)
export interface CreateRoomRequest {
  name: string
  description?: string
  tags?: string[]
  djName: string
}


export const createRoom = (
  request: CreateRoomRequest
): Effect.Effect<CreateRoomResponse, ApiError> =>
  pipe(
    Effect.tryPromise({
      try: () => {
        // Convert internal request to API format
        const apiRequest: GeneratedCreateRoomRequest = {
          name: request.name,
          description: request.description || null,
          tags: request.tags || null,
          djName: request.djName
        }
        return createRoomGenerated(apiRequest)
      },
      catch: error => new ApiError('Network error', 0, error)
    }),
    Effect.flatMap((response: any) => {
      if (response.status === 201 && response.data) {
        // Convert API response to internal format
        return Effect.succeed(convertCreateRoomResponse(response.data))
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

