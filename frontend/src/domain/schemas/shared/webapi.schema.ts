/**
 * Web API Schema Synchronization
 *
 * Strict type synchronization with Web API interfaces using Effect Schema.
 * Handles DOM objects, MediaStream API, and other browser APIs.
 *
 * Pattern: Use S.instanceOf for DOM objects and S.as for complex interfaces
 */

import { Schema as S } from 'effect'

/**
 * WebSocket Schema (synchronized with WebSocket interface)
 */

/**
 * MediaTrackConstraints Schema (synchronized with MediaTrackConstraints interface)
 * Using structured schema with transformations for constraint values
 */
export const MediaTrackConstraintsSchema = S.Struct({
  // Device selection
  deviceId: S.Option(S.Union(
    S.String,
    S.Struct({
      exact: S.String
    }),
    S.Struct({
      ideal: S.String
    })
  )),

  // Audio quality constraints
  sampleRate: S.Option(S.Union(
    S.Number,
    S.Struct({
      ideal: S.Number,
      min: S.Option(S.Number),
      max: S.Option(S.Number)
    })
  )),
  channelCount: S.Option(S.Union(
    S.Number,
    S.Struct({
      ideal: S.Number,
      exact: S.Option(S.Number)
    })
  )),
  sampleSize: S.Option(S.Union(
    S.Number,
    S.Struct({
      ideal: S.Number
    })
  )),

  // Latency optimization
  latency: S.Option(S.Union(
    S.Number,
    S.Struct({
      ideal: S.Number
    })
  )),

  // Audio processing controls
  echoCancellation: S.Option(S.Union(
    S.Boolean,
    S.Struct({
      exact: S.Boolean
    })
  )),
  noiseSuppression: S.Option(S.Union(
    S.Boolean,
    S.Struct({
      exact: S.Boolean
    })
  )),
  autoGainControl: S.Option(S.Union(
    S.Boolean,
    S.Struct({
      exact: S.Boolean
    })
  )),

  // Chrome-specific constraints
  googEchoCancellation: S.Option(S.Union(
    S.Boolean,
    S.Struct({
      exact: S.Boolean
    })
  )),
  googAutoGainControl: S.Option(S.Union(
    S.Boolean,
    S.Struct({
      exact: S.Boolean
    })
  )),
  googNoiseSuppression: S.Option(S.Union(
    S.Boolean,
    S.Struct({
      exact: S.Boolean
    })
  )),
  googHighpassFilter: S.Option(S.Union(
    S.Boolean,
    S.Struct({
      exact: S.Boolean
    })
  )),
  googTypingNoiseDetection: S.Option(S.Union(
    S.Boolean,
    S.Struct({
      exact: S.Boolean
    })
  )),
  suppressLocalAudioPlayback: S.Option(S.Union(
    S.Boolean,
    S.Struct({
      exact: S.Boolean
    })
  ))
})
export type MediaTrackConstraintsType = S.Schema.Type<typeof MediaTrackConstraintsSchema>

/**
 * MediaStreamConstraints Schema (synchronized with MediaStreamConstraints interface)
 */
export const MediaStreamConstraintsSchema = S.Struct({
  audio: S.Union(
    S.Boolean,
    MediaTrackConstraintsSchema
  ),
  video: S.Union(
    S.Boolean,
    S.Struct({
      width: S.Option(S.Number),
      height: S.Option(S.Number)
    })
  )
})
export type MediaStreamConstraintsType = S.Schema.Type<typeof MediaStreamConstraintsSchema>

/**
 * MediaDeviceInfo Schema (synchronized with MediaDeviceInfo interface)
 */
export const MediaDeviceInfoSchema = S.Struct({
  deviceId: S.String,
  groupId: S.String,
  kind: S.Union(
    S.Literal('audioinput'),
    S.Literal('audiooutput'),
    S.Literal('videoinput')
  ),
  label: S.String
})
export type MediaDeviceInfoType = S.Schema.Type<typeof MediaDeviceInfoSchema>


/**
 * PermissionState Schema (synchronized with browser PermissionState type)
 * Used for navigator.permissions.query() results
 */
export const PermissionStateSchema = S.Union(
  S.Literal('granted'),
  S.Literal('denied'),
  S.Literal('prompt')
)
export type PermissionStateType = S.Schema.Type<typeof PermissionStateSchema>

/**
 * Error Schema (for JavaScript Error objects)
 */
export const ErrorSchema = S.Struct({
  name: S.String,
  message: S.String,
  stack: S.Option(S.String),
  cause: S.Option(S.Unknown)
})
export type ErrorType = S.Schema.Type<typeof ErrorSchema>

/**
 * Consolidated Web API Schemas for easy import
 */
export const WebAPISchemas = {
  MediaTrackConstraints: MediaTrackConstraintsSchema,
  MediaStreamConstraints: MediaStreamConstraintsSchema,
  MediaDeviceInfo: MediaDeviceInfoSchema,
  PermissionState: PermissionStateSchema,
  Error: ErrorSchema
}

/**
 * Consolidated Web API Types for easy import
 */
export type WebAPITypes = {
  MediaTrackConstraints: MediaTrackConstraintsType
  MediaStreamConstraints: MediaStreamConstraintsType
  MediaDeviceInfo: MediaDeviceInfoType
  PermissionState: PermissionStateType
  Error: ErrorType
}
