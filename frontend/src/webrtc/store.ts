/**
 * @deprecated This file previously contained module-level reactive state.
 * 
 * State management has been moved to WebRTCProvider for proper reactive context.
 * Import state from useWebRTC() hook instead.
 * 
 * Use:
 * import { useWebRTC } from '../providers/AppProviders'
 * 
 * Types are re-exported from WebRTCProvider for compatibility.
 */

import { Device } from 'mediasoup-client'
import type { types } from 'mediasoup-client'

/**
 * Connection states for WebRTC components
 */
export type ConnectionState = 
  | 'disconnected'
  | 'connecting' 
  | 'connected'
  | 'failed'
  | 'reconnecting'

/**
 * Device state for mediasoup-client
 */
export type DeviceState = {
  device: Device | null
  loaded: boolean
  capabilities: any | null
  error: string | null
}

/**
 * Transport state tracking
 */
export type TransportState = {
  id: string
  direction: 'send' | 'receive'
  connectionState: ConnectionState
  iceState: RTCIceConnectionState | null
  dtlsState: RTCDtlsTransportState | null
  transport: types.Transport | null
}

/**
 * Producer state for audio streaming
 */
export type ProducerState = {
  id: string
  kind: 'audio' | 'video'
  paused: boolean
  track: MediaStreamTrack | null
  producer: types.Producer | null
}

/**
 * Consumer state for receiving audio
 */
export type ConsumerState = {
  id: string
  kind: 'audio' | 'video'
  paused: boolean
  track: MediaStreamTrack | null
  consumer: types.Consumer | null
  producerId: string
}

/**
 * Re-export hooks from new provider-based architecture
 */
export { 
  useWebRTC,
  useWebRTCDevice,
  useWebRTCConnection,
  useStreamingState,
  useAudioLevel
} from '../providers/WebRTCProvider'

/**
 * Re-export types from new provider
 */
export type {
  WebRTCContextType,
  WebRTCStore
} from '../providers/WebRTCProvider'