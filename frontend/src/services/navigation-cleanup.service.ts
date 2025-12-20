/**
 * Navigation Cleanup Service
 * 
 * Global singleton service for managing navigation lifecycle and store resets.
 * Handles both route navigation (browser back button) and page unload events 
 * for reliable WebRTC connection cleanup across all browsers.
 * 
 * Architecture:
 * - Global singleton initialized once in App.tsx
 * - Component registry for tracking active cleanup callbacks
 * - Route change detection using useLocation() reactive updates
 * - Cross-browser page unload events (visibilitychange, pagehide)
 * - Automatic cleanup on navigation and page unload
 */

import { Effect, pipe, Option } from 'effect'
import { getRoomStore } from '../stores/room.store'
import { createLobbyStore } from '../stores/lobby.store'
import { connectToLobbyWebSocket, discoverRooms } from './flows/lobby-flows.service'
import { leaveRoomAsListener } from './flows/listener-flows.service'
import { 
  cleanupConsumerWithStore,
  cleanupTransportWithStore,
  cleanupWebSocketWithStore 
} from './flows/cleanup-flows.service'

/**
 * Navigation cleanup error types
 */
export class NavigationCleanupError extends Error {
  constructor(
    message: string,
    public operation: string,
    public cause?: unknown
  ) {
    super(message)
    this.name = 'NavigationCleanupError'
  }
}

/**
 * Component cleanup callback registry entry
 */
interface ComponentCleanupEntry {
  componentId: string
  cleanupEffect: Effect.Effect<void, any>
  routePath?: string  // Track which route this component belongs to
}

/**
 * Navigation Cleanup Service interface
 */
export interface NavigationCleanupService {
  /**
   * Start global tracking - called once in App.tsx
   * Sets up browser events and route change detection
   */
  startGlobalTracking: () => Effect.Effect<void, never>
  
  /**
   * Stop global tracking - cleanup all handlers
   */
  stopGlobalTracking: () => Effect.Effect<void, never>
  
  /**
   * Register component cleanup callback
   */
  registerComponent: (componentId: string, cleanupEffect: Effect.Effect<void, any>, routePath?: string) => Effect.Effect<void, never>
  
  /**
   * Unregister component cleanup callback
   */
  unregisterComponent: (componentId: string) => Effect.Effect<void, never>
  
  /**
   * Handle route change - cleanup components from previous route
   */
  handleRouteChange: (newRoute: string, previousRoute?: string) => Effect.Effect<void, never>
  
  /**
   * Cleanup all registered components (for page unload events)
   */
  cleanupAllComponents: () => Effect.Effect<void, never>
  
  /**
   * Local-only MediaSoup cleanup - no backend commands
   * Cleans up any existing MediaSoup transport/consumer/websocket locally
   */
  cleanupLocalMediaSoupResources: () => Effect.Effect<void, never>
  
  /**
   * Universal store reset - used by ALL pages on navigation
   * Resets room store to empty state and reconnects lobby with fresh room list
   */
  initLocalStore: () => Effect.Effect<void, NavigationCleanupError>
  
  /**
   * Listener-specific cleanup with backend call + store reset
   * Calls existing leaveRoomAsListener flow + initLocalStore
   */
  cleanupListenerAndInitStore: (listenerId: string) => Effect.Effect<void, NavigationCleanupError>
}

/**
 * Global singleton instance
 */
let globalNavigationService: NavigationCleanupService | null = null

/**
 * Implementation of Navigation Cleanup Service
 */
