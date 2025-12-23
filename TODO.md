# Migration to better solidjs
- [ ] Adjust Services to use new Schema.Service pattern instead of manual layer
  + Tag.
- [ ] Adjust services to use the new websocketclient correctly with command
  schemas.
- [ ] Create a WebrtcService, which handles the event handlers and cleanup etc,
  then remove direct fields this from the store and only keep ui required status.
- [ ] Use conditional context injection for services, to be only initiated in certain routes. for example. for example the dj application service, which can then inject the websocketclient with the right url from the route params. we can remove websocket and service related things from the schema and store then. (https://www.google.com/search?q=how+should+i+handle+service+injection+in+solidj+with+requirements%3F+for+example+only+on+a+route%2C+that+has+an+url+parameter%2C+which+a+websocketclient+service+requires.&client=firefox-b-d&sca_esv=50ea77102f6ce127&channel=entpr&sxsrf=AE3TifMhTT5hvrQ0QDxgigCE54qc5eH08Q%3A1766488680937&udm=50&fbs=AIIjpHxU7SXXniUZfeShr2fp4giZ1Y6MJ25_tmWITc7uy4KIemkjk18Cn72Gp24fGkjjh6w8f_UmwvItOb-_M1yJww2SjGV8ZKbU4oS5Th-nIEousNh4akm2HdhdcqnPYY5MOPvlpEvL-IplYx00cbkjRJ-i_U682BXjicGzqsz8IiN83NMslbXZjmipEC18JghemD6lEXDc&aep=1&ntc=1&sa=X&ved=2ahUKEwjmx86Sy9ORAxUJ0wIHHayEAKAQ2J8OegQIDhAE&biw=1886&bih=930&dpr=1&mtid=bHpKaajOB8Xsi-gPyqCHsAI&mstk=AUtExfBolgXxB3D5P1ZHuG_-X3hmp761e_2NnE08JC-rgJE-BhXCmdfhVTaMm0G3Bi75EcPGvVQheSDSpXxFT7Qur7I5KcpKYc1FriCf6mlLTupx8ZgYPRQnUf6K8S5hlAvj-xBeT4ZzfRba3E4ZJEFP8aZGWh77RNsVfu3JyvHKsa24wdlHq4bfxa7xd9gyqp3Dg1aiu24u19SMlaPLbjnVk3YuvFiiVhLKjuf2SKxVQHlIJvI289K6x8YTwgNEn0j-FobYIIRu4WVXhvxB_gC9ip6p5Lw817GcEUN36vrLbWoITtecRUIfUdOqjld-k0zaSSsUPUZD4oAImg&csuir=1)
- [ ]



# TODOS
- [ ] Create a proper readme, with sections for architectur explanation, usage
  explanation, deploument (with the weird build steps we have to make due to
  aarch on pi etc). important settings for the flake

# Performance
- [ ] Frontend eats resources, check whether its the oscilloscope and if this is
  due to signals/store updates?
# Bugs
## Critical
- [x] the dj getusermedia is asking for video permissions both on firefox and
  chrome, we only want audio!
- [x] when a page in the frontend is requested make sure to properly initialize
  the store with an empty state. currently when connected as a listener with a
  succeeded active webrtc connection to the dj, then pressing back to the lobby,
  the webrtc connection is still active and i still hear audio (tested only on
  firefox on linux and ios, but on mobile chrome it worked). check if this
  should be done on page load (so when pressing back if page load should trigger
  and reset to page specific state, ie in lobby only connect lobby websocket,
  and reset room state with all listener and dj states) or unload.
- [ ] waveform oscilloscope only works on chrome based browsers but not for
  firefox based browsers! research why.
- [ ] on mobile the stream is running perfectly in the background, also in
  locked screen etc, but make sure we show a mediaplayer status or something
  that indicates that we are playing music on the lockscreen !.
- [ ] ending the stream does not send lobby update to remove room from promoted
  list.
- [ ] if the dj diconnects, the status need to be updated for listeners and also
  if the dj reconnects this should trigger a renewal of transport and consumer
  on the listener side (via event)
## Whatever
- [ ] remote connection works for udp! but somehow my chromium browser on
  wayland linux fails to create matching local ice candidate for udp!
- [x] play/pause events are either not sent out by the backend or handled in the frontend! muting does not work.

# Architecture/Functionality
## Critical
- [ ] How to properly handle dj disconnection while streaming. we need to be
  able to keep the server room state and reconnect from the client using the
  same sessionid and just reestablish a new producer, that is still connected to
  the existing listeners/consumers/listen transports
## Cool to have
- [ ] When the dj disconnects, instead of streaming silence stream waiting track
  from the server(research if this is a good idea even...)

# UI Update
- [ ] make list autosized, not scrollable

# SolidJS Store & Performance Analysis

## Current Issues Identified

### 1. Store Creation Anti-Pattern ⚠️
- **Problem**: Components create store instances unnecessarily (e.g., `ConnectionStatusDot.tsx:27`)
- **Impact**: Creates new stores per component instead of using singletons
- **Solution**: Use existing singleton getters consistently

### 2. Context Missing for Global State 📡
- **Problem**: No Context API usage for sharing stores across components
- **Impact**: Manual store passing and potential prop drilling
- **Solution**: Implement Context providers for stores

### 3. Inefficient Computed Values 🔄
- **Problem**: Some getters in stores use complex logic without memoization
- **Impact**: Unnecessary re-computations on each access
- **Solution**: Convert to `createMemo()` where appropriate

### 4. Large Store State Objects 📦
- **Problem**: Room store has massive state object (938 lines)
- **Impact**: Potential granularity issues with reactivity
- **Solution**: Split into focused sub-stores

### 5. Type Safety Issues 🔒
- **Problem**: Excessive use of `as any` casting in stores
- **Impact**: Loss of type safety benefits
- **Solution**: Improve type definitions and remove unsafe casts

### 6. Effect Runtime in Stores 🚫
- **Problem**: Room store initializes Effect runtime internally
- **Impact**: Violates separation of concerns
- **Solution**: Move Effect handling to services

# Room Store Restructuring: Domain-Driven Store Separation

## Current Architecture Problems

### 1. **Massive Monolithic Store** 🏗️
- `room.store.ts` has 938 lines with massive unified state
- Combines DJ, Listener, Room metadata, WebRTC, and streaming concerns
- Single store instance manages 5+ different domains

### 2. **Tight Cross-References** 🔗
- Services directly reference `RoomStore` type and instance
- Components pass entire `roomStore` to other components
- State updates require knowledge of entire store structure

### 3. **Mixed Concerns** 🌀
- Room store contains Effect runtime initialization
- Store actions contain business logic
- WebRTC status mixed with room connection state

## Restructuring Strategy: Domain-Driven Store Separation

### Phase 1: Core Store Decomposition

**1.1 Connection Store** (`stores/connection.store.ts`)
```typescript
// Pure connection state - no MediaSoup knowledge
interface ConnectionStore {
  state: ConnectionState
  roomId: string | null
  connectionType: 'dj' | 'listener' | null
  lastError: string | null
}
```

**1.2 WebRTC Store** (`stores/webrtc.store.ts`)
```typescript
// Pure WebRTC transport state - no domain knowledge
interface WebRTCStore {
  status: WebRTCConnectionState
  error: WebRTCError | null
  activeTimeouts: Record<string, number>
}
```

**1.3 Room Metadata Store** (`stores/room-metadata.store.ts`)
```typescript
// Pure room information - no participant state
interface RoomMetadataStore {
  metadata: RoomMetadata | null
  streaming: StreamingStatus
}
```

**1.4 DJ Store** (`stores/dj.store.ts`)
```typescript
// Pure DJ state - self-contained MediaSoup management
interface DJStore {
  state: DJState | null
  actions: DJActions
  isStreaming: boolean
  flowStep: DJFlowStep
}
```

**1.5 Listeners Store** (`stores/listeners.store.ts`)
```typescript
// Pure listener collection - manages multiple listener states
interface ListenersStore {
  listeners: Record<string, ListenerState>
  actions: ListenerCollectionActions
  getListener(id: string): ListenerState | null
}
```

### Phase 2: Event-Driven Store Communication

**2.1 Store Event Bus** (`stores/store-events.ts`)
```typescript
// Type-safe event system for store communication
type StoreEvent =
  | { type: 'CONNECTION_CHANGED'; state: ConnectionState }
  | { type: 'WEBRTC_STATUS_CHANGED'; status: WebRTCConnectionState }
  | { type: 'DJ_FLOW_STEP_CHANGED'; step: DJFlowStep }
  | { type: 'LISTENER_ADDED'; id: string }
```

**2.2 Cross-Store Reactions** (`stores/store-reactions.ts`)
```typescript
// Pure reactive patterns - no direct store dependencies
setupStoreReactions(() => {
  // When DJ starts streaming, update room metadata
  storeEvents.on('DJ_FLOW_STEP_CHANGED', (event) => {
    if (event.step === 'streaming') {
      getRoomMetadataStore().actions.setStreaming('streaming')
    }
  })
})
```

### Phase 3: Service Layer Decoupling

**3.1 Service Interface Abstraction**
```typescript
// Services work with interfaces, not concrete stores
interface ConnectionStateManager {
  getState(): ConnectionState
  setState(state: ConnectionState): void
}

// Services receive focused interfaces
export const publishDJRoom = (
  connection: ConnectionStateManager,
  webrtc: WebRTCStatusManager,
  dj: DJStateManager,
  roomId: string
) => { /* ... */ }
```

**3.2 Store Adapter Layer** (`stores/adapters/`)
```typescript
// Adapters implement service interfaces
export const createConnectionAdapter = (store: ConnectionStore): ConnectionStateManager => ({
  getState: () => store.state.connectionState,
  setState: (state) => store.actions.setConnectionState(state)
})
```

### Phase 4: Component Context Providers

**4.1 Store Context Separation**
```typescript
// Each store gets its own context
const DJStoreContext = createContext<DJStore>()
const ListenersStoreContext = createContext<ListenersStore>()
const ConnectionStoreContext = createContext<ConnectionStore>()
const WebRTCStoreContext = createContext<WebRTCStore>()

// Components use specific contexts
function DJRoom() {
  const djStore = useContext(DJStoreContext)
  const connectionStore = useContext(ConnectionStoreContext)
  // No access to unrelated stores
}
```

## Implementation Benefits

### 🎯 **True Separation**
- Each store manages single domain
- No cross-references between stores
- Services use interfaces, not concrete stores

### ⚡ **Performance**
- Fine-grained reactivity per domain
- Smaller store updates trigger fewer re-renders
- Memory efficiency with focused state

### 🔧 **Maintainability**
- Clear responsibilities per store
- Easier to test individual domains
- Reduced coupling between features

### 🔒 **Type Safety**
- Store interfaces prevent wrong store usage
- Compile-time guarantees for store interactions
- Clear API boundaries

## Implementation Tasks

### Phase 1: Core Store Decomposition
- [ ] Create `stores/connection.store.ts`
- [ ] Create `stores/webrtc.store.ts`
- [ ] Create `stores/room-metadata.store.ts`
- [ ] Create `stores/dj.store.ts`
- [ ] Create `stores/listeners.store.ts`

### Phase 2: Event-Driven Communication
- [ ] Create `stores/store-events.ts`
- [ ] Create `stores/store-reactions.ts`

### Phase 3: Service Layer Decoupling
- [ ] Create adapter interfaces
- [ ] Create store adapters
- [ ] Update services to use interfaces

### Phase 4: Component Context Providers
- [ ] Add context providers to App.tsx
- [ ] Update components to use contexts
- [ ] Remove store prop drilling

### Phase 5: Migration & Cleanup
- [ ] Migrate existing functionality
- [ ] Remove old monolithic room store
- [ ] Update TypeScript types
