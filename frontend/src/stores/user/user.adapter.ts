/**
 * User Store Adapter
 *
 * Effect-TS Context.Tag pattern for user state management.
 * Services use this tag for dependency injection, never importing the implementation directly.
 */

import { Context, Layer, Option } from 'effect'
import type { UserStore } from './user.store'
import { getUserStore } from './user.store'
import type { UserRoleType } from '../../domain/schemas/user.schema'

/**
 * User Adapter Interface
 *
 * Service layer contract for user state management.
 */
interface UserAdapterImpl {
  // Session management
  setSessionId: (sessionId: string) => void
  clearSessionId: () => void
  getSessionId: () => Option.Option<string>
  hasSession: () => boolean
  
  // Role management
  setCurrentRole: (role: UserRoleType) => void
  clearCurrentRole: () => void
  getCurrentRole: () => Option.Option<UserRoleType>
  isDJ: () => boolean
  isListener: () => boolean
  
  // Reset
  reset: () => void
}

/**
 * User Adapter Context Tag
 *
 * Services import and use this tag for dependency injection.
 * Uses modern 2025 Effect-TS class-based Tag syntax.
 */
export class UserAdapter extends Context.Tag("@app/adapters/UserAdapter")<
  UserAdapter,
  UserAdapterImpl
>() {}

/**
 * User Adapter Implementation
 *
 * Creates a UserAdapter implementation using the UserStore.
 * This is used by the Layer, never imported directly by services.
 */
const createUserAdapterImpl = (
  store?: UserStore
): UserAdapterImpl => {
  const userStore = store || getUserStore()

  return {
    // Session management
    setSessionId: (sessionId: string) => {
      userStore.actions.setSessionId(sessionId)
    },

    clearSessionId: () => {
      userStore.actions.clearSessionId()
    },

    getSessionId: () => {
      return userStore.state.sessionId
    },

    hasSession: () => {
      return userStore.hasSessionId
    },

    // Role management
    setCurrentRole: (role: UserRoleType) => {
      userStore.actions.setCurrentRole(role)
    },

    clearCurrentRole: () => {
      userStore.actions.clearCurrentRole()
    },

    getCurrentRole: () => {
      return userStore.state.currentRole
    },

    isDJ: () => {
      return userStore.isDJ
    },

    isListener: () => {
      return userStore.isListener
    },

    // Reset
    reset: () => {
      userStore.actions.reset()
    }
  }
}

/**
 * User Adapter Layer
 *
 * Live implementation layer that provides the UserAdapter using SolidJS stores.
 * Use this in your app's main Layer composition.
 */
export const UserAdapterLive = Layer.succeed(
  UserAdapter,
  createUserAdapterImpl()
)