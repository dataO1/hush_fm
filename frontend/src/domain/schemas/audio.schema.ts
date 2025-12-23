import { Schema as S, Option, Data } from 'effect'
import { Device } from 'mediasoup-client'
import { WebAPISchemas, WebAPITypes } from './shared'
/**
 * DJ Audio Track State (Step 4: getUserMedia)
 */
export const StreamState = S.Struct({
  playing: S.Boolean,
  deviceId: S.Option(S.String),
  constraints: S.Option(WebAPISchemas.MediaTrackConstraints),
  acquiredAt: S.Option(S.DateFromString),
  error: S.Option(S.String),
  requiresUserGesture: S.Boolean,
  permission: S.Option(WebAPISchemas.PermissionState)
})
export type StreamStateType = S.Schema.Type<typeof StreamState>


export class AudioTrackError extends Data.TaggedError('AudioTrackError')<{
  readonly cause: string
  readonly operation: 'getUserMedia' | 'constraints' | 'track'
  readonly timestamp: Date
}> {}


export class AudioPlaybackError extends Data.TaggedError('AudioPlaybackError')<{
  readonly cause: string
  readonly operation: 'play' | 'pause' | 'volume' | 'autoplay' | 'create' | 'destroy' | 'manualPlay'
  readonly autoplayBlocked: boolean
  readonly timestamp: Date
}> {}

/**
 * Audio Device Error
 */
export class AudioDeviceError extends Data.TaggedError('AudioDeviceError')<{
  readonly cause: string
  readonly operation: 'enumerate' | 'getDefault' | 'getUserMedia' | 'preview' | 'stopPreview'
  readonly deviceId?: string
  readonly timestamp: Date
}> {}

/**
 * Audio Service Error Union
 */
export type AudioServiceError = AudioTrackError | AudioPlaybackError | AudioDeviceError
