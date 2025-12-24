/**
 * User Store
 *
 * Manages user session state including sessionId and current role.
 * This store is independent and runs alongside lobby and room stores.
 */

import { createStore } from 'solid-js/store'
import { Option, pipe } from 'effect'
import type { UserStateType, UserRoleType } from '../../domain/schemas/user.schema'
import { createInitialUserState } from '../../domain/schemas/user.schema'

/**
 * User store actions interface
 */
export interface UserActions {
  setSessionId: (sessionId: string) => void
  clearSessionId: () => void
  setCurrentRole: (role: UserRoleType) => void
  clearCurrentRole: () => void
  reset: () => void
}

/**
 * Create user store instance
 */
export const createUserStore = () => {
  // Main reactive state using schema-inferred types
  const [state, setState] = createStore<UserStateType>(createInitialUserState())

  // Pure state actions - no Effects, no service calls
  const actions: UserActions = {
    setSessionId: (sessionId: string) => {
      setState({ sessionId: Option.some(sessionId) })
    },

    clearSessionId: () => {
      setState({ sessionId: Option.none() })
    },

    setCurrentRole: (role: UserRoleType) => {
      setState({ currentRole: Option.some(role) })
    },

    clearCurrentRole: () => {
      setState({ currentRole: Option.none() })
    },

    reset: () => {
      setState(createInitialUserState())
    }
  }

  return {
    // Reactive state (read-only)
    state: state as Readonly<UserStateType>,

    // Actions
    actions,

    // Computed values with proper Option handling
    get hasSessionId() {
      return Option.isSome(state.sessionId)
    },

    get sessionId() {
      return Option.getOrNull(state.sessionId)
    },

    get currentRole() {
      return Option.getOrNull(state.currentRole)
    },

    get isDJ() {
      return pipe(
        state.currentRole,
        Option.map(role => role === 'dj'),
        Option.getOrElse(() => false)
      )
    },

    get isListener() {
      return pipe(
        state.currentRole,
        Option.map(role => role === 'listener'),
        Option.getOrElse(() => false)
      )
    }
  }
}

/**
 * User store type
 */
export type UserStore = ReturnType<typeof createUserStore>

/**
 * Global user store instance (singleton pattern)
 * This ensures consistent session ID across the application
 */
let globalUserStore: UserStore | null = null

/**
 * Get or create the global user store instance
 */
export const getUserStore = (): UserStore => {
  if (!globalUserStore) {
    globalUserStore = createUserStore()
  }
  return globalUserStore
}

/**
 * Reset the global user store (useful for testing)
 */
export const resetGlobalUserStore = (): void => {
  if (globalUserStore) {
    globalUserStore.actions.reset()
  }
  globalUserStore = null
}