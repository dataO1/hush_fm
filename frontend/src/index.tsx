/* @refresh reload */
import { render } from 'solid-js/web'
import { Layer, ManagedRuntime } from 'effect'
import './index.css'
import App from './App'
import 'solid-devtools'

// Infrastructure Layers
// WebSocketClient is now provided directly to services, not globally
import { MediaSoupClientLive } from './services/infrastructure/MediaSoupClient'
import { AudioClientLive } from './services/infrastructure/AudioClient'

// On-device debug console (eruda, self-hosted for offline use): append
// ?debug=1 to the URL. Needed because Brave/Ecosia can't be remote-inspected
// via chrome://inspect — this gives console/elements/network on any phone.
if (new URLSearchParams(window.location.search).has('debug')) {
  const s = document.createElement('script')
  s.src = '/eruda.js'
  s.onload = () => { (window as any).eruda?.init() }
  document.head.appendChild(s)
}

// Store Adapter Layers
import { 
  AudioAdapterLive,
  ConnectionAdapterLive,
  LobbyAdapterLive,
  UserAdapterLive 
} from './stores'

// Note: UserService and LobbyService are now scoped to specific components
// They are not provided globally to avoid multiple WebSocket connections

/**
 * Main Layer Composition
 * 
 * Combines all Effect-TS layers into a single source of truth.
 * Following 2025 SolidJS + Effect-TS architecture pattern.
 */
const InfrastructureLayer = Layer.mergeAll(
  MediaSoupClientLive.pipe(Layer.provide(ConnectionAdapterLive)),
  AudioClientLive
)

const StoreAdapterLayer = Layer.mergeAll(
  AudioAdapterLive,
  ConnectionAdapterLive,
  LobbyAdapterLive,
  UserAdapterLive
)

// No global application services - they are scoped to components

// Complete application layer with proper dependency flow:
// Infrastructure → Store Adapters (Application Services are component-scoped)
export const MainLayer = StoreAdapterLayer.pipe(
  Layer.provide(InfrastructureLayer)
)

// Create the runtime that components will use
export const runtime = ManagedRuntime.make(MainLayer)

// Enable MediaSoup client debug logging in all builds
try {
  // Import debug module from mediasoup-client for comprehensive logging
  import('mediasoup-client').then(({ debug }) => {
    if (debug && debug.enable) {
      // Enable all MediaSoup client debug categories
      debug.enable('mediasoup-client:*')
      console.info('🔧 MediaSoup client debug logging enabled')
    }
  }).catch((error) => {
    console.warn('⚠️ Failed to enable MediaSoup debug logging:', error)
  })
} catch (error) {
  console.warn('⚠️ MediaSoup debug module not available:', error)
}

const root = document.getElementById('root')

if ((import.meta as any).env?.DEV && !(root instanceof HTMLElement)) {
  throw new Error(
    'Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got mispelled?',
  )
}

// Render the application
render(() => <App />, root!)

// Enhanced error handling for development
if ((import.meta as any).env?.DEV) {
  // Log unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason)
  })

  // Log unhandled errors
  window.addEventListener('error', (event) => {
    console.error('Unhandled error:', event.error)
  })

  // Log Effect-TS errors in development
  ;(window as any).__EFFECT_DEBUG__ = true
}
