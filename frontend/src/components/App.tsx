import { createSignal, Show, onMount } from 'solid-js'
import { WebRTCProvider } from '../webrtc/store'
import { CreateRoomCard } from './CreateRoomCard'
import { RoomList } from './RoomList'
import { AudioControls } from './AudioControls'
import { DeviceSelector } from './DeviceSelector'
import { checkBrowserSupport } from '../webrtc/device-manager'
import { initializeWebSocketEvents } from '../ws/event-handlers'
import { Effect } from 'effect'

/**
 * Main Application Component
 * Implements the landing page with room creation and listing together
 */
export function App() {
  const [browserSupported, setBrowserSupported] = createSignal<boolean | null>(null)
  const [currentView, setCurrentView] = createSignal<'lobby' | 'dj' | 'listener'>('lobby')

  // Check browser compatibility and initialize WebSocket events on mount
  onMount(async () => {
    const isSupported = await Effect.runPromise(checkBrowserSupport())
    setBrowserSupported(isSupported)
    
    if (isSupported) {
      // Initialize WebSocket event handling system
      await Effect.runPromise(initializeWebSocketEvents())
    }
  })

  // Show browser compatibility error
  const BrowserCompatibilityError = () => (
    <div class="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div class="bg-white rounded-lg shadow-xl p-8 max-w-md text-center">
        <div class="text-6xl mb-4">🚫</div>
        <h1 class="text-2xl font-bold text-gray-800 mb-4">
          Browser Not Supported
        </h1>
        <p class="text-gray-600 mb-6">
          Your browser doesn't support WebRTC, which is required for HushFM. 
          Please use a modern browser like Chrome, Firefox, Safari, or Edge.
        </p>
        <div class="text-sm text-gray-500">
          <p class="mb-2">Supported browsers:</p>
          <div class="flex justify-center space-x-4">
            <span>🌐 Chrome</span>
            <span>🦊 Firefox</span>
            <span>🧭 Safari</span>
            <span>🌍 Edge</span>
          </div>
        </div>
      </div>
    </div>
  )

  // Main application layout
  const MainApp = () => (
    <div class="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100">
      {/* Header */}
      <header class="bg-white shadow-sm border-b">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="flex items-center justify-between h-16">
            <div class="flex items-center">
              <h1 class="text-2xl font-bold text-gray-900">
                🎵 HushFM
              </h1>
              <span class="ml-2 text-sm text-gray-500">
                Local Network Audio Streaming
              </span>
            </div>
            
            {/* View Toggle */}
            <div class="flex items-center space-x-2">
              <button
                onClick={() => setCurrentView('lobby')}
                class={`px-3 py-1 rounded text-sm transition-colors ${
                  currentView() === 'lobby'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                🏠 Lobby
              </button>
              <button
                onClick={() => setCurrentView('dj')}
                class={`px-3 py-1 rounded text-sm transition-colors ${
                  currentView() === 'dj'
                    ? 'bg-purple-500 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                🎤 DJ Mode
              </button>
              <button
                onClick={() => setCurrentView('listener')}
                class={`px-3 py-1 rounded text-sm transition-colors ${
                  currentView() === 'listener'
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                🎧 Listen
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Show
          when={currentView() === 'lobby'}
          fallback={
            <Show
              when={currentView() === 'dj'}
              fallback={
                // Listener View
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div class="space-y-6">
                    <RoomList />
                  </div>
                  <div class="space-y-6">
                    <AudioControls />
                  </div>
                </div>
              }
            >
              {/* DJ View */}
              <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div class="space-y-6">
                  <DeviceSelector />
                </div>
                <div class="space-y-6">
                  <CreateRoomCard />
                </div>
                <div class="space-y-6">
                  <AudioControls />
                </div>
              </div>
            </Show>
          }
        >
          {/* Lobby View - Combined Interface */}
          <div class="space-y-8">
            {/* Welcome Section */}
            <div class="text-center">
              <h2 class="text-3xl font-bold text-gray-800 mb-4">
                Welcome to HushFM
              </h2>
              <p class="text-lg text-gray-600 max-w-2xl mx-auto">
                Stream and listen to live audio on your local network. 
                Create a room to start broadcasting, or join an existing room to listen.
              </p>
            </div>

            {/* Main Interface Grid */}
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Left Column - Room Management */}
              <div class="space-y-6">
                <div class="text-center lg:text-left">
                  <h3 class="text-xl font-semibold text-gray-800 mb-2">
                    🎤 Start Broadcasting
                  </h3>
                  <p class="text-gray-600 mb-4">
                    Create a new room and start streaming audio to listeners on your network.
                  </p>
                </div>
                <CreateRoomCard />
                
                <div class="lg:hidden">
                  <DeviceSelector />
                </div>
              </div>

              {/* Right Column - Room Discovery */}
              <div class="space-y-6">
                <div class="text-center lg:text-left">
                  <h3 class="text-xl font-semibold text-gray-800 mb-2">
                    🎧 Join a Room
                  </h3>
                  <p class="text-gray-600 mb-4">
                    Listen to live audio streams from DJs on your network.
                  </p>
                </div>
                <RoomList />
              </div>
            </div>

            {/* Bottom Section - Controls and Device Settings */}
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div class="hidden lg:block">
                <DeviceSelector />
              </div>
              <div>
                <AudioControls />
              </div>
            </div>

            {/* Footer Info */}
            <div class="border-t pt-8 text-center text-gray-500 text-sm">
              <p class="mb-2">
                HushFM operates on your local WiFi network only. No internet connection required.
              </p>
              <div class="flex justify-center space-x-6">
                <span>🔒 Private Network</span>
                <span>⚡ Low Latency</span>
                <span>🎵 High Quality Audio</span>
              </div>
            </div>
          </div>
        </Show>
      </main>
    </div>
  )

  return (
    <WebRTCProvider>
      <Show
        when={browserSupported() !== false}
        fallback={<BrowserCompatibilityError />}
      >
        <Show
          when={browserSupported() === true}
          fallback={
            <div class="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
              <div class="bg-white rounded-lg shadow-xl p-8 text-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4"></div>
                <p class="text-gray-600">Checking browser compatibility...</p>
              </div>
            </div>
          }
        >
          <MainApp />
        </Show>
      </Show>
    </WebRTCProvider>
  )
}