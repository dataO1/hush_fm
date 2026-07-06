
# TODOS
> **⚠ Party post-mortem worklist (2026-07): see [TODO_PARTY_FIXES.md](TODO_PARTY_FIXES.md)** —
> Android lock-screen audio loss, old-iPhone bundle crash, offline-router
> connectivity checks, offline HTTPS. Supersedes the "stream runs perfectly on
> locked screen" claim below (party disproved it).
- [ ] Create a proper readme, with sections for architectur explanation, usage
  explanation, deploument (with the weird build steps we have to make due to
  aarch on pi etc). important settings for the flake
- [ ] **Cleanup / rewrite the README later** — it will get a device/browser
  SUPPORT MATRIX at the top (current + "could-support-if-we-change-target/deps"),
  added 2026-07-05; the rest of the README still needs the proper rewrite above.

# Performance

# TO TEST AT HOME — fixes on party-fixes, NOT yet device-verified (2026-07-06)
> Deployed via frontend rebuild + backend rebuild. Test on real phones.
- [ ] **0. DEPLOY the full new stack** (party-fixes: X1/X5 frontend + reaper + pong-deadline
  + DJ-disconnect/backpressure) in ONE deploy (`./scripts/deploy-pi.sh`), then run all below.
- [ ] **X1 Enable-Audio modal** (38b8e860): on an old iPhone (autoplay usually blocked)
  AND an Android phone, tap "Enable Audio" → audio should actually PLAY (was permanent
  silence). No regression on: fresh join, OS-interruption resume (call/alarm), reconnect.
- [ ] **X5 session id** (38b8e860): two identical phone models can BOTH listen without
  kicking each other off; a reload keeps the same listener (check `localStorage`
  key `hushfm-device-id` persists and is unique per device).
- [ ] **Ghost reaper — vanished mobile client** (reaper 600s + pong-deadline debde1e7):
  lock a listener phone / kill its WiFi / force-close the app (NO clean WS close) → the
  server detects it in ~30-40s (pong deadline) and reaps the listener after the 10-min
  grace; `listener_count` drops. Reconnect within the grace → same listener kept.
- [ ] **DJ disconnect → room pause/close** (X7): DJ closes tab / phone locks / crashes →
  room PAUSES (listeners see paused); after the ~15-min DJ grace the room CLOSES.
  DJ reconnect within the grace → stream resumes.
- [ ] **Listeners kicked on room close**: when a room closes (DJ ends it OR the DJ-disconnect
  grace expires), ALL listeners are notified + removed — no ghost listeners, no stuck UI.
- [ ] **Backpressure**: a listener/DJ that stops reading must not hang the server task
  (WS sends are timeout-bounded).

# Client-Side Bug Audit (2026-07-06)
> Full detail + per-bug validation tracking: **[docs/bug-audit-2026-07-06.md](docs/bug-audit-2026-07-06.md)**
> 5 CRITICAL, 8 HIGH, 13 MEDIUM found by a 3-agent client-side audit. We deep-dive
> and validate each before fixing. Status so far:
- [x] X1 ✔️FIXED "Enable Audio" modal can permanently silence the listener (kills its own track on iOS / no-op on Android)
- [ ] X2 `try/catch` in `Effect.gen` = dead DJ-publish cleanup
- [ ] X3 nav-away leaks media pipeline (DJ mic stays hot; anchor bed leaks) + stale-connected no-ops re-joins
- [ ] X4 wake-up recovery race ("unlock → silent → lock/unlock again")
- [x] X5 ✔️FIXED sessionId deterministic fingerprint → identical phones collide (no anti-collision randomness in code)
- [ ] X6 backend errors never resolve pending request → 30s hang; dead-room → reconnect churn
- [ ] X7 DJ WS death → zombie public rooms
- [ ] X8 zombie/duplicate reconnect loops
- [ ] X9–X13 + M1–M13 — see the doc

# Bugs
## Critical
- [ ] **Offline router: phones warn "network has no internet" and DROP the
  WiFi after a while (Android especially — falls back to mobile data / kicks
  the connection).** Party field data: "stay connected" did NOT stick —
  guests were re-prompted all evening (Android re-validates on every
  reassociation; acceptance doesn't persist; Samsung Intelligent-WiFi is
  worse). Verified plan 2026-07-04 (supersedes §3's "fakeinternet=done"):
  [docs/offline-router-connectivity.md](docs/offline-router-connectivity.md)
  — Tier 2 = fakeinternet spoof (DNS+DNAT; fully cleans iOS/old Android;
  modern Android still re-prompts but survives with mobile data off) +
  Tier 1 = minimal real uplink (phone-hotspot USB tether) with a LAN→WAN
  allowlist for ONLY the probe hosts → genuine HTTPS validation → ZERO
  prompts on every OS. Do both; signage regardless. MUST be done before
  the party — pairs with the dnsmasq override (plan card 8).
- [ ] DJ "Go Live" retry after a failure REUSES the previously announced room
  (old name/id) instead of announcing a new room with the newly entered name —
  user typed "lkalkja", ended up streaming as the earlier room
  "hahhahahahhahah" (2026-07-03). AbortRoom on failure or re-announce on retry
  needed.
- [ ] waveform oscilloscope only works on chrome based browsers but not for
  firefox based browsers! research why.
- [ ] on mobile the stream is running perfectly in the background, also in
  locked screen etc, but make sure we show a mediaplayer status or something
  that indicates that we are playing music on the lockscreen !.
- [ ] if the dj diconnects, the status need to be updated for listeners and also
  if the dj reconnects this should trigger a renewal of transport and consumer
  on the listener side (via event)
- [ ] need to handle disconnection of the producer via mediasoup events. this
  should be an extra event handler, the ui can subscribe to to set the state
  accordingly (ie. producer disconnected -> connectionstate.djdisconnected ,
  producer connected -> streaming)
- [ ] also the play/pause subscriptions dont set the connectionstate to
  paused/streaming
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
