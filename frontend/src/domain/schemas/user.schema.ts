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
 * Session ID Computation Result
 */
export const SessionIdComputation = S.Struct({
  sessionId: S.String,
  fingerprint: BrowserFingerprint,
  computedAt: S.DateFromString
})
export type SessionIdComputationType = S.Schema.Type<typeof SessionIdComputation>

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
   * Whether the sessionId has been computed and set
   */
  sessionInitialized: S.Boolean,
  
  /**
   * Timestamp when sessionId was last computed
   */
  sessionComputedAt: S.Option(S.DateFromString),
  
  /**
   * Current user role in the application
   */
  currentRole: S.Option(UserRole),
  
  /**
   * Browser fingerprint data used for session computation
   */
  fingerprint: S.Option(BrowserFingerprint),
  
  /**
   * User preferences
   */
  preferences: S.Struct({
    theme: S.Option(S.Literal('light', 'dark', 'system')),
    audioQuality: S.Option(S.Literal('low', 'medium', 'high')),
    autoplay: S.Boolean
  })
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
  sessionInitialized: false,
  sessionComputedAt: Option.none(),
  currentRole: Option.none(),
  fingerprint: Option.none(),
  preferences: {
    theme: Option.none(),
    audioQuality: Option.none(),
    autoplay: true
  }
})

/**
 * User State Decoders for Infrastructure Services
 * 
 * Use at API boundaries to validate incoming data
 */
export const UserStateDecoders = {
  /**
   * Decode complete User state
   */
  decodeUserState: S.decodeUnknown(UserState),
  
  /**
   * Decode browser fingerprint data
   */
  decodeBrowserFingerprint: S.decodeUnknown(BrowserFingerprint),
  
  /**
   * Decode session computation result
   */
  decodeSessionComputation: S.decodeUnknown(SessionIdComputation),
  
  /**
   * Decode user role
   */
  decodeUserRole: S.decodeUnknown(UserRole)
}

/**
 * User State Validators for runtime checks
 */
export const UserStateValidators = {
  /**
   * Validate user role
   */
  validateUserRole: (role: unknown): role is UserRoleType => 
    S.is(UserRole)(role),
  
  /**
   * Validate browser fingerprint
   */
  validateBrowserFingerprint: (fingerprint: unknown): fingerprint is BrowserFingerprintType => 
    S.is(BrowserFingerprint)(fingerprint),
  
  /**
   * Validate complete User state
   */
  validateUserState: (state: unknown): state is UserStateType => 
    S.is(UserState)(state)
}

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