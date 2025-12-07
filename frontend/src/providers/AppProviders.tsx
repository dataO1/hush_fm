import type { ParentComponent } from 'solid-js'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { WebRTCProvider } from './WebRTCProvider'
import { SignalingProvider } from './SignalingProvider'

/**
 * App Providers component
 * Composes all application providers with proper error boundary
 */
export const AppProviders: ParentComponent = (props) => {
  return (
    <ErrorBoundary>
      <WebRTCProvider>
        <SignalingProvider>
          {props.children}
        </SignalingProvider>
      </WebRTCProvider>
    </ErrorBoundary>
  )
}

/**
 * Re-export all provider hooks for convenience
 */
export {
  // WebRTC hooks
  useWebRTC,
  useWebRTCDevice,
  useWebRTCConnection,
  useStreamingState,
  useAudioLevel
} from './WebRTCProvider'

export {
  // Signaling hooks
  useSignaling,
  useLobbyConnection,
  useRoomConnection,
  useRooms,
  useCurrentRoom
} from './SignalingProvider'

/**
 * Provider types re-exports
 */
export type {
  WebRTCContextType,
  ConnectionState,
  DeviceState,
  TransportState,
  ProducerState,
  ConsumerState,
  WebRTCStore
} from './WebRTCProvider'

export type {
  SignalingContextType,
  WSConnectionState,
  SignalingStore,
  ServerMessage,
  BroadcastMessage,
  DJMessage
} from './SignalingProvider'