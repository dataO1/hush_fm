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
/**
 * User Domain Service
 *
 * All methods are pure functions that return validation/calculation results.
 * No external dependencies or side effects.
 */
export class User {
  /**
   * Generate authenticated session ID
   */
  static generateSessionId(userId: string): string {
    const timestamp = Date.now().toString(36)
    const randomPart = Math.random().toString(36).substr(2, 9)
    const userHash = userId.slice(0, 8)
    return `auth_${userHash}_${timestamp}_${randomPart}`
  }
}
