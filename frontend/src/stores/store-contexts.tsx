/**
 * Store Contexts
 * 
 * SolidJS context providers for domain-separated stores.
 * Provides type-safe store access throughout the component tree
 * without prop drilling or direct store imports.
 */

import { createContext, useContext, type ParentComponent, onCleanup } from 'solid-js'
import type { ConnectionStore } from './connection.store'
import type { WebRTCStore } from './webrtc.store'
import type { RoomMetadataStore } from './room-metadata.store'
import type { DJStore } from './dj.store'
import type { ListenersStore } from './listeners.store'
import type { UserStore } from './user.store'
import type { LobbyStore } from './lobby.store'
import { 
  getConnectionStore, 
  getWebRTCStore, 
  getRoomMetadataStore, 
  getDJStore, 
  getListenersStore, 
  getUserStore,
  getLobbyStore
} from './index'

/**
 * Context Definitions
 */
const ConnectionStoreContext = createContext<ConnectionStore>()
const WebRTCStoreContext = createContext<WebRTCStore>()
const RoomMetadataStoreContext = createContext<RoomMetadataStore>()
const DJStoreContext = createContext<DJStore>()
const ListenersStoreContext = createContext<ListenersStore>()
const UserStoreContext = createContext<UserStore>()
const LobbyStoreContext = createContext<LobbyStore>()

/**
 * Context Hooks
 * 
 * Type-safe hooks for accessing stores from components.
 * Throw helpful errors if used outside provider scope.
 */
export const useConnectionStore = (): ConnectionStore => {
  const store = useContext(ConnectionStoreContext)
  if (!store) {
    throw new Error('useConnectionStore must be used within ConnectionStoreProvider')
  }
  return store
}

export const useWebRTCStore = (): WebRTCStore => {
  const store = useContext(WebRTCStoreContext)
  if (!store) {
    throw new Error('useWebRTCStore must be used within WebRTCStoreProvider')
  }
  return store
}

export const useRoomMetadataStore = (): RoomMetadataStore => {
  const store = useContext(RoomMetadataStoreContext)
  if (!store) {
    throw new Error('useRoomMetadataStore must be used within RoomMetadataStoreProvider')
  }
  return store
}

export const useDJStore = (): DJStore => {
  const store = useContext(DJStoreContext)
  if (!store) {
    throw new Error('useDJStore must be used within DJStoreProvider')
  }
  return store
}

export const useListenersStore = (): ListenersStore => {
  const store = useContext(ListenersStoreContext)
  if (!store) {
    throw new Error('useListenersStore must be used within ListenersStoreProvider')
  }
  return store
}

export const useUserStore = (): UserStore => {
  const store = useContext(UserStoreContext)
  if (!store) {
    throw new Error('useUserStore must be used within UserStoreProvider')
  }
  return store
}

export const useLobbyStore = (): LobbyStore => {
  const store = useContext(LobbyStoreContext)
  if (!store) {
    throw new Error('useLobbyStore must be used within LobbyStoreProvider')
  }
  return store
}

/**
 * Individual Store Providers
 * 
 * Individual context providers for each store.
 * Useful for partial store access or testing specific store combinations.
 */
export const ConnectionStoreProvider: ParentComponent = (props) => {
  const store = getConnectionStore()
  
  return (
    <ConnectionStoreContext.Provider value={store}>
      {props.children}
    </ConnectionStoreContext.Provider>
  )
}

export const WebRTCStoreProvider: ParentComponent = (props) => {
  const store = getWebRTCStore()
  
  return (
    <WebRTCStoreContext.Provider value={store}>
      {props.children}
    </WebRTCStoreContext.Provider>
  )
}

export const RoomMetadataStoreProvider: ParentComponent = (props) => {
  const store = getRoomMetadataStore()
  
  return (
    <RoomMetadataStoreContext.Provider value={store}>
      {props.children}
    </RoomMetadataStoreContext.Provider>
  )
}

export const DJStoreProvider: ParentComponent = (props) => {
  const store = getDJStore()
  
  return (
    <DJStoreContext.Provider value={store}>
      {props.children}
    </DJStoreContext.Provider>
  )
}

export const ListenersStoreProvider: ParentComponent = (props) => {
  const store = getListenersStore()
  
  return (
    <ListenersStoreContext.Provider value={store}>
      {props.children}
    </ListenersStoreContext.Provider>
  )
}

export const UserStoreProvider: ParentComponent = (props) => {
  const store = getUserStore()
  
  return (
    <UserStoreContext.Provider value={store}>
      {props.children}
    </UserStoreContext.Provider>
  )
}

export const LobbyStoreProvider: ParentComponent = (props) => {
  const store = getLobbyStore()
  
  return (
    <LobbyStoreContext.Provider value={store}>
      {props.children}
    </LobbyStoreContext.Provider>
  )
}

/**
 * Composite Store Provider
 * 
 * Provides all domain stores. No cross-store reactions - services handle orchestration.
 * This is the main provider to wrap your application.
 */
export const StoreProvider: ParentComponent = (props) => {
  // Get store instances
  const connectionStore = getConnectionStore()
  const webrtcStore = getWebRTCStore()
  const roomMetadataStore = getRoomMetadataStore()
  const djStore = getDJStore()
  const listenersStore = getListenersStore()
  const userStore = getUserStore()
  const lobbyStore = getLobbyStore()

  // Cleanup on unmount (stores are passive, no effects to clean up)
  onCleanup(() => {
    console.info('🧹 Store provider cleanup')
  })

  return (
    <ConnectionStoreContext.Provider value={connectionStore}>
      <WebRTCStoreContext.Provider value={webrtcStore}>
        <RoomMetadataStoreContext.Provider value={roomMetadataStore}>
          <DJStoreContext.Provider value={djStore}>
            <ListenersStoreContext.Provider value={listenersStore}>
              <UserStoreContext.Provider value={userStore}>
                <LobbyStoreContext.Provider value={lobbyStore}>
                  {props.children}
                </LobbyStoreContext.Provider>
              </UserStoreContext.Provider>
            </ListenersStoreContext.Provider>
          </DJStoreContext.Provider>
        </RoomMetadataStoreContext.Provider>
      </WebRTCStoreContext.Provider>
    </ConnectionStoreContext.Provider>
  )
}

/**
 * Scoped Store Providers
 * 
 * Providers for specific application sections that only need certain stores.
 * Useful for performance optimization and clear component dependencies.
 */

/**
 * Room Store Provider
 * 
 * Provides only room-related stores (excludes lobby and user stores).
 * Use this for room pages (DJ/Listener).
 */
export const RoomStoreProvider: ParentComponent = (props) => {
  const connectionStore = getConnectionStore()
  const webrtcStore = getWebRTCStore()
  const roomMetadataStore = getRoomMetadataStore()
  const djStore = getDJStore()
  const listenersStore = getListenersStore()

  return (
    <ConnectionStoreContext.Provider value={connectionStore}>
      <WebRTCStoreContext.Provider value={webrtcStore}>
        <RoomMetadataStoreContext.Provider value={roomMetadataStore}>
          <DJStoreContext.Provider value={djStore}>
            <ListenersStoreContext.Provider value={listenersStore}>
              {props.children}
            </ListenersStoreContext.Provider>
          </DJStoreContext.Provider>
        </RoomMetadataStoreContext.Provider>
      </WebRTCStoreContext.Provider>
    </ConnectionStoreContext.Provider>
  )
}

/**
 * DJ Store Provider
 * 
 * Provides only DJ-related stores.
 * Use this for DJ-specific components.
 */
export const DJOnlyStoreProvider: ParentComponent = (props) => {
  const connectionStore = getConnectionStore()
  const webrtcStore = getWebRTCStore()
  const roomMetadataStore = getRoomMetadataStore()
  const djStore = getDJStore()

  return (
    <ConnectionStoreContext.Provider value={connectionStore}>
      <WebRTCStoreContext.Provider value={webrtcStore}>
        <RoomMetadataStoreContext.Provider value={roomMetadataStore}>
          <DJStoreContext.Provider value={djStore}>
            {props.children}
          </DJStoreContext.Provider>
        </RoomMetadataStoreContext.Provider>
      </WebRTCStoreContext.Provider>
    </ConnectionStoreContext.Provider>
  )
}

/**
 * Listener Store Provider
 * 
 * Provides only listener-related stores.
 * Use this for listener-specific components.
 */
export const ListenerOnlyStoreProvider: ParentComponent = (props) => {
  const connectionStore = getConnectionStore()
  const webrtcStore = getWebRTCStore()
  const roomMetadataStore = getRoomMetadataStore()
  const listenersStore = getListenersStore()

  return (
    <ConnectionStoreContext.Provider value={connectionStore}>
      <WebRTCStoreContext.Provider value={webrtcStore}>
        <RoomMetadataStoreContext.Provider value={roomMetadataStore}>
          <ListenersStoreContext.Provider value={listenersStore}>
            {props.children}
          </ListenersStoreContext.Provider>
        </RoomMetadataStoreContext.Provider>
      </WebRTCStoreContext.Provider>
    </ConnectionStoreContext.Provider>
  )
}

/**
 * Store Context Utilities
 * 
 * Helper functions for working with store contexts.
 */
export const StoreContextUtils = {
  /**
   * Check if a specific store is available in context
   */
  hasConnectionStore: (): boolean => {
    try {
      useConnectionStore()
      return true
    } catch {
      return false
    }
  },

  hasDJStore: (): boolean => {
    try {
      useDJStore()
      return true
    } catch {
      return false
    }
  },

  hasListenersStore: (): boolean => {
    try {
      useListenersStore()
      return true
    } catch {
      return false
    }
  },

  /**
   * Get available stores (returns undefined if not in context)
   */
  getAvailableStores: () => ({
    connection: (() => {
      try { return useConnectionStore() } catch { return undefined }
    })(),
    webrtc: (() => {
      try { return useWebRTCStore() } catch { return undefined }
    })(),
    roomMetadata: (() => {
      try { return useRoomMetadataStore() } catch { return undefined }
    })(),
    dj: (() => {
      try { return useDJStore() } catch { return undefined }
    })(),
    listeners: (() => {
      try { return useListenersStore() } catch { return undefined }
    })(),
    user: (() => {
      try { return useUserStore() } catch { return undefined }
    })()
  }),

  /**
   * Debug current context availability
   */
  debugContexts: () => {
    const stores = StoreContextUtils.getAvailableStores()
    console.group('📊 Available Store Contexts')
    Object.entries(stores).forEach(([name, store]) => {
      console.log(`${name}:`, store ? '✅' : '❌')
    })
    console.groupEnd()
  }
}