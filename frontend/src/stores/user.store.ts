/**
 * User Store
 * 
 * Manages user session state including the browser fingerprint-based sessionId.
 * This store is independent and runs alongside lobby and room stores.
 */

import { createStore } from 'solid-js/store'
import { createSignal } from 'solid-js'
import { Option } from 'effect'
import type { 
  UserState, 
  UserActions
} from '../domain/schemas/user.schema'
import { createInitialUserState } from '../domain/schemas/user.schema'

/**
 * Create user store instance
 */
export const createUserStore = () => {
  // Main reactive state
  const [state, setState] = createStore(createInitialUserState() as any)
  
  // Additional UI signals
  const [isComputingSession, setIsComputingSession] = createSignal(false)
  
  // Pure state actions - no Effects, no service calls
  const actions: UserActions = {
    setSessionId: (sessionId: string) => {
      setState({
        sessionId: Option.some(sessionId),
        sessionInitialized: true,
        sessionComputedAt: Option.some(new Date())
      })
    },
    
    setSessionInitialized: (initialized: boolean) => {
      setState('sessionInitialized', initialized)
    },
    
    setSessionComputedAt: (timestamp: Date) => {
      setState('sessionComputedAt', Option.some(timestamp))
    },
    
    setCurrentRole: (role: 'dj' | 'listener' | null) => {
      setState('currentRole', role ? Option.some(role) : Option.none())
    },
    
    resetUserState: () => {
      setState(createInitialUserState() as any)
    }
  }
  
  return {
    // Reactive state (read-only)
    state: state as Readonly<UserState>,
    
    // UI signals
    isComputingSession,
    setIsComputingSession,
    
    // Actions
    actions,
    
    // Computed values
    get hasSessionId() {
      return Option.isSome(state.sessionId)
    },
    
    get sessionId() {
      return Option.getOrNull(state.sessionId)
    },
    
    get currentRole() {
      return Option.getOrNull(state.currentRole)
    },
    
    get sessionComputedAt() {
      return Option.getOrNull(state.sessionComputedAt)
    },
    
    get isSessionReady() {
      return state.sessionInitialized && Option.isSome(state.sessionId)
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
  globalUserStore = null
}