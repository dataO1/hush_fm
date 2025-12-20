import { Router, Route, useLocation } from '@solidjs/router'
import { Suspense, onMount, onCleanup, createEffect } from 'solid-js'
import { Effect } from 'effect'
import Landing from './ui/pages/Landing'
import DJRoom from './ui/pages/DJRoom'
import ListenerRoom from './ui/pages/ListenerRoom'
import { getUserStore } from './stores/user.store'
import { initializeUserSession } from './services/user.service'
import { getNavigationCleanupService } from './services/navigation-cleanup.service'

// Navigation tracker component that runs inside Router
function NavigationTracker() {
  const location = useLocation()
  let previousRoute = ''

  // Initialize global navigation service
  onMount(async () => {
    try {
      console.info('🌍 Initializing global navigation cleanup service...')
      const navigationService = getNavigationCleanupService()
      await Effect.runPromise(navigationService.startGlobalTracking())
      console.info('✅ Global navigation tracking started')
    } catch (error) {
      console.error('❌ Failed to start global navigation tracking:', error)
    }
  })

  // Track route changes
  createEffect(() => {
    const currentRoute = location.pathname
    
    if (previousRoute && previousRoute !== currentRoute) {
      try {
        console.info(`🔄 App: Route change detected: ${previousRoute} → ${currentRoute}`)
        const navigationService = getNavigationCleanupService()
        Effect.runPromise(navigationService.handleRouteChange(currentRoute, previousRoute))
      } catch (error) {
        console.error('❌ Failed to handle route change:', error)
      }
    }
    
    previousRoute = currentRoute
  })

  // Cleanup global navigation service
  onCleanup(async () => {
    try {
      const navigationService = getNavigationCleanupService()
      await Effect.runPromise(navigationService.stopGlobalTracking())
      console.info('🛑 Global navigation tracking stopped')
    } catch (error) {
      console.error('❌ Failed to stop global navigation tracking:', error)
    }
  })

  return null // This component doesn't render anything
}

function App() {
  // Initialize user session on app startup
  onMount(async () => {
    const userStore = getUserStore()
    
    try {
      console.info('🚀 Initializing HushFM app with user session...')
      
      // Compute session ID from browser fingerprint
      await Effect.runPromise(initializeUserSession(userStore))
      
      console.info('✅ App initialization complete')
    } catch (error) {
      console.error('❌ Failed to initialize user session:', error)
      // App can still function without session ID, it will be computed when needed
    }
  })

  return (
    <Suspense 
      fallback={
        <div class="min-h-screen bg-base-100 flex items-center justify-center">
          <div class="loading loading-spinner loading-lg"></div>
        </div>
      }
    >
      <Router>
        <NavigationTracker />
        <Route path="/" component={Landing} />
        <Route path="/dj/:roomId" component={DJRoom} />
        <Route path="/listen/:roomId" component={ListenerRoom} />
      </Router>
    </Suspense>
  )
}

export default App