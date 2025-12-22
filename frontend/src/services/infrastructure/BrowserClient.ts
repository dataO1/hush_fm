/**
 * Browser Infrastructure Client
 * 
 * Pure technical layer for browser APIs.
 * No business logic - only handles browser capabilities and APIs.
 * 
 * Responsibilities:
 * - Navigation and history management
 * - Local/session storage operations
 * - Browser events (visibility, unload)
 * - Browser capability detection
 * - DOM utilities
 */

import { Effect, pipe, Context, Layer } from 'effect'

/**
 * Storage types
 */
export type StorageType = 'local' | 'session'

/**
 * Navigation direction
 */
export type NavigationDirection = 'forward' | 'back'

/**
 * Browser Infrastructure Error
 */
export class BrowserInfrastructureError extends Error {
  constructor(
    message: string,
    public operation: string,
    public cause?: unknown
  ) {
    super(message)
    this.name = 'BrowserInfrastructureError'
  }
}

/**
 * Browser event listener cleanup function
 */
export type EventCleanup = () => void

/**
 * Browser Client Interface
 */
export interface BrowserClient {
  /**
   * Storage operations
   */
  readonly storage: {
    set: (type: StorageType, key: string, value: any) => Effect.Effect<void, BrowserInfrastructureError>
    get: <T = any>(type: StorageType, key: string) => Effect.Effect<T | null, BrowserInfrastructureError>
    remove: (type: StorageType, key: string) => Effect.Effect<void, BrowserInfrastructureError>
    clear: (type: StorageType) => Effect.Effect<void, BrowserInfrastructureError>
  }

  /**
   * Navigation operations
   */
  readonly navigation: {
    getCurrentUrl: () => Effect.Effect<string, never>
    getPathname: () => Effect.Effect<string, never>
    navigate: (url: string) => Effect.Effect<void, BrowserInfrastructureError>
    back: () => Effect.Effect<void, BrowserInfrastructureError>
    forward: () => Effect.Effect<void, BrowserInfrastructureError>
    reload: () => Effect.Effect<void, never>
  }

  /**
   * Event management
   */
  readonly events: {
    onVisibilityChange: (handler: (hidden: boolean) => void) => Effect.Effect<EventCleanup, never>
    onBeforeUnload: (handler: (event: BeforeUnloadEvent) => void) => Effect.Effect<EventCleanup, never>
    onPageHide: (handler: (event: PageTransitionEvent) => void) => Effect.Effect<EventCleanup, never>
    onPageShow: (handler: (event: PageTransitionEvent) => void) => Effect.Effect<EventCleanup, never>
    onPopState: (handler: (event: PopStateEvent) => void) => Effect.Effect<EventCleanup, never>
  }

  /**
   * Browser capabilities
   */
  readonly capabilities: {
    isOnline: () => Effect.Effect<boolean, never>
    getUserAgent: () => Effect.Effect<string, never>
    getLanguage: () => Effect.Effect<string, never>
    getTimezone: () => Effect.Effect<string, never>
    hasFeature: (feature: string) => Effect.Effect<boolean, never>
  }

  /**
   * DOM utilities
   */
  readonly dom: {
    getElement: <T extends Element = Element>(selector: string) => Effect.Effect<T | null, never>
    createElement: <T extends HTMLElement = HTMLElement>(tag: string) => Effect.Effect<T, BrowserInfrastructureError>
    isDocumentReady: () => Effect.Effect<boolean, never>
    waitForDocumentReady: () => Effect.Effect<void, never>
  }
}

/**
 * Get storage object by type
 */
const getStorage = (type: StorageType): Storage => {
  return type === 'local' ? localStorage : sessionStorage
}

/**
 * Browser Client Implementation
 */
/**
 * Browser Client Context Tag
 * 
 * Services import and use this tag for dependency injection.
 * Uses the same name as the interface for clean imports.
 */
export class BrowserClient extends Context.Tag("@app/infrastructure/BrowserClient")<
  BrowserClient,
  BrowserClient
>() {}

/**
 * Browser Client Implementation
 */
