/**
 * App Layout Component
 * 
 * Root layout for the entire application using SolidJS Router's root pattern.
 * This layout wraps all routes and never re-renders on route changes, making it
 * ideal for global navigation tracking and context providers.
 * 
 * Fixes: "router primitives can be only used inside a Route" error by properly
 * using useLocation() within the router context via the root layout pattern.
 */

import { onMount, onCleanup, createEffect } from 'solid-js'
import { useLocation, type RouteSectionProps } from '@solidjs/router'
import { Effect } from 'effect'
import { getNavigationCleanupService } from '../../services/navigation-cleanup.service'

export default function AppLayout(props: RouteSectionProps) {
  const location = useLocation() // ✅ Now valid within Router context via root layout
  let previousRoute = ''

  // Initialize global navigation service
  onMount(async () => {
    try {
      console.info('🌍 AppLayout: Initializing global navigation cleanup service...')
      const navigationService = getNavigationCleanupService()
      await Effect.runPromise(navigationService.startGlobalTracking())
      console.info('✅ AppLayout: Global navigation tracking started')
    } catch (error) {
      console.error('❌ AppLayout: Failed to start global navigation tracking:', error)
    }
  })

  // Track route changes using useLocation() hook
  createEffect(() => {
    const currentRoute = location.pathname
    
    if (previousRoute && previousRoute !== currentRoute) {
      console.info(`🔄 AppLayout: Route change detected: ${previousRoute} → ${currentRoute}`)
      
      // DISABLED: Route-based cleanup to preserve active listener streams
      // Cleanup now only happens on page unload (pagehide events)
      /*
      try {
        const navigationService = getNavigationCleanupService()
        Effect.runPromise(navigationService.handleRouteChange(currentRoute, previousRoute))
      } catch (error) {
        console.error('❌ AppLayout: Failed to handle route change:', error)
      }
      */
    }
    
    previousRoute = currentRoute
  })

  // Cleanup global navigation service when app unmounts
  onCleanup(async () => {
    try {
      const navigationService = getNavigationCleanupService()
      await Effect.runPromise(navigationService.stopGlobalTracking())
      console.info('🛑 AppLayout: Global navigation tracking stopped')
    } catch (error) {
      console.error('❌ AppLayout: Failed to stop global navigation tracking:', error)
    }
  })

  // This layout wraps all routes and never re-renders
  return <>{props.children}</>
}