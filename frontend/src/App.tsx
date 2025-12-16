import { Router, Route } from '@solidjs/router'
import { Suspense } from 'solid-js'
import Landing from './ui/pages/Landing'
import DJRoom from './ui/pages/DJRoom'
import ListenerRoom from './ui/pages/ListenerRoom'

function App() {
  return (
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
  )
}

export default App