const BrowserClientImpl: BrowserClient = {
  /**
   * Storage operations
   */
  storage: {
    set: (type: StorageType, key: string, value: any): Effect.Effect<void, BrowserInfrastructureError> =>
      pipe(
        Effect.sync(() => {
          const storage = getStorage(type)
          const serializedValue = typeof value === 'string' ? value : JSON.stringify(value)
          storage.setItem(key, serializedValue)
        }),
        Effect.catchAll(error =>
          Effect.fail(new BrowserInfrastructureError(
            `Failed to set ${type} storage`,
            'storage.set',
            error
          ))
        )
      ),

    get: <T = any>(type: StorageType, key: string): Effect.Effect<T | null, BrowserInfrastructureError> =>
      pipe(
        Effect.sync(() => {
          const storage = getStorage(type)
          const value = storage.getItem(key)
          
          if (value === null) return null
          
          // Try to parse as JSON, fallback to string
          try {
            return JSON.parse(value) as T
          } catch {
            return value as T
          }
        }),
        Effect.catchAll(error =>
          Effect.fail(new BrowserInfrastructureError(
            `Failed to get ${type} storage`,
            'storage.get',
            error
          ))
        )
      ),

    remove: (type: StorageType, key: string): Effect.Effect<void, BrowserInfrastructureError> =>
      pipe(
        Effect.sync(() => {
          const storage = getStorage(type)
          storage.removeItem(key)
        }),
        Effect.catchAll(error =>
          Effect.fail(new BrowserInfrastructureError(
            `Failed to remove from ${type} storage`,
            'storage.remove',
            error
          ))
        )
      ),

    clear: (type: StorageType): Effect.Effect<void, BrowserInfrastructureError> =>
      pipe(
        Effect.sync(() => {
          const storage = getStorage(type)
          storage.clear()
        }),
        Effect.catchAll(error =>
          Effect.fail(new BrowserInfrastructureError(
            `Failed to clear ${type} storage`,
            'storage.clear',
            error
          ))
        )
      )
  },

  /**
   * Navigation operations
   */
  navigation: {
    getCurrentUrl: (): Effect.Effect<string, never> =>
      Effect.sync(() => window.location.href),

    getPathname: (): Effect.Effect<string, never> =>
      Effect.sync(() => window.location.pathname),

    navigate: (url: string): Effect.Effect<void, BrowserInfrastructureError> =>
      pipe(
        Effect.sync(() => {
          window.location.href = url
        }),
        Effect.catchAll(error =>
          Effect.fail(new BrowserInfrastructureError(
            'Failed to navigate',
            'navigation.navigate',
            error
          ))
        )
      ),

    back: (): Effect.Effect<void, BrowserInfrastructureError> =>
      pipe(
        Effect.sync(() => {
          window.history.back()
        }),
        Effect.catchAll(error =>
          Effect.fail(new BrowserInfrastructureError(
            'Failed to navigate back',
            'navigation.back',
            error
          ))
        )
      ),

    forward: (): Effect.Effect<void, BrowserInfrastructureError> =>
      pipe(
        Effect.sync(() => {
          window.history.forward()
        }),
        Effect.catchAll(error =>
          Effect.fail(new BrowserInfrastructureError(
            'Failed to navigate forward',
            'navigation.forward',
            error
          ))
        )
      ),

    reload: (): Effect.Effect<void, never> =>
      Effect.sync(() => {
        window.location.reload()
      })
  },

  /**
   * Event management
   */
  events: {
    onVisibilityChange: (handler: (hidden: boolean) => void): Effect.Effect<EventCleanup, never> =>
      Effect.sync(() => {
        const eventHandler = () => {
          handler(document.hidden)
        }
        
        document.addEventListener('visibilitychange', eventHandler)
        
        return () => {
          document.removeEventListener('visibilitychange', eventHandler)
        }
      }),

    onBeforeUnload: (handler: (event: BeforeUnloadEvent) => void): Effect.Effect<EventCleanup, never> =>
      Effect.sync(() => {
        window.addEventListener('beforeunload', handler)
        
        return () => {
          window.removeEventListener('beforeunload', handler)
        }
      }),

    onPageHide: (handler: (event: PageTransitionEvent) => void): Effect.Effect<EventCleanup, never> =>
      Effect.sync(() => {
        window.addEventListener('pagehide', handler)
        
        return () => {
          window.removeEventListener('pagehide', handler)
        }
      }),

    onPageShow: (handler: (event: PageTransitionEvent) => void): Effect.Effect<EventCleanup, never> =>
      Effect.sync(() => {
        window.addEventListener('pageshow', handler)
        
        return () => {
          window.removeEventListener('pageshow', handler)
        }
      }),

    onPopState: (handler: (event: PopStateEvent) => void): Effect.Effect<EventCleanup, never> =>
      Effect.sync(() => {
        window.addEventListener('popstate', handler)
        
        return () => {
          window.removeEventListener('popstate', handler)
        }
      })
  },

  /**
   * Browser capabilities
   */
  capabilities: {
    isOnline: (): Effect.Effect<boolean, never> =>
      Effect.sync(() => navigator.onLine),

    getUserAgent: (): Effect.Effect<string, never> =>
      Effect.sync(() => navigator.userAgent),

    getLanguage: (): Effect.Effect<string, never> =>
      Effect.sync(() => navigator.language),

    getTimezone: (): Effect.Effect<string, never> =>
      Effect.sync(() => Intl.DateTimeFormat().resolvedOptions().timeZone),

    hasFeature: (feature: string): Effect.Effect<boolean, never> =>
      Effect.sync(() => {
        switch (feature) {
          case 'webrtc':
            return !!(window.RTCPeerConnection || (window as any).mozRTCPeerConnection || (window as any).webkitRTCPeerConnection)
          case 'websocket':
            return !!window.WebSocket
          case 'webaudio':
            return !!(window.AudioContext || (window as any).webkitAudioContext)
          case 'getUserMedia':
            return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
          case 'localStorage':
            return typeof localStorage !== 'undefined'
          case 'sessionStorage':
            return typeof sessionStorage !== 'undefined'
          case 'serviceWorker':
            return 'serviceWorker' in navigator
          default:
            return false
        }
      })
  },

  /**
   * DOM utilities
   */
  dom: {
    getElement: <T extends Element = Element>(selector: string): Effect.Effect<T | null, never> =>
      Effect.sync(() => document.querySelector<T>(selector)),

    createElement: <T extends HTMLElement = HTMLElement>(tag: string): Effect.Effect<T, BrowserInfrastructureError> =>
      pipe(
        Effect.sync(() => document.createElement(tag) as T),
        Effect.catchAll(error =>
          Effect.fail(new BrowserInfrastructureError(
            'Failed to create element',
            'dom.createElement',
            error
          ))
        )
      ),

    isDocumentReady: (): Effect.Effect<boolean, never> =>
      Effect.sync(() => document.readyState === 'complete'),

    waitForDocumentReady: (): Effect.Effect<void, never> =>
      pipe(
        Effect.async<void, never>((resume) => {
          if (document.readyState === 'complete') {
            resume(Effect.succeed(void 0))
            return Effect.void
          }
          
          const handler = () => {
            if (document.readyState === 'complete') {
              document.removeEventListener('readystatechange', handler)
              resume(Effect.succeed(void 0))
            }
          }
          
          document.addEventListener('readystatechange', handler)
          
          return Effect.sync(() => {
            document.removeEventListener('readystatechange', handler)
          })
        })
      )
  }
}

