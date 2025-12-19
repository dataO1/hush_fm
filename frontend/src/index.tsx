/* @refresh reload */
import { render } from 'solid-js/web'
import './index.css'
import App from './App'
import 'solid-devtools'

// Enable MediaSoup client debug logging in development
if ((import.meta as any).env?.DEV) {
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
