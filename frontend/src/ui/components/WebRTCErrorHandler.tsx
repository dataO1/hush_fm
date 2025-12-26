import { Show } from 'solid-js'
import type { ConnectionError } from '../../domain/schemas/connection.schema'

interface WebRTCErrorHandlerProps {
  error: ConnectionError | null
  onDismiss?: () => void
  onCancel?: () => void
  show?: boolean
}

export function WebRTCErrorHandler(props: WebRTCErrorHandlerProps) {

  const getErrorTitle = (error: ConnectionError) => {
    switch (error._tag) {
      case 'TransportError':
        return 'Connection Failed'
      case 'ProducerError':
        return 'Audio Stream Failed'
      case 'MediaSoupDeviceError':
        return 'Device Error'
      case 'ConsumerError':
        return 'Playback Error'
      case 'WebSocketError':
        return 'Network Error'
      default:
        return 'WebRTC Error'
    }
  }

  const getErrorDescription = (error: ConnectionError) => {
    switch (error._tag) {
      case 'TransportError':
        return 'Could not connect to streaming server. Check your internet connection.'
      case 'ProducerError':
        return 'Unable to access microphone. Check device permissions.'
      case 'MediaSoupDeviceError':
        return 'Microphone not found. Check device connection.'
      case 'ConsumerError':
        return 'Could not receive audio stream. Connection may be unstable.'
      case 'WebSocketError':
        return 'Network connection lost. Attempting to reconnect...'
      default:
        return 'Connection failed. Please try again.'
    }
  }


  return (
    <Show when={props.error && (props.show !== false)}>
      <div class="fixed inset-0 overlay-glass z-50 flex items-center justify-center p-4">
        <div class="card card-glass shadow-xl max-w-sm w-full mx-4 animate-in fade-in-0 zoom-in-95 duration-200">
          <div class="card-body p-6 text-center">
            
            {/* Error Icon */}
            <div class="flex justify-center mb-4">
              <div class="w-16 h-16 bg-error/20 rounded-full flex items-center justify-center">
                <svg class="w-8 h-8 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
            
            {/* Title and Message */}
            <h3 class="text-lg sm:text-xl font-semibold text-gruvbox-fg mb-2">
              {props.error ? getErrorTitle(props.error) : 'Connection Error'}
            </h3>
            <p class="text-sm sm:text-base text-gruvbox-fg-3 mb-4 leading-relaxed">
              {props.error ? getErrorDescription(props.error) : 'Unknown error'}
            </p>

            {/* Error Details */}
            <Show when={props.error?.message}>
              <div class="bg-gruvbox-bg-1/50 rounded-lg p-3 mb-4 border border-gruvbox-bg-3/30">
                <p class="text-xs sm:text-sm font-mono text-gruvbox-fg-4 break-words">
                  {props.error?.message}
                </p>
              </div>
            </Show>
            
            {/* Action Buttons */}
            <div class="flex flex-col sm:flex-row gap-2 justify-center">
              <Show when={props.onCancel}>
                <button 
                  class="btn btn-outline btn-md w-full sm:w-auto border-gruvbox-red-bright text-gruvbox-red-bright hover:bg-gruvbox-red-bright hover:text-gruvbox-bg-hard"
                  onClick={props.onCancel}
                >
                  Cancel
                </button>
              </Show>

              <Show when={props.onDismiss && !props.onCancel}>
                <button 
                  class="btn btn-primary btn-md w-full"
                  onClick={props.onDismiss}
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