/**
 * DJ Store Adapter
 * 
 * Effect-TS Context.Tag pattern for DJ state management.
 * Services use this tag for dependency injection, never importing the implementation directly.
 */

import { Context, Layer, Option as O } from 'effect'
import type { DJStore } from '../dj.store'
import { getDJStore } from '../dj.store'
import type { DJStateType, DJFlowStepType } from '../../domain/schemas/dj.schema'

/**
 * DJ Adapter Interface
 * 
 * Service layer contract for DJ state management.
 */
export interface DJAdapter {
  // DJ flow management
  setFlowStep: (step: DJFlowStepType, error?: string) => void
  setFlowError: (error: string) => void
  clearFlowError: () => void
  
  // Producer management
  setProducer: (producer: any) => void
  setProducerConfirmation: (producerId: string) => void
  clearProducer: () => void
  
  // WebSocket management
  setWebSocketConnection: (ws: WebSocket, url: string) => void
  clearWebSocketConnection: () => void
  
  // Device management
  setDevice: (device: any) => void
  clearDevice: () => void
  
  // Audio management
  setAudioTrack: (track: MediaStreamTrack, stream: MediaStream, deviceId?: string) => void
  clearAudioTrack: () => void
  
  // Preview management
  startPreview: (stream: MediaStream) => void
  stopPreview: () => void
  
  // State access
  getCurrentStep: () => string
  isStreaming: () => boolean
  isProducerConfirmed: () => boolean
  getProducerId: () => string | null
  getSelectedDeviceId: () => string | null
  
  // Reset
  reset: () => void
}

/**
 * DJ Adapter Context Tag
 * 
 * Services import and use this tag for dependency injection.
 * Uses the same name as the interface for clean imports.
 */
export class DJAdapter extends Context.Tag("@app/adapters/DJAdapter")<
  DJAdapter,
  DJAdapter
>() {}

/**
 * DJ Adapter Implementation
 * 
 * Creates a DJAdapter implementation using the DJStore.
 * This is used by the Layer, never imported directly by services.
 */
const createDJAdapterImpl = (
  store?: DJStore
): DJAdapter => {
  const djStore = store || getDJStore()

  return {
    // Flow management
    setFlowStep: (step: DJFlowStepType, error?: string) => {
      djStore.actions.setFlowStep(step, error)
    },

    setFlowError: (error: string) => {
      djStore.actions.setFlowError(error)
    },

    clearFlowError: () => {
      djStore.actions.clearFlowError()
    },

    // Producer management
    setProducer: (producer: any) => {
      djStore.actions.updateState({
        producer: {
          producer: O.some(producer),
          confirmed: false,
          producerId: O.none(),
          connectionState: 'new',
          track: O.none(),
          appData: O.none(),
          stats: O.none(),
          createdAt: O.some(new Date()),
          error: O.none()
        }
      })
    },

    setProducerConfirmation: (producerId: string) => {
      djStore.actions.setProducerConfirmation(producerId)
    },

    clearProducer: () => {
      djStore.actions.clearProducer()
    },

    // WebSocket management
    setWebSocketConnection: (ws: WebSocket, url: string) => {
      const currentWebSocket = djStore.state?.websocket || {}
      djStore.actions.updateState({
        websocket: {
          ...currentWebSocket,
          websocket: O.some(ws),
          connectionState: 'connected',
          url: O.some(url),
          connectedAt: O.some(new Date())
        }
      })
    },

    clearWebSocketConnection: () => {
      const currentWebSocket = djStore.state?.websocket || {}
      djStore.actions.updateState({
        websocket: {
          ...currentWebSocket,
          websocket: O.none(),
          connectionState: 'disconnected'
        }
      })
    },

    // Device management
    setDevice: (device: any) => {
      const currentDevice = djStore.state?.device || {}
      djStore.actions.updateState({
        device: {
          ...currentDevice,
          device: O.some(device),
          loaded: true,
          rtpCapabilities: O.some(device.rtpCapabilities),
          handlerName: O.some(device.handlerName),
          routerCompatible: true
        }
      })
    },

    clearDevice: () => {
      const currentDevice = djStore.state?.device || {}
      djStore.actions.updateState({
        device: {
          ...currentDevice,
          device: O.none(),
          loaded: false
        }
      })
    },

    // Audio management
    setAudioTrack: (track: MediaStreamTrack, stream: MediaStream, deviceId?: string) => {
      const currentAudioTrack = djStore.state?.audioTrack || {}
      djStore.actions.updateState({
        audioTrack: {
          ...currentAudioTrack,
          track: O.some(track),
          stream: O.some(stream),
          deviceId: deviceId ? O.some(deviceId) : O.none(),
          acquiredAt: O.some(new Date()),
          error: O.none()
        }
      })
    },

    clearAudioTrack: () => {
      const currentAudioTrack = djStore.state?.audioTrack || {}
      djStore.actions.updateState({
        audioTrack: {
          ...currentAudioTrack,
          track: O.none(),
          stream: O.none()
        }
      })
    },

    // Preview management
    startPreview: (stream: MediaStream) => {
      djStore.actions.startPreview(stream)
    },

    stopPreview: () => {
      djStore.actions.stopPreview()
    },

    // State access
    getCurrentStep: () => {
      return djStore.currentFlowStep()
    },

    isStreaming: () => {
      return djStore.isStreaming()
    },

    isProducerConfirmed: () => {
      return djStore.hasProducer()
    },

    getProducerId: () => {
      return djStore.producerId()
    },

    getSelectedDeviceId: () => {
      return djStore.selectedDeviceId()
    },

    // Reset
    reset: () => {
      djStore.actions.reset()
    }
  }
}

/**
 * DJ Adapter Layer
 * 
 * Live implementation layer that provides the DJAdapter using SolidJS stores.
 * Use this in your app's main Layer composition.
 */
export const DJAdapterLive = Layer.succeed(
  DJAdapter,
  createDJAdapterImpl()
)