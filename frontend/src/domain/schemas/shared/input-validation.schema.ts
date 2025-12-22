/**
 * User Input Validation Schema Patterns
 * 
 * Validation schemas for user inputs, form data, and API parameters.
 * Provides strict validation with helpful error messages and transformations.
 */

import { Schema as S } from 'effect'

/**
 * Audio Device Selection Validation
 */
export const AudioDeviceSelection = S.Struct({
  deviceId: S.String,
  label: S.String,
  kind: S.Literal('audioinput', 'audiooutput'),
  groupId: S.String
})
export type AudioDeviceSelectionType = S.Schema.Type<typeof AudioDeviceSelection>

/**
 * Room Identifier Validation (UUID format)
 */
export const RoomIdentifier = S.String.pipe(
  S.pattern(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/)
)
export type RoomIdentifierType = S.Schema.Type<typeof RoomIdentifier>

/**
 * User Session Identifier Validation (browser fingerprint hash)
 */
export const UserSessionId = S.String.pipe(
  S.minLength(8),
  S.maxLength(64),
  S.pattern(/^[a-zA-Z0-9]+$/)
)
export type UserSessionIdType = S.Schema.Type<typeof UserSessionId>

/**
 * WebSocket Connection URL Validation
 */
export const WebSocketConnectionUrl = S.Union(
  S.String.pipe(S.startsWith('ws://')),
  S.String.pipe(S.startsWith('wss://'))
)
export type WebSocketConnectionUrlType = S.Schema.Type<typeof WebSocketConnectionUrl>

/**
 * Room Name Input Validation
 */
export const RoomNameInput = S.String.pipe(
  S.minLength(1),
  S.maxLength(100)
)
export type RoomNameInputType = S.Schema.Type<typeof RoomNameInput>

/**
 * DJ Name Input Validation
 */
export const DJNameInput = S.String.pipe(
  S.minLength(1),
  S.maxLength(50)
)
export type DJNameInputType = S.Schema.Type<typeof DJNameInput>

/**
 * Room Description Input Validation
 */
export const RoomDescriptionInput = S.Option(S.String.pipe(
  S.maxLength(500)
))
export type RoomDescriptionInputType = S.Schema.Type<typeof RoomDescriptionInput>

/**
 * Room Tags Input Validation
 */
export const RoomTagsInput = S.Array(
  S.String.pipe(
    S.minLength(1),
    S.maxLength(20)
  )
).pipe(
  S.maxItems(10)
)
export type RoomTagsInputType = S.Schema.Type<typeof RoomTagsInput>

/**
 * Audio Volume Level Validation (0.0-1.0)
 */
export const AudioVolumeLevel = S.Number.pipe(
  S.between(0, 1)
)
export type AudioVolumeLevelType = S.Schema.Type<typeof AudioVolumeLevel>

/**
 * Network Quality Percentage Validation (0-100)
 */
export const NetworkQualityPercentage = S.Number.pipe(
  S.between(0, 100)
)
export type NetworkQualityPercentageType = S.Schema.Type<typeof NetworkQualityPercentage>

/**
 * Consolidated Input Validation Schemas for easy import
 */
export const InputValidationSchemas = {
  AudioDevice: AudioDeviceSelection,
  RoomId: RoomIdentifier,
  SessionId: UserSessionId,
  WebSocketUrl: WebSocketConnectionUrl,
  RoomName: RoomNameInput,
  DJName: DJNameInput,
  RoomDescription: RoomDescriptionInput,
  RoomTags: RoomTagsInput,
  VolumeLevel: AudioVolumeLevel,
  QualityPercentage: NetworkQualityPercentage
}

/**
 * Consolidated Input Validation Types for easy import
 */
export type InputValidationTypes = {
  AudioDevice: AudioDeviceSelectionType
  RoomId: RoomIdentifierType
  SessionId: UserSessionIdType
  WebSocketUrl: WebSocketConnectionUrlType
  RoomName: RoomNameInputType
  DJName: DJNameInputType
  RoomDescription: RoomDescriptionInputType
  RoomTags: RoomTagsInputType
  VolumeLevel: AudioVolumeLevelType
  QualityPercentage: NetworkQualityPercentageType
}