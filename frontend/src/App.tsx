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

// Import all services
import { UserService, UserServiceLive } from './services/application/UserService'
import { LobbyService, LobbyServiceLive } from './services/application/LobbyService'
import { WebSocketClientService, WebSocketClientServiceLive } from './services/infrastructure/WebSocketClient'
import { MediaSoupClient, MediaSoupClientLive } from './services/infrastructure/MediaSoupClient'
import { AudioClient, AudioClientLive } from './services/infrastructure/AudioClient'
import { HttpClient, HttpClientLive } from './services/infrastructure/HttpClient'

// Create the complete application layer with all services and adapters
const AppLayer = Layer.mergeAll(
  // Store Adapters
  ConnectionAdapterLive,
  LobbyAdapterLive,
  UserAdapterLive,
  AudioAdapterLive,
  // Application Services
  UserServiceLive,
  LobbyServiceLive,
  // Infrastructure Services
  WebSocketClientServiceLive,
  MediaSoupClientLive,
  AudioClientLive,
  HttpClientLive
)

// Create managed runtime with all dependencies
const runtime = ManagedRuntime.make(AppLayer)

// Get service types from Context.Tag
type ConnectionAdapterService = Context.Tag.Service<ConnectionAdapter>
type LobbyAdapterService = Context.Tag.Service<LobbyAdapter>
type UserAdapterService = Context.Tag.Service<UserAdapter>
type AudioAdapterService = Context.Tag.Service<AudioAdapter>
type UserServiceType = Context.Tag.Service<UserService>
type LobbyServiceType = Context.Tag.Service<LobbyService>
type WebSocketClientServiceType = Context.Tag.Service<WebSocketClientService>
type MediaSoupClientType = Context.Tag.Service<MediaSoupClient>
type AudioClientType = Context.Tag.Service<AudioClient>
type HttpClientType = Context.Tag.Service<HttpClient>

// Service context types
interface ServiceContextValue {
  // Adapters
  connectionAdapter: ConnectionAdapterService
  lobbyAdapter: LobbyAdapterService
  userAdapter: UserAdapterService
  audioAdapter: AudioAdapterService
  // Application Services
  userService: UserServiceType
  lobbyService: LobbyServiceType
  // Infrastructure Services
  webSocketClient: WebSocketClientServiceType
  mediaSoupClient: MediaSoupClientType
  audioClient: AudioClientType
  httpClient: HttpClientType
  // Runtime for Effect execution
  runtime: typeof runtime
}

// Create context
const ServiceContext = createContext<ServiceContextValue>()

// Provider component
const ServiceProvider: ParentComponent = (props) => {
  // Get all services and adapters from runtime
  const services: ServiceContextValue = {
    // Adapters
    connectionAdapter: runtime.runSync(ConnectionAdapter),
    lobbyAdapter: runtime.runSync(LobbyAdapter),
    userAdapter: runtime.runSync(UserAdapter),
    audioAdapter: runtime.runSync(AudioAdapter),
    // Application Services
    userService: runtime.runSync(UserService),
    lobbyService: runtime.runSync(LobbyService),
    // Infrastructure Services
    webSocketClient: runtime.runSync(WebSocketClientService),
    mediaSoupClient: runtime.runSync(MediaSoupClient),
    audioClient: runtime.runSync(AudioClient),
    httpClient: runtime.runSync(HttpClient),
    // Runtime
    runtime
  }

  return (
    <ServiceContext.Provider value={services}>
      {props.children}
    </ServiceContext.Provider>
  )
}

// Hook to use services
export const useServices = () => {
  const context = useContext(ServiceContext)
  if (!context) {
    throw new Error('useServices must be used within ServiceProvider')
  }
  return context
}

// Individual hooks for convenience
export const useConnectionAdapter = () => useServices().connectionAdapter
export const useLobbyAdapter = () => useServices().lobbyAdapter
export const useUserAdapter = () => useServices().userAdapter
export const useAudioAdapter = () => useServices().audioAdapter
export const useUserService = () => useServices().userService
export const useLobbyService = () => useServices().lobbyService
export const useRuntime = () => useServices().runtime

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
    <ServiceProvider>
      <AppContent />
    </ServiceProvider>
  )
}

export default App