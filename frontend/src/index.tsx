/* @refresh reload */
import { render } from 'solid-js/web'
import App from './App'

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