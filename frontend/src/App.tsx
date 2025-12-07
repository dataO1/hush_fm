import { Router, Route } from '@solidjs/router'
import { Suspense } from 'solid-js'
import { AppProviders } from './providers/AppProviders'
import Landing from './pages/Landing'
import DJRoom from './pages/DJRoom'
import ListenerRoom from './pages/ListenerRoom'

function App() {
  return (
    <AppProviders>
      <Suspense 
        fallback={
          <div class="min-h-screen bg-base-100 flex items-center justify-center">
            <div class="loading loading-spinner loading-lg"></div>
          </div>
        }
      >
        <Router>
          <Route path="/" component={Landing} />
          <Route path="/dj/:roomId" component={DJRoom} />
          <Route path="/listen/:roomId" component={ListenerRoom} />
        </Router>
      </Suspense>
    </AppProviders>
  )
}

export default App