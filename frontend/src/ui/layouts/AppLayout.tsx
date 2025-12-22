/**
 * App Layout Component
 * 
 * Root layout for the entire application using SolidJS Router's root pattern.
 * This layout wraps all routes and never re-renders on route changes, making it
 * ideal for global state providers and route debugging.
 * 
 * Provides simple route change tracking for debugging purposes.
 */

import { createEffect } from 'solid-js'
import { useLocation, type RouteSectionProps } from '@solidjs/router'

export default function AppLayout(props: RouteSectionProps) {
  const location = useLocation() // ✅ Now valid within Router context via root layout
  let previousRoute = ''


  // SolidJS 2025: Simple route tracking for debugging
  createEffect(() => {
    const currentRoute = location.pathname
    
    if (previousRoute && previousRoute !== currentRoute) {
      console.info(`🔄 AppLayout: Route change detected: ${previousRoute} → ${currentRoute}`)
    }
    
    previousRoute = currentRoute
  })

  // This layout wraps all routes and never re-renders
  return <>{props.children}</>
}