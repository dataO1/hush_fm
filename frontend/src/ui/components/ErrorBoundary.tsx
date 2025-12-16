import { ErrorBoundary as SolidErrorBoundary } from 'solid-js'
import type { ParentComponent, JSX } from 'solid-js'

/**
 * Error display component
 */
interface ErrorDisplayProps {
  error: Error
  onRetry?: () => void
}

const ErrorDisplay = (props: ErrorDisplayProps) => {
  return (
    <div class="min-h-screen bg-base-100 flex items-center justify-center p-4">
      <div class="card bg-error text-error-content max-w-md w-full">
        <div class="card-body">
          <h2 class="card-title">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Something went wrong
          </h2>
          
          <div class="space-y-2">
            <p class="text-sm opacity-90">
              {props.error.name}: {props.error.message}
            </p>
            
            {(import.meta as any).env?.DEV && props.error.stack && (
              <details class="text-xs">
                <summary class="cursor-pointer opacity-75">Stack trace</summary>
                <pre class="mt-2 overflow-auto max-h-32 text-xs opacity-75 whitespace-pre-wrap">
                  {props.error.stack}
                </pre>
              </details>
            )}
          </div>

          <div class="card-actions justify-end">
            <button 
              class="btn btn-outline btn-sm"
              onClick={() => window.location.reload()}
            >
              Reload Page
            </button>
            
            {props.onRetry && (
              <button 
                class="btn btn-primary btn-sm"
                onClick={props.onRetry}
              >
                Try Again
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Global Error Boundary component
 * Catches all unhandled errors in the component tree
 */
export const ErrorBoundary: ParentComponent = (props) => {
  return (
    <SolidErrorBoundary
      fallback={(error, reset) => (
        <ErrorDisplay 
          error={error} 
          onRetry={reset}
        />
      )}
    >
      {props.children}
    </SolidErrorBoundary>
  )
}

/**
 * Component-specific Error Boundary
 * Can be used to isolate errors to specific parts of the app
 */
interface ComponentErrorBoundaryProps {
  fallback?: (error: Error, reset: () => void) => JSX.Element
  onError?: (error: Error) => void
}

export const ComponentErrorBoundary: ParentComponent<ComponentErrorBoundaryProps> = (props) => {
  const defaultFallback = (error: Error, reset: () => void) => (
    <div class="alert alert-error">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 shrink-0 stroke-current" fill="none" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
      </svg>
      <div>
        <h3 class="font-bold">Component Error</h3>
        <div class="text-xs">{error.message}</div>
      </div>
      <button class="btn btn-sm btn-outline" onClick={reset}>
        Retry
      </button>
    </div>
  )

  return (
    <SolidErrorBoundary
      fallback={props.fallback || defaultFallback}
    >
      {props.children}
    </SolidErrorBoundary>
  )
}