export const createNavigationCleanupService = (): NavigationCleanupService => {
  // Component registry
  const componentRegistry = new Map<string, ComponentCleanupEntry>()
  
  // Global state
  let globalTrackingActive = false
  let currentRoute = ''
  
  // Global browser event handlers
  const handlePageUnload = async () => {
    console.info('🌍 Page unload detected - cleaning up all components')
    try {
      // Execute cleanup for all registered components
      const cleanupPromises = Array.from(componentRegistry.values()).map(entry =>
        Effect.runPromise(entry.cleanupEffect).catch(error => {
          console.error(`❌ Failed to cleanup component ${entry.componentId}:`, error)
        })
      )
      
      await Promise.all(cleanupPromises)
      console.info('✅ Page unload cleanup completed')
    } catch (error) {
      console.error('❌ Page unload cleanup failed:', error)
    }
  }
  
  // Setup global browser events
  const setupGlobalEvents = () => {
    if (globalTrackingActive) return
    
    // Only use pagehide for actual navigation/unload events
    // Removed visibilitychange to keep audio streaming when tab is hidden
    window.addEventListener('pagehide', handlePageUnload)
    
    globalTrackingActive = true
    console.info('🌍 Global navigation tracking started')
  }
  
  // Remove global browser events
  const removeGlobalEvents = () => {
    window.removeEventListener('pagehide', handlePageUnload)
    globalTrackingActive = false
    console.info('🧹 Global navigation tracking stopped')
  }
  
  const service: NavigationCleanupService = {
    /**
     * Start global tracking
     */
    startGlobalTracking: (): Effect.Effect<void, never> =>
      pipe(
        Effect.sync(() => {
          setupGlobalEvents()
          console.info('🚀 Navigation cleanup service: Global tracking started')
        })
      ),

    /**
     * Stop global tracking
     */
    stopGlobalTracking: (): Effect.Effect<void, never> =>
      pipe(
        Effect.sync(() => {
          removeGlobalEvents()
          componentRegistry.clear()
          console.info('🛑 Navigation cleanup service: Global tracking stopped')
        })
      ),

    /**
     * Register component cleanup callback
     */
    registerComponent: (componentId: string, cleanupEffect: Effect.Effect<void, any>, routePath?: string): Effect.Effect<void, never> =>
      pipe(
        Effect.sync(() => {
          componentRegistry.set(componentId, {
            componentId,
            cleanupEffect,
            routePath
          })
          console.info(`🔧 Registered cleanup for component: ${componentId} (route: ${routePath || 'unknown'})`)
        })
      ),

    /**
     * Unregister component cleanup callback
     */
    unregisterComponent: (componentId: string): Effect.Effect<void, never> =>
      pipe(
        Effect.sync(() => {
          if (componentRegistry.has(componentId)) {
            componentRegistry.delete(componentId)
            console.info(`🧹 Unregistered cleanup for component: ${componentId}`)
          }
        })
      ),

    /**
     * Handle route change
     */
    handleRouteChange: (newRoute: string, previousRoute?: string): Effect.Effect<void, never> =>
      pipe(
        Effect.gen(function* (_) {
          console.info(`🔄 Route change detected: ${previousRoute || 'unknown'} → ${newRoute}`)
          
          // If this is the same route, no cleanup needed
          if (newRoute === currentRoute) {
            return
          }
          
          const previousRouteActual = currentRoute || previousRoute
          
          // Find components from the previous route and clean them up
          const componentsToCleanup = Array.from(componentRegistry.values())
            .filter(entry => entry.routePath === previousRouteActual || (!entry.routePath && previousRouteActual))
          
          if (componentsToCleanup.length > 0) {
            console.info(`🧹 Cleaning up ${componentsToCleanup.length} components from route: ${previousRouteActual}`)
            
            // Execute cleanup for route-specific components
            for (const entry of componentsToCleanup) {
              try {
                yield* _(pipe(
                  entry.cleanupEffect,
                  Effect.catchAll(error => {
                    console.error(`❌ Failed to cleanup component ${entry.componentId}:`, error)
                    return Effect.void
                  })
                ))
                console.info(`✅ Cleaned up component: ${entry.componentId}`)
                
                // Remove from registry after cleanup attempt
                componentRegistry.delete(entry.componentId)
              } catch (error) {
                console.error(`❌ Unexpected error during component cleanup ${entry.componentId}:`, error)
                // Remove from registry even if cleanup failed
                componentRegistry.delete(entry.componentId)
              }
            }
          }
          
          // Update current route
          currentRoute = newRoute
        }),
        Effect.catchAll(error => {
          console.error('❌ Failed to handle route change:', error)
          return Effect.void
        })
      ),

    /**
     * Cleanup all registered components
     */
    cleanupAllComponents: (): Effect.Effect<void, never> =>
      pipe(
        Effect.gen(function* (_) {
          const allComponents = Array.from(componentRegistry.values())
          
          if (allComponents.length > 0) {
            console.info(`🧹 Cleaning up all ${allComponents.length} registered components`)
            
            for (const entry of allComponents) {
              try {
                yield* _(pipe(
                  entry.cleanupEffect,
                  Effect.catchAll(error => {
                    console.error(`❌ Failed to cleanup component ${entry.componentId}:`, error)
                    return Effect.void
                  })
                ))
                console.info(`✅ Cleaned up component: ${entry.componentId}`)
              } catch (error) {
                console.error(`❌ Unexpected error during component cleanup ${entry.componentId}:`, error)
              }
            }
            
            // Clear registry after cleanup
            componentRegistry.clear()
            console.info('✅ All component cleanup completed')
          }
        }),
        Effect.catchAll(error => {
          console.error('❌ Failed to cleanup all components:', error)
          return Effect.void
        })
      ),

    /**
     * Local-only MediaSoup cleanup - no backend commands
     * Cleans up any existing MediaSoup transport/consumer/websocket locally
     */
    cleanupLocalMediaSoupResources: (): Effect.Effect<void, never> =>
      pipe(
        Effect.gen(function* (_) {
          const roomStore = getRoomStore()
          
          // Find any active listeners that need cleanup
          const allListeners = Object.keys(roomStore.state.participants.listeners as Record<string, any>)
          
          if (allListeners.length > 0) {
            console.info(`🧹 Local MediaSoup cleanup for ${allListeners.length} active listeners`)
            
            for (const listenerId of allListeners) {
              try {
                // Get listener for audio stream cleanup
                const listener = roomStore.getListener(listenerId)
                
                // 0. Stop MediaStream tracks FIRST (before MediaSoup cleanup)
                if (listener) {
                  const mediaStreamOption = listener.audioPlayback.mediaStream
                  if (Option.isSome(mediaStreamOption)) {
                    const mediaStream = Option.getOrNull(mediaStreamOption) as MediaStream | null
                    if (mediaStream) {
                      console.info(`🔊 Stopping audio stream tracks for ${listenerId}`)
                      mediaStream.getTracks().forEach(track => {
                        try {
                          track.stop()
                          console.info(`🔊 Stopped ${track.kind} track: ${track.id}`)
                        } catch (error) {
                          console.warn(`⚠️ Failed to stop track ${track.id}:`, error)
                        }
                      })
                    }
                  }
                }
                
                // Use leaving mode (true) to skip backend events and force immediate cleanup
                
                // 1. Consumer cleanup (local only)
                yield* _(cleanupConsumerWithStore(roomStore, listenerId, 2000, true).pipe(
                  Effect.catchAll(error => {
                    console.warn(`⚠️ Local consumer cleanup failed for ${listenerId}:`, error.message)
                    return Effect.void
                  })
                ))
                
                // 2. Transport cleanup (local only) 
                yield* _(cleanupTransportWithStore(roomStore, listenerId, 2000, true).pipe(
                  Effect.catchAll(error => {
                    console.warn(`⚠️ Local transport cleanup failed for ${listenerId}:`, error.message)
                    return Effect.void
                  })
                ))
                
                // 3. WebSocket cleanup (local only)
                yield* _(cleanupWebSocketWithStore(roomStore, listenerId, 1000).pipe(
                  Effect.catchAll(error => {
                    console.warn(`⚠️ Local WebSocket cleanup failed for ${listenerId}:`, error.message)
                    return Effect.void
                  })
                ))
                
                console.info(`✅ Local MediaSoup cleanup completed for ${listenerId}`)
              } catch (error) {
                console.error(`❌ Unexpected error during local cleanup for ${listenerId}:`, error)
              }
            }
          } else {
            console.info('ℹ️ No active listeners found - skipping MediaSoup cleanup')
          }
        }),
        Effect.catchAll(error => {
          console.error('❌ Local MediaSoup cleanup failed:', error)
          return Effect.void
        })
      ),

    /**
     * Universal store reset - used by ALL pages
     */
    initLocalStore: (): Effect.Effect<void, NavigationCleanupError> =>
      pipe(
        Effect.gen(function* (_) {
          console.info('🔄 Initializing local store state...')
          
          const roomStore = getRoomStore()
          const lobbyStore = createLobbyStore()
          
          // 1. MediaSoup local cleanup FIRST (before state reset)
          console.info('🧹 Performing local MediaSoup cleanup...')
          yield* _(service.cleanupLocalMediaSoupResources().pipe(
            Effect.catchAll(error => {
              console.error('❌ Local MediaSoup cleanup failed during init:', error)
              return Effect.void
            })
          ))
          
          // 2. Pure state resets (no side effects)
          yield* _(Effect.sync(() => {
            console.info('📦 Resetting room store to initial state')
            roomStore.actions.resetToInitialState() // Use our new pure reset action
            roomStore.actions.clearAllConnections()  // Clear WebSocket/WebRTC
            roomStore.actions.clearAudioResources()  // Clear audio streams
            
            console.info('🏢 Resetting lobby store state') 
            lobbyStore.actions.setDisconnected() // Pure state reset
            lobbyStore.actions.clearRooms() // Clear room list
          }))
          
          // 3. Effects: reconnect lobby and reload rooms
          console.info('🔌 Reconnecting to lobby WebSocket...')
          const ws = yield* _(connectToLobbyWebSocket())
          lobbyStore.actions.setConnected(ws)
          
          console.info('📡 Loading fresh room list...')
          const rooms = yield* _(discoverRooms())
          lobbyStore.actions.setRooms(rooms)
          
          console.info('✅ Local store initialization complete')
        }),
        Effect.mapError(error => new NavigationCleanupError(
          'Failed to initialize local store',
          'initLocalStore',
          error
        ))
      ),

    /**
     * Listener cleanup with backend call + store reset
     */
    cleanupListenerAndInitStore: (listenerId: string): Effect.Effect<void, NavigationCleanupError> =>
      pipe(
        Effect.gen(function* (_) {
          console.info(`🎧 Starting listener cleanup and store reset for: ${listenerId}`)
          
          const roomStore = getRoomStore()
          
          try {
            // 1. Backend cleanup via existing listener flow
            console.info('📡 Executing backend listener cleanup...')
            yield* _(leaveRoomAsListener(roomStore, listenerId))
            console.info('✅ Backend listener cleanup completed')
          } catch (error) {
            console.warn('⚠️ Backend cleanup failed, proceeding with local reset:', error)
            // Continue with local reset even if backend cleanup fails
          }
          
          // 2. Universal store reset
          console.info('🔄 Performing universal store reset...')
          yield* _(service.initLocalStore())
          
          console.info('✅ Listener cleanup and store reset complete')
        }),
        Effect.mapError(error => new NavigationCleanupError(
          `Failed to cleanup listener and reset store: ${listenerId}`,
          'cleanupListenerAndInitStore',
          error
        ))
      )
  }

  return service
}

/**
 * Get or create global singleton instance
 */
export const getNavigationCleanupService = (): NavigationCleanupService => {
  if (!globalNavigationService) {
    globalNavigationService = createNavigationCleanupService()
  }
  return globalNavigationService
}

/**
 * Service layer implementation using Effect.Service
 */
export const NavigationCleanupServiceLive = Effect.sync(() => getNavigationCleanupService())

/**
 * Service interface for dependency injection
 */
export class NavigationCleanupServiceTag extends Effect.Tag('NavigationCleanupService')<
  NavigationCleanupServiceTag,
  NavigationCleanupService
>() {}