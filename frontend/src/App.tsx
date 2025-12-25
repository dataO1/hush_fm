import { Router, Route } from '@solidjs/router'
import { Suspense, onMount, createContext, useContext, ParentComponent } from 'solid-js'
import { Layer, ManagedRuntime, Context } from 'effect'
import Landing from './ui/pages/Landing'
import DJRoom from './ui/pages/DJRoom'
import ListenerRoom from './ui/pages/ListenerRoom'
import AppLayout from './ui/layouts/AppLayout'

// Import all adapters
import { ConnectionAdapter, ConnectionAdapterLive } from './stores/connection'
import { LobbyAdapter, LobbyAdapterLive } from './stores/lobby'
import { UserAdapter, UserAdapterLive } from './stores/user'
import { AudioAdapter, AudioAdapterLive } from './stores/audio'

// Export service layers for scoped use in components
export { UserServiceLive } from './services/application/UserService'
export { LobbyServiceLive } from './services/application/LobbyService'
export { MediaSoupClientLive } from './services/infrastructure/MediaSoupClient'
export { AudioClientLive } from './services/infrastructure/AudioClient'
import { User } from './services/domain/User'

// Global Application Layer - Only true singletons (store adapters)
const GlobalAppLayer = Layer.mergeAll(
  // Store Adapters (global singletons - shared state)
  ConnectionAdapterLive,
  LobbyAdapterLive,
  UserAdapterLive,
  AudioAdapterLive
)

// Create managed runtime with global dependencies only
const globalRuntime = ManagedRuntime.make(GlobalAppLayer)

// Feature-specific layers are now exported from individual service files

// Get adapter types from Context.Tag (only global adapters)
type ConnectionAdapterService = Context.Tag.Service<ConnectionAdapter>
type LobbyAdapterService = Context.Tag.Service<LobbyAdapter>
type UserAdapterService = Context.Tag.Service<UserAdapter>
type AudioAdapterService = Context.Tag.Service<AudioAdapter>

// Global service context types (only adapters)
interface GlobalServiceContextValue {
  // Adapters (globally available)
  connectionAdapter: ConnectionAdapterService
  lobbyAdapter: LobbyAdapterService
  userAdapter: UserAdapterService
  audioAdapter: AudioAdapterService
  // Global Runtime for Effect execution
  globalRuntime: typeof globalRuntime
}

// Create context
const GlobalServiceContext = createContext<GlobalServiceContextValue>()

// Global Provider component (for shared services only)
const GlobalServiceProvider: ParentComponent = (props) => {
  // Get global services and adapters from runtime
  const services: GlobalServiceContextValue = {
    // Adapters (globally available)
    connectionAdapter: globalRuntime.runSync(ConnectionAdapter),
    lobbyAdapter: globalRuntime.runSync(LobbyAdapter),
    userAdapter: globalRuntime.runSync(UserAdapter),
    audioAdapter: globalRuntime.runSync(AudioAdapter),
    // Global Runtime
    globalRuntime
  }

  return (
    <GlobalServiceContext.Provider value={services}>
      {props.children}
    </GlobalServiceContext.Provider>
  )
}

// Hook to use global services
export const useGlobalServices = () => {
  const context = useContext(GlobalServiceContext)
  if (!context) {
    throw new Error('useGlobalServices must be used within GlobalServiceProvider')
  }
  return context
}

// Individual hooks for global adapters only
export const useConnectionAdapter = () => useGlobalServices().connectionAdapter
export const useLobbyAdapter = () => useGlobalServices().lobbyAdapter
export const useUserAdapter = () => useGlobalServices().userAdapter
export const useAudioAdapter = () => useGlobalServices().audioAdapter
export const useGlobalRuntime = () => useGlobalServices().globalRuntime

// Legacy hook for backward compatibility
export const useRuntime = () => useGlobalServices().globalRuntime

function AppContent() {
  // Get services for initialization
  const runtime = useGlobalRuntime()
  const userAdapter = useUserAdapter()

  // Initialize session ID on app mount
  onMount(async () => {
    try {
      console.info('🚀 Initializing HushFM app with SolidJS 2025 + Effect-TS architecture...')
      
      // Check if session already exists
      if (userAdapter.hasSession()) {
        console.info('ℹ️ Session already exists, skipping initialization')
      } else {
        // Initialize user session with browser fingerprint
        console.info('🔐 Initializing user session...')
        const sessionComputation = await runtime.runPromise(User.computeSessionId())
        
        // Set session ID via adapter
        userAdapter.setSessionId(sessionComputation.sessionId)
        console.info('✅ User session initialized:', sessionComputation.sessionId)
      }
      
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
    <GlobalServiceProvider>
      <AppContent />
    </GlobalServiceProvider>
  )
}

export default App