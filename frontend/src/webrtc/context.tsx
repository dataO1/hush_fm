/**
 * @deprecated This file previously contained a legacy WebRTCProvider.
 * 
 * WebRTC context has been migrated to a new provider-based architecture.
 * Use the new WebRTCProvider instead.
 * 
 * Use:
 * import { useWebRTC, WebRTCProvider } from '../providers/WebRTCProvider'
 * 
 * Types and hooks are re-exported for compatibility.
 */

/**
 * Re-export the new provider and hooks
 */
export { 
  WebRTCProvider,
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
  WebRTCStore,
  ConnectionState,
  DeviceState,
  TransportState,
  ProducerState,
  ConsumerState
} from '../providers/WebRTCProvider'