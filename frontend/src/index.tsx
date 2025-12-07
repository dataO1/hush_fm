/* @refresh reload */
import { render } from 'solid-js/web'
import './index.css'
import App from './App'
import { initTelemetry } from './telemetry'

// Initialize OpenTelemetry as early as possible
const jaegerEndpoint = (import.meta as any).env?.VITE_JAEGER_ENDPOINT || 'http://localhost:14268/api/traces'
initTelemetry('hushfm-frontend', jaegerEndpoint)

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