/**
 * Browser Client Service Layer
 */
/**
 * Browser Client Layer
 * 
 * Live implementation layer that provides the BrowserClient.
 * Use this in your app's main Layer composition.
 */
export const BrowserClientLive = Layer.succeed(
  BrowserClient,
  BrowserClientImpl
)

/**
 * Convenience functions for common browser operations
 */
export namespace BrowserAPI {
  /**
   * Check if running in development mode
   */
  export const isDevelopment = () =>
    Effect.sync(() => 
      window.location.hostname === 'localhost' || 
      window.location.hostname.includes('127.0.0.1') ||
      window.location.hostname.includes('dev')
    )

  /**
   * Get browser info
   */
  export const getBrowserInfo = () =>
    pipe(
      Effect.all([
        BrowserClientLive.capabilities.getUserAgent(),
        BrowserClientLive.capabilities.getLanguage(),
        BrowserClientLive.capabilities.getTimezone(),
        BrowserClientLive.capabilities.isOnline()
      ]),
      Effect.map(([userAgent, language, timezone, isOnline]) => ({
        userAgent,
        language,
        timezone,
        isOnline,
        url: window.location.href,
        pathname: window.location.pathname
      }))
    )

  /**
   * Create session ID
   */
  export const createSessionId = () =>
    Effect.sync(() => 
      `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    )

  /**
   * Setup app lifecycle events
   */
  export const setupLifecycleEvents = (handlers: {
    onVisibilityChange?: (hidden: boolean) => void
    onPageHide?: (event: PageTransitionEvent) => void
    onBeforeUnload?: (event: BeforeUnloadEvent) => void
  }) =>
    pipe(
      Effect.all([
        handlers.onVisibilityChange 
          ? BrowserClientLive.events.onVisibilityChange(handlers.onVisibilityChange)
          : Effect.succeed(() => {}),
        handlers.onPageHide 
          ? BrowserClientLive.events.onPageHide(handlers.onPageHide)
          : Effect.succeed(() => {}),
        handlers.onBeforeUnload 
          ? BrowserClientLive.events.onBeforeUnload(handlers.onBeforeUnload)
          : Effect.succeed(() => {})
      ]),
      Effect.map((cleanups) => () => {
        cleanups.forEach(cleanup => cleanup())
      })
    )
}