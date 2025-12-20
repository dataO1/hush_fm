import { Router, Route } from '@solidjs/router'
import { Suspense, onMount } from 'solid-js'
import { Effect } from 'effect'
import Landing from './ui/pages/Landing'
import DJRoom from './ui/pages/DJRoom'
import ListenerRoom from './ui/pages/ListenerRoom'
import AppLayout from './ui/layouts/AppLayout'
import { getUserStore } from './stores/user.store'
import { initializeUserSession } from './services/user.service'

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
      <Router root={AppLayout}>
        <Route path="/" component={Landing} />
        <Route path="/dj/:roomId" component={DJRoom} />
        <Route path="/listen/:roomId" component={ListenerRoom} />
      </Router>
    </Suspense>
  )
}

export default App