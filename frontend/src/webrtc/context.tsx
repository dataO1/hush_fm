import { ParentComponent, useContext } from 'solid-js'
import { WebRTCContext, webrtcStore, setWebrtcStore, connectionState, isStreaming, audioLevel } from './store'

/**
 * Provider component for WebRTC context
 */
export const WebRTCProvider: ParentComponent = (props) => {
  const value = {
    store: webrtcStore,
    setStore: setWebrtcStore,
    connectionState,
    isStreaming,
    audioLevel,
  }

  return (
    <WebRTCContext.Provider value={value}>
      {props.children}
    </WebRTCContext.Provider>
  )
}

/**
 * Hook to access WebRTC context
 */
export const useWebRTC = () => {
  const context = useContext(WebRTCContext)
  if (!context) {
    throw new Error('useWebRTC must be used within WebRTCProvider')
  }
  return context
}