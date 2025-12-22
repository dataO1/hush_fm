/* @refresh reload */
import { render } from 'solid-js/web'
import { Layer, ManagedRuntime } from 'effect'
import './index.css'
import App from './App'
import 'solid-devtools'

// Infrastructure Layers
import { WebSocketClientLive } from './services/infrastructure/websocket/WebSocketClient'
import { MediaSoupClientLive } from './services/infrastructure/MediaSoupClient'
import { HttpClientLive } from './services/infrastructure/HttpClient'
import { AudioClientLive } from './services/infrastructure/AudioClient'
import { BrowserClientLive } from './services/infrastructure/BrowserClient'

// Store Adapter Layers
import { ConnectionAdapterLive } from './stores/adapters/connection.adapter'
import { DJAdapterLive } from './stores/adapters/dj.adapter'
import { ListenersAdapterLive } from './stores/adapters/listeners.adapter'
import { WebRTCAdapterLive } from './stores/adapters/webrtc.adapter'
import { RoomMetadataAdapterLive } from './stores/adapters/room-metadata.adapter'

// Application Service Layers
import { DJServiceLive } from './services/application/DJService'
import { LobbyServiceLive } from './services/application/LobbyService'
import { ListenerServiceLive } from './services/application/ListenerService'

/**
 * Main Layer Composition
 * 
 * Combines all Effect-TS layers into a single source of truth.
 * Following 2025 SolidJS + Effect-TS architecture pattern.
 */
const InfrastructureLayer = Layer.mergeAll(
  WebSocketClientLive,
  MediaSoupClientLive,
  HttpClientLive,
  AudioClientLive,
  BrowserClientLive
)

const StoreAdapterLayer = Layer.mergeAll(
  ConnectionAdapterLive,
  DJAdapterLive,
  ListenersAdapterLive,
  WebRTCAdapterLive,
  RoomMetadataAdapterLive
)

const ApplicationServiceLayer = Layer.mergeAll(
  DJServiceLive,
  LobbyServiceLive,
  ListenerServiceLive
)

// Complete application layer with proper dependency flow:
// Infrastructure → Store Adapters → Application Services
export const MainLayer = ApplicationServiceLayer.pipe(
  Layer.provide(StoreAdapterLayer),
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
