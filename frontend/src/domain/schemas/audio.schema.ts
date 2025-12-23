import { Schema as S, Option, Data } from 'effect'
import { Device } from 'mediasoup-client'
import { WebAPISchemas } from './shared'
/**
 * DJ Audio Track State (Step 4: getUserMedia)
 */
export const StreamState = S.Struct({
  track: S.Option(WebAPISchemas.MediaStreamTrack),
  stream: S.Option(WebAPISchemas.MediaStream),
  deviceId: S.Option(S.String),
  constraints: S.Option(WebAPISchemas.MediaTrackConstraints),
  acquiredAt: S.Option(S.DateFromString),
  error: S.Option(S.String)
})
export type StreamStateType = S.Schema.Type<typeof StreamState>


export class AudioTrackError extends Data.TaggedError('AudioTrackError')<{
  readonly cause: string
  readonly operation: 'getUserMedia' | 'constraints' | 'track'
  readonly timestamp: Date
}> {}


export class AudioPlaybackError extends Data.TaggedError('AudioPlaybackError')<{
  readonly cause: string
  readonly operation: 'play' | 'pause' | 'volume' | 'autoplay'
  readonly autoplayBlocked: boolean
  readonly timestamp: Date
}> {}
