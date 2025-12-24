/**
 * App Layout Component
 * 
 * Root layout for the entire application using SolidJS Router's root pattern.
 * This layout wraps all routes and never re-renders on route changes, making it
 * ideal for global state providers and route debugging.
 * 
 * Provides simple route change tracking for debugging purposes.
 */

import { createEffect, Show } from 'solid-js'
import { useLocation, type RouteSectionProps } from '@solidjs/router'
import { useAudioAdapter, useConnectionAdapter } from '../../App'
import { StreamError } from '../components/streaming/StreamError'

export default function AppLayout(props: RouteSectionProps) {
  const location = useLocation() // ✅ Now valid within Router context via root layout
  let previousRoute = ''

  // Get adapters for global error handling
  const audioAdapter = useAudioAdapter()
  const connectionAdapter = useConnectionAdapter()

  // SolidJS 2025: Simple route tracking for debugging
  createEffect(() => {
    const currentRoute = location.pathname
    
    if (previousRoute && previousRoute !== currentRoute) {
      console.info(`🔄 AppLayout: Route change detected: ${previousRoute} → ${currentRoute}`)
    }
    
    previousRoute = currentRoute
  })

  // Global error state
  const audioError = () => audioAdapter.getError()
  const connectionError = () => connectionAdapter.getError()
  
  // Show audio errors if they exist, otherwise show connection errors
  const globalError = () => audioError() || connectionError()
  const hasGlobalError = () => audioAdapter.hasError() || connectionAdapter.hasError()

  // This layout wraps all routes and never re-renders
  return (
    <>
      {props.children}
      
      {/* Global Stream Error Overlay */}
      <Show when={hasGlobalError()}>
        <StreamError 
          error={globalError}
          onDismiss={() => {
            if (audioAdapter.hasError()) {
              audioAdapter.clearError()
            } else if (connectionAdapter.hasError()) {
              connectionAdapter.clearError()
            }
          }}
          variant="floating"
        />
      </Show>
    </>
  )
}