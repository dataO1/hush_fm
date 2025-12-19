import { Show } from 'solid-js'
import type { WebRTCError } from '../../domain/schemas/room.schema'

interface WebRTCErrorHandlerProps {
  error: WebRTCError | null
  onDismiss?: () => void
  onCancel?: () => void
  show?: boolean
}

export function WebRTCErrorHandler(props: WebRTCErrorHandlerProps) {

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
        return 'Could not connect to streaming server. Check your internet connection.'
      case 'producer_creation':
        return 'Unable to access microphone. Check device permissions.'
      case 'device_initialization':
        return 'Microphone not found. Check device connection.'
      default:
        return 'Connection failed. Please try again.'
    }
  }


  return (
    <Show when={props.error && (props.show !== false)}>
      <div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div class="card bg-white/10 backdrop-blur-sm border border-white/20 shadow-xl max-w-sm w-full mx-4 animate-in fade-in-0 zoom-in-95 duration-200">
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
            <h3 class="text-lg sm:text-xl font-semibold text-white mb-2">
              {props.error ? getErrorTitle(props.error) : 'Connection Error'}
            </h3>
            <p class="text-sm sm:text-base text-white/70 mb-4 leading-relaxed">
              {props.error ? getErrorDescription(props.error) : 'Unknown error'}
            </p>

            {/* Error Details */}
            <Show when={props.error?.message}>
              <div class="bg-white/5 rounded-lg p-3 mb-4 border border-white/10">
                <p class="text-xs sm:text-sm font-mono text-white/60 break-words">
                  {props.error?.message}
                </p>
              </div>
            </Show>
            
            {/* Action Buttons */}
            <div class="flex flex-col sm:flex-row gap-2 justify-center">
              <Show when={props.onCancel}>
                <button 
                  class="btn btn-outline btn-md w-full sm:w-auto border-red-500 text-red-500 hover:bg-red-500 hover:text-white"
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