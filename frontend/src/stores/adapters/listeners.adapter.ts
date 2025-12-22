/**
 * Listeners Store Adapter
 * 
 * Effect-TS Context.Tag pattern for managing multiple listener instances.
 * Services use this tag for dependency injection, never importing the implementation directly.
 */

import { Context, Layer } from 'effect'
import type { ListenersStore } from '../listeners.store'
import { getListenersStore } from '../listeners.store'
import type { ListenerStateType, ListenerFlowStepType } from '../../domain/schemas/listener.schema'

/**
 * Listeners Adapter Interface
 * 
 * Service layer contract for managing multiple listener instances.
 */
export interface ListenersAdapter {
  // State management
  updateListenerState: (listenerId: string, updates: Partial<ListenerStateType>) => void
  removeListener: (listenerId: string) => void
  
  // Flow management 
  setListenerFlowStep: (listenerId: string, step: ListenerFlowStepType, error?: string) => void
  setListenerFlowError: (listenerId: string, error: string) => void
  
  // Audio management
  setListenerAutoplayBlocked: (listenerId: string, blocked: boolean) => void
  setListenerMuted: (listenerId: string, muted: boolean) => void
  setListenerVolume: (listenerId: string, volume: number) => void
  
  // Transport and Consumer management
  setListenerTransportConfirmation: (listenerId: string) => void
  setListenerConsumerConfirmation: (listenerId: string, consumerId: string, producerId: string, consumerParameters: any) => void
  
  // State access
  getListenerState: (listenerId: string) => ListenerStateType | null
  hasListener: (listenerId: string) => boolean
  getActiveListenerRoomId: () => string | null
  
  // Reset
  reset: () => void
}

/**
 * Listeners Adapter Context Tag
 * 
 * Services import and use this tag for dependency injection.
 * Uses the same name as the interface for clean imports.
 */
export class ListenersAdapter extends Context.Tag("@app/adapters/ListenersAdapter")<
  ListenersAdapter,
  ListenersAdapter
>() {}

/**
 * Listeners Adapter Implementation
 * 
 * Creates a ListenersAdapter implementation using the ListenersStore.
 * This is used by the Layer, never imported directly by services.
 */
const createListenersAdapterImpl = (
  store?: ListenersStore
): ListenersAdapter => {
  const listenersStore = store || getListenersStore()

  return {
    // State management
    updateListenerState: (listenerId: string, updates: Partial<ListenerStateType>) => {
      listenersStore.actions.updateListener(listenerId, updates)
    },

    removeListener: (listenerId: string) => {
      listenersStore.actions.removeListener(listenerId)
    },

    // Flow management
    setListenerFlowStep: (listenerId: string, step: ListenerFlowStepType, error?: string) => {
      listenersStore.actions.setListenerFlowStep(listenerId, step, error)
    },

    setListenerFlowError: (listenerId: string, error: string) => {
      listenersStore.actions.setListenerError(listenerId, error)
    },

    // Audio management
    setListenerAutoplayBlocked: (listenerId: string, blocked: boolean) => {
      listenersStore.actions.setListenerAutoplayBlocked(listenerId, blocked)
    },

    setListenerMuted: (listenerId: string, muted: boolean) => {
      listenersStore.actions.setListenerMuted(listenerId, muted)
    },

    setListenerVolume: (listenerId: string, volume: number) => {
      listenersStore.actions.setListenerVolume(listenerId, volume)
    },

    // Transport and Consumer management
    setListenerTransportConfirmation: (listenerId: string) => {
      listenersStore.actions.setListenerTransportConfirmation(listenerId)
    },

    setListenerConsumerConfirmation: (listenerId: string, consumerId: string, producerId: string, consumerParameters: any) => {
      listenersStore.actions.setListenerConsumerConfirmation(listenerId, consumerId, producerId, consumerParameters)
    },

    // State access
    getListenerState: (listenerId: string) => {
      return listenersStore.getListener()(listenerId)
    },

    hasListener: (listenerId: string) => {
      return listenersStore.hasListener()(listenerId)
    },

    getActiveListenerRoomId: () => {
      return listenersStore.getActiveListenerRoomId()()
    },

    // Reset
    reset: () => {
      listenersStore.actions.reset()
    }
  }
}

/**
 * Listeners Adapter Layer
 * 
 * Live implementation layer that provides the ListenersAdapter using SolidJS stores.
 * Use this in your app's main Layer composition.
 */
export const ListenersAdapterLive = Layer.succeed(
  ListenersAdapter,
  createListenersAdapterImpl()
)