/**
 * User Store
 * 
 * Manages user session state including the browser fingerprint-based sessionId.
 * This store is independent and runs alongside lobby and room stores.
 */

import { createStore, produce } from 'solid-js/store'
import { createSignal } from 'solid-js'
import { Option } from 'effect'
import type { 
  UserStateType,
  UserRoleType
} from '../domain/schemas/user.schema'
import { createInitialUserState } from '../domain/schemas/user.schema'

/**
 * Create user store instance
 */
/**
 * User store actions interface (using schema-inferred types)
 */
export interface UserActions {
  setSessionId: (sessionId: string) => void
  setSessionInitialized: (initialized: boolean) => void
  setSessionComputedAt: (timestamp: string) => void
  setCurrentRole: (role: UserRoleType | null) => void
  setFingerprint: (fingerprint: any) => void
  setPreferences: (preferences: Partial<UserStateType['preferences']>) => void
  resetUserState: () => void
}

export const createUserStore = () => {
  // Main reactive state using schema-inferred types
  const [state, setState] = createStore<UserStateType>(createInitialUserState())
  
  // Additional UI signals
  const [isComputingSession, setIsComputingSession] = createSignal(false)
  
  // Pure state actions - no Effects, no service calls
  const actions: UserActions = {
    setSessionId: (sessionId: string) => {
      setState({
        sessionId: Option.some(sessionId),
        sessionInitialized: true,
        sessionComputedAt: Option.some(new Date().toISOString())
      })
    },
    
    setSessionInitialized: (initialized: boolean) => {
      setState({
        sessionInitialized: initialized
      })
    },
    
    setSessionComputedAt: (timestamp: string) => {
      setState({
        sessionComputedAt: Option.some(timestamp)
      })
    },
    
    setCurrentRole: (role: UserRoleType | null) => {
      setState({
        currentRole: role ? Option.some(role) : Option.none()
      })
    },
    
    setFingerprint: (fingerprint: any) => {
      setState({
        fingerprint: Option.some(fingerprint)
      })
    },
    
    setPreferences: (preferences: Partial<UserStateType['preferences']>) => {
      setState(produce((draft) => {
        Object.assign(draft.preferences, preferences)
      }))
    },
    
    resetUserState: () => {
      setState(createInitialUserState())
    }
  }
  
  return {
    // Reactive state (read-only)
    state: state as Readonly<UserStateType>,
    
    // UI signals
    isComputingSession,
    setIsComputingSession,
    
    // Actions
    actions,
    
    // Computed values with proper Option handling for SolidJS 2025 reactivity
    // Using getters that don't destructure to maintain fine-grained reactivity
    get hasSessionId() {
      return Option.isSome(state.sessionId)
    },
    
    get sessionId() {
      // Safe getter for UI consumption (perfect for <Show> components)
      return Option.getOrNull(state.sessionId)
    },
    
    get currentRole() {
      // Convert Option to nullable for UI logic
      return Option.getOrNull(state.currentRole)
    },
    
    get sessionComputedAt() {
      return Option.getOrNull(state.sessionComputedAt)
    },
    
    get isSessionReady() {
      // Direct property access maintains reactivity
      return state.sessionInitialized && Option.isSome(state.sessionId)
    },
    
    get fingerprint() {
      return Option.getOrNull(state.fingerprint)
    },
    
    get preferences() {
      return state.preferences
    },
    
    // Option helper methods for UI components
    get themeOption() {
      return Option.getOrElse(state.preferences.theme, () => 'system')
    },
    
    get audioQualityOption() {
      return Option.getOrElse(state.preferences.audioQuality, () => 'medium')
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