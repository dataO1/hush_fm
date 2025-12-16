import { createSignal, Show } from 'solid-js'

export interface WebRTCError {
  type: 'transport_connection' | 'producer_creation' | 'device_initialization' | 'unknown'
  message: string
  retryAttempts?: number
  maxRetries?: number
  canRetry: boolean
  originalError?: Error
}

interface WebRTCErrorHandlerProps {
  error: WebRTCError | null
  onRetry?: () => Promise<void>
  onDismiss?: () => void
  onCancel?: () => void
  show?: boolean
}

export function WebRTCErrorHandler(props: WebRTCErrorHandlerProps) {
  const [isRetrying, setIsRetrying] = createSignal(false)
  const [retryCount, setRetryCount] = createSignal(0)

  const handleRetry = async () => {
    if (!props.onRetry || !props.error?.canRetry) return
    
    setIsRetrying(true)
    setRetryCount(c => c + 1)
    
    try {
      await props.onRetry()
      props.onDismiss?.()
    } catch (error) {
      console.error('Retry failed:', error)
      // Error will be handled by the parent component
    } finally {
      setIsRetrying(false)
    }
  }

  const getErrorTitle = (error: WebRTCError) => {
    switch (error.type) {
      case 'transport_connection':
        return 'Connection Failed'
      case 'producer_creation':
        return 'Audio Stream Failed'
      case 'device_initialization':
        return 'Device Error'
      default:
        return 'WebRTC Error'
    }
  }

  const getErrorDescription = (error: WebRTCError) => {
    switch (error.type) {
      case 'transport_connection':
        return 'Failed to establish a connection to the streaming server. This could be due to network issues or server problems.'
      case 'producer_creation':
        return 'Unable to start the audio stream. Please check your microphone permissions and device settings.'
      case 'device_initialization':
        return 'Failed to initialize the audio device. Please check your microphone is connected and working.'
      default:
        return 'An unexpected error occurred with the streaming system.'
    }
  }

  const getRetryText = (error: WebRTCError) => {
    if (!error.canRetry) return null
    
    if (error.retryAttempts !== undefined && error.maxRetries !== undefined) {
      return `Attempted ${error.retryAttempts} of ${error.maxRetries} times`
    }
    
    if (retryCount() > 0) {
      return `Retry attempt ${retryCount()}`
    }
    
    return null
  }

  return (
    <Show when={props.error && (props.show !== false)}>
      <div class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
        <div class="card bg-base-100 shadow-xl max-w-md w-full">
          <div class="card-body">
            <div class="flex items-start gap-3">
              <div class="flex-shrink-0">
                <svg 
                  xmlns="http://www.w3.org/2000/svg" 
                  class="h-8 w-8 text-error" 
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                >
                  <path 
                    stroke-linecap="round" 
                    stroke-linejoin="round" 
                    stroke-width="2" 
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" 
                  />
                </svg>
              </div>
              
              <div class="flex-1">
                <h3 class="font-bold text-lg mb-2">
                  {props.error ? getErrorTitle(props.error) : 'Error'}
                </h3>
                
                <p class="text-base-content/80 mb-3">
                  {props.error ? getErrorDescription(props.error) : 'Unknown error'}
                </p>
                
                <div class="bg-base-200 rounded-lg p-3 mb-4">
                  <p class="text-sm font-mono text-base-content/70">
                    {props.error?.message}
                  </p>
                  
                  <Show when={getRetryText(props.error!)}>
                    <p class="text-xs text-base-content/60 mt-2">
                      {getRetryText(props.error!)}
                    </p>
                  </Show>
                </div>

                <Show when={props.error?.type === 'transport_connection'}>
                  <div class="bg-info/10 border border-info/20 rounded-lg p-3 mb-4">
                    <div class="flex items-start gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-info mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div class="text-sm">
                        <p class="font-medium text-info mb-1">Troubleshooting tips:</p>
                        <ul class="text-xs text-base-content/70 space-y-1">
                          <li>• Check your internet connection</li>
                          <li>• Ensure microphone permissions are granted</li>
                          <li>• Try using a different microphone or device</li>
                          <li>• Try refreshing the page if the issue persists</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </Show>
              </div>
            </div>

            <div class="card-actions justify-end gap-2">
              <Show when={props.onCancel}>
                <button 
                  class="btn btn-ghost btn-sm"
                  onClick={props.onCancel}
                  disabled={isRetrying()}
                >
                  Cancel
                </button>
              </Show>
              
              <Show when={!props.error?.canRetry}>
                <button 
                  class="btn btn-outline btn-sm"
                  onClick={() => window.location.reload()}
                >
                  Reload Page
                </button>
              </Show>

              <Show when={props.error?.canRetry}>
                <button 
                  class="btn btn-primary btn-sm"
                  onClick={handleRetry}
                  disabled={isRetrying()}
                >
                  <Show when={isRetrying()}>
                    <span class="loading loading-spinner loading-xs"></span>
                  </Show>
                  <Show when={!isRetrying()}>
                    Try Again
                  </Show>
                </button>
              </Show>

              <Show when={props.onDismiss && !props.error?.canRetry}>
                <button 
                  class="btn btn-primary btn-sm"
                  onClick={props.onDismiss}
                  disabled={isRetrying()}
                >
                  OK
                </button>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </Show>
  )
}

// Utility function to create WebRTC error objects
export const createWebRTCError = (
  type: WebRTCError['type'],
  message: string,
  options?: {
    retryAttempts?: number
    maxRetries?: number
    canRetry?: boolean
    originalError?: Error
  }
): WebRTCError => {
  return {
    type,
    message,
    retryAttempts: options?.retryAttempts,
    maxRetries: options?.maxRetries,
    canRetry: options?.canRetry ?? true,
    originalError: options?.originalError
  }
}

// Helper to detect transport retry errors
export const parseTransportError = (error: Error): WebRTCError => {
  const message = error.message.toLowerCase()
  
  if (message.includes('transport connection failed after') && message.includes('retry attempts')) {
    // Extract retry information from error message
    const retryMatch = message.match(/failed after (\d+) retry attempts/)
    const maxRetries = retryMatch ? parseInt(retryMatch[1]) : undefined
    
    return createWebRTCError('transport_connection', error.message, {
      retryAttempts: maxRetries,
      maxRetries,
      canRetry: false, // Already exhausted retries
      originalError: error
    })
  }
  
  if (message.includes('transport') && message.includes('connection')) {
    return createWebRTCError('transport_connection', error.message, {
      canRetry: true,
      originalError: error
    })
  }
  
  if (message.includes('producer') || message.includes('audio')) {
    return createWebRTCError('producer_creation', error.message, {
      canRetry: true,
      originalError: error
    })
  }
  
  if (message.includes('device') || message.includes('microphone')) {
    return createWebRTCError('device_initialization', error.message, {
      canRetry: true,
      originalError: error
    })
  }
  
  return createWebRTCError('unknown', error.message, {
    canRetry: true,
    originalError: error
  })
}