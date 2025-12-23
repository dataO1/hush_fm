/**
 * User Domain Schema
 *
 * Defines the user state and operations for session management.
 * The sessionId is computed from browser fingerprint and used universally
 * for both DJ and listener operations.
 * Uses shared schema patterns and proper external type synchronization.
 *
 * Pattern: S.Schema.Type<> for store inference, S.Encoded vs S.Type for API boundaries
 */

import { Schema as S, Option, Data } from 'effect'

/**
 * User Role in Application
 */
export const UserRole = S.Literal('dj', 'listener')
export type UserRoleType = S.Schema.Type<typeof UserRole>

/**
 * Browser Fingerprint Data (for session ID computation)
 */
export const BrowserFingerprint = S.Struct({
  screenWidth: S.Number,
  screenHeight: S.Number,
  colorDepth: S.Number,
  userAgent: S.String,
  timezoneOffset: S.Number,
  language: S.String,
  languages: S.Array(S.String),
  hardwareConcurrency: S.Number,
  deviceMemory: S.Option(S.Number),
  platform: S.String,
  canvasFingerprint: S.String,
  webglFingerprint: S.String
})
export type BrowserFingerprintType = S.Schema.Type<typeof BrowserFingerprint>

/**
 * User State containing session identity and preferences
 */
export const UserState = S.Struct({
  /**
   * Unique session identifier computed from browser fingerprint.
   * Stable within browser session, deterministic across page loads.
   * Used for both DJ and listener operations.
   */
  sessionId: S.Option(S.String),


  /**
   * Current user role in the application
   */
  currentRole: S.Option(UserRole),

})
export type UserStateType = S.Schema.Type<typeof UserState>
export type UserStateEncoded = S.Schema.Encoded<typeof UserState>



/**
 * Initial User state factory for stores
 *
 * Returns clean application state (S.Schema.Type<> format)
 * Store pattern: const [userState, setUserState] = createStore<UserStateType>(createInitialUserState())
 */
export const createInitialUserState = (): UserStateType => ({
  sessionId: Option.none(),
  currentRole: Option.none(),
})

/**
 * User Domain Errors
 */
export class UserSessionError extends Data.TaggedError('UserSessionError')<{
  readonly cause: string
  readonly operation: string
  readonly timestamp: Date
}> {}

export class BrowserFingerprintError extends Data.TaggedError('BrowserFingerprintError')<{
  readonly cause: string
  readonly missingFeatures: string[]
  readonly timestamp: Date
}> {}



/**
 * DJ Publish Result
 * Result when a DJ successfully publishes their room
 */
export const DJPublishResult = S.Struct({
  roomId: S.String,
  producerId: S.String,
  djWebSocketUrl: S.String,
  publishedAt: S.Date
})
export type DJPublishResultType = S.Schema.Type<typeof DJPublishResult>

/**
 * Listener Join Result
 * Result when a listener successfully joins a room
 */
export const ListenerJoinResult = S.Struct({
  listenerId: S.String,
  roomId: S.String,
  sessionId: S.String,
  joinedAt: S.Date
})
export type ListenerJoinResultType = S.Schema.Type<typeof ListenerJoinResult>

/**
 * User Service Error
 * Used for all user service operations (DJ and Listener)
 */
export class UserServiceError extends Data.TaggedError('UserServiceError')<{
  readonly cause: string
  readonly operation: string
  readonly role: UserRoleType
  readonly step?: string
  readonly stepNumber?: number
  readonly recoverable?: boolean
  readonly timestamp: Date
}> {}

