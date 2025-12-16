/**
 * User Domain Schema
 * 
 * Defines the user state and operations for session management.
 * The sessionId is computed from browser fingerprint and used universally
 * for both DJ and listener operations.
 */

import { Option } from 'effect'

/**
 * User state containing session identity and preferences
 */
export interface UserState {
  /** 
   * Unique session identifier computed from browser fingerprint.
   * Stable within browser session, deterministic across page loads.
   * Used for both DJ and listener operations.
   */
  sessionId: Option.Option<string>
  
  /**
   * Whether the sessionId has been computed and set
   */
  sessionInitialized: boolean
  
  /**
   * Timestamp when sessionId was last computed
   */
  sessionComputedAt: Option.Option<Date>
  
  /**
   * Current user role in the application
   */
  currentRole: Option.Option<'dj' | 'listener'>
}

/**
 * Create initial user state
 */
export const createInitialUserState = (): UserState => ({
  sessionId: Option.none(),
  sessionInitialized: false,
  sessionComputedAt: Option.none(),
  currentRole: Option.none()
})

/**
 * User store actions interface
 */
export interface UserActions {
  /**
   * Set the computed session ID
   */
  setSessionId: (sessionId: string) => void
  
  /**
   * Mark session as initialized
   */
  setSessionInitialized: (initialized: boolean) => void
  
  /**
   * Set the timestamp when session was computed
   */
  setSessionComputedAt: (timestamp: Date) => void
  
  /**
   * Set the current user role
   */
  setCurrentRole: (role: 'dj' | 'listener' | null) => void
  
  /**
   * Reset user state
   */
  resetUserState: () => void
}

/**
 * Browser fingerprint data used for session ID computation
 */
export interface BrowserFingerprint {
  /** Screen dimensions */
  screenWidth: number
  screenHeight: number
  
  /** Color depth */
  colorDepth: number
  
  /** User agent string */
  userAgent: string
  
  /** Timezone offset */
  timezoneOffset: number
  
  /** Language preferences */
  language: string
  languages: string[]
  
  /** Hardware information */
  hardwareConcurrency: number
  
  /** Available memory (if available) */
  deviceMemory?: number
  
  /** Platform information */
  platform: string
  
  /** Canvas fingerprint */
  canvasFingerprint: string
  
  /** WebGL fingerprint */
  webglFingerprint: string
}

/**
 * Type for session ID computation result
 */
export interface SessionIdComputation {
  sessionId: string
  fingerprint: BrowserFingerprint
  computedAt: Date
}