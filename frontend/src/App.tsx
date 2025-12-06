import { Router, Route } from '@solidjs/router'
import Landing from './pages/Landing'
import DJRoom from './pages/DJRoom'
import ListenerRoom from './pages/ListenerRoom'

function App() {
  return (
    <Router>
      <Route path="/" component={Landing} />
      <Route path="/dj/:roomId" component={DJRoom} />
      <Route path="/listen/:roomId" component={ListenerRoom} />
    </Router>
  )
}

export default App