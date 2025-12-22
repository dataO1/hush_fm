/**
 * User Domain Service
 * 
 * Pure business logic for User entity.
 * Stateless functions that contain user-related business rules and validations.
 * No side effects, no API calls, no store updates.
 * 
 * Responsibilities:
 * - User validation rules
 * - Session management logic
 * - User profile validation
 * - Authentication business rules
 */

/**
 * User session types
 */
export type SessionStatus = 'anonymous' | 'authenticated' | 'expired' | 'invalid'

/**
 * User profile data
 */
export interface UserProfile {
  id: string
  displayName: string
  email?: string
  createdAt: Date
  lastActiveAt: Date
}

/**
 * Session data
 */
export interface SessionData {
  sessionId: string
  userId?: string
  createdAt: Date
  expiresAt: Date
  isActive: boolean
}

/**
 * User validation result
 */
export interface UserValidationResult {
  isValid: boolean
  errors: string[]
}

/**
 * User business rules constants
 */
export const USER_BUSINESS_RULES = {
  MIN_DISPLAY_NAME_LENGTH: 2,
  MAX_DISPLAY_NAME_LENGTH: 30,
  MAX_EMAIL_LENGTH: 100,
  
  // Session durations in milliseconds
  SESSION_DURATION: 24 * 60 * 60 * 1000, // 24 hours for authenticated users
  ANONYMOUS_SESSION_DURATION: 4 * 60 * 60 * 1000, // 4 hours
  
  MAX_CONCURRENT_SESSIONS: 3,
  SESSION_CLEANUP_INTERVAL: 60 * 60 * 1000, // 1 hour
} as const

/**
 * User Domain Service
 * 
 * All methods are pure functions that return validation/calculation results.
 * No external dependencies or side effects.
 */
export class User {
  /**
   * Generate anonymous session ID
   */
  static generateAnonymousSessionId(): string {
    const timestamp = Date.now().toString(36)
    const randomPart = Math.random().toString(36).substr(2, 9)
    return `anon_${timestamp}_${randomPart}`
  }

  /**
   * Generate authenticated session ID
   */
  static generateAuthenticatedSessionId(userId: string): string {
    const timestamp = Date.now().toString(36)
    const randomPart = Math.random().toString(36).substr(2, 9)
    const userHash = userId.slice(0, 8)
    return `auth_${userHash}_${timestamp}_${randomPart}`
  }

  /**
   * Validate display name
   */
  static validateDisplayName(displayName: string): UserValidationResult {
    const errors: string[] = []

    if (!displayName || displayName.trim().length === 0) {
      errors.push('Display name is required')
    }

    const trimmedName = displayName.trim()
    
    if (trimmedName.length < USER_BUSINESS_RULES.MIN_DISPLAY_NAME_LENGTH) {
      errors.push(`Display name must be at least ${USER_BUSINESS_RULES.MIN_DISPLAY_NAME_LENGTH} characters`)
    }

    if (trimmedName.length > USER_BUSINESS_RULES.MAX_DISPLAY_NAME_LENGTH) {
      errors.push(`Display name cannot exceed ${USER_BUSINESS_RULES.MAX_DISPLAY_NAME_LENGTH} characters`)
    }

    // Check for invalid characters
    const invalidChars = /[<>\/\\&"']/
    if (invalidChars.test(trimmedName)) {
      errors.push('Display name contains invalid characters')
    }

    return { isValid: errors.length === 0, errors }
  }

  /**
   * Validate email address
   */
  static validateEmail(email?: string): UserValidationResult {
    const errors: string[] = []

    if (!email) {
      return { isValid: true, errors } // Email is optional
    }

    if (email.length > USER_BUSINESS_RULES.MAX_EMAIL_LENGTH) {
      errors.push(`Email cannot exceed ${USER_BUSINESS_RULES.MAX_EMAIL_LENGTH} characters`)
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      errors.push('Invalid email format')
    }

    return { isValid: errors.length === 0, errors }
  }

  /**
   * Check if session is expired
   */
  static isSessionExpired(session: SessionData): boolean {
    return Date.now() > session.expiresAt.getTime()
  }

  /**
   * Calculate session expiry
   */
  static calculateSessionExpiry(isAuthenticated: boolean): Date {
    const duration = isAuthenticated 
      ? USER_BUSINESS_RULES.SESSION_DURATION
      : USER_BUSINESS_RULES.ANONYMOUS_SESSION_DURATION

    return new Date(Date.now() + duration)
  }

  /**
   * Validate user profile
   */
  static validateUserProfile(profile: Partial<UserProfile>): UserValidationResult {
    const errors: string[] = []

    if (!profile.id || profile.id.trim().length === 0) {
      errors.push('User ID is required')
    }

    if (profile.displayName) {
      const nameValidation = this.validateDisplayName(profile.displayName)
      errors.push(...nameValidation.errors)
    }

    if (profile.email) {
      const emailValidation = this.validateEmail(profile.email)
      errors.push(...emailValidation.errors)
    }

    return { isValid: errors.length === 0, errors }
  }
}