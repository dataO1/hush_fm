import { Router, Route } from '@solidjs/router'
import { Suspense, onMount } from 'solid-js'
import Landing from './ui/pages/Landing'
import DJRoom from './ui/pages/DJRoom'
import ListenerRoom from './ui/pages/ListenerRoom'
import AppLayout from './ui/layouts/AppLayout'
import { StoreProvider } from './stores/store-contexts'

function AppContent() {
  // SolidJS 2025: No lifecycle service needed anymore
  onMount(async () => {
    try {
      console.info('🚀 Initializing HushFM app with SolidJS 2025 + Effect-TS architecture...')
      console.info('📱 User session will be initialized on demand')
      console.info('✅ App initialization complete')
    } catch (error) {
      console.error('❌ Failed to initialize app:', error)
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

function App() {
  return (
    <StoreProvider>
      <AppContent />
    </StoreProvider>
  )
}

export default App