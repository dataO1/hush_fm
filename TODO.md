
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
- [ ] **X3 navigate-away tests**: (a) listener back-button → audio stops immediately,
  server slot freed; (b) DJ back-button → mic light off immediately, room pauses then
  closes after grace; (c) listener back-button then join a DIFFERENT room → new room
  audio plays.
- [ ] **X2 DJ publish-failure cleanup**: force a publish failure (e.g. deny mic
  permission mid-flow or kill backend between transport-create and produce) → error
  message shows, NO stuck 'Connecting…' spinner, mic light off, room does not linger
  in Setup on the server, DJ can retry without reload.

# Client-Side Bug Audit (2026-07-06)
> Full detail + per-bug validation tracking: **[docs/bug-audit-2026-07-06.md](docs/bug-audit-2026-07-06.md)**
> 5 CRITICAL, 8 HIGH, 13 MEDIUM found by a 3-agent client-side audit. We deep-dive
> and validate each before fixing. Status so far:
- [x] X1 ✔️FIXED "Enable Audio" modal can permanently silence the listener (kills its own track on iOS / no-op on Android)
- [x] X2 ✔️FIXED `try/catch` in `Effect.gen` = dead DJ-publish cleanup (Effect.onError on the pipe chain + completed cleanup: mic stop, WebRTC state reset, CloseRoom kept)
- [x] X3 ✔️FIXED nav-away leaks media pipeline (DJ mic stays hot; anchor bed leaks) + stale-connected no-ops re-joins
- [ ] X4 wake-up recovery race — DEMOTED to MEDIUM 2026-07-08 (never user-observed;
      server pong-deadline makes the force-close race mostly moot; what survives: no
      `evaluate()` after reconnect + no screen-on recovery trigger — re-scope after home tests)
- [x] X5 ✔️FIXED sessionId deterministic fingerprint → identical phones collide (no anti-collision randomness in code)
- [ ] X6 backend errors never resolve pending request → 30s hang; dead-room → reconnect churn
- [x] X7 ✔️FIXED DJ WS death → zombie public rooms (3a04d3f2: pause + 15-min grace + close; pong deadline detects vanished DJs)
- [ ] X8 zombie/duplicate reconnect loops
- [ ] X9–X13 + M1–M13 — see the doc

# Full-Flow Review (2026-07-08)
> Fable 5 deep scan of the complete DJ-create → N-listener-join → reconnect →
> pause/close → 3h-steady-state → UX flow. NOT bugs (those live in the audit
> above) — architectural gaps, missing corner cases, perf/battery/UX. All
> claims verified against code at scan time (line refs may drift).
> Coverage verdicts: DJ-create partial · N-join partial · reconnect partial ·
> pause/close covered-well · steady-state partial · UX partial.
> **Highest-leverage cluster for the next party, in order:** DJ re-publish
> orphaning + DJ reload recovery (together make a DJ phone hiccup survivable),
> reconnect jitter, pending-request flush on socket close, heartbeat cadence
> relaxation, DJ listener-count display.

## Architecture
- [ ] **DJ re-publish orphans all existing listeners** (dj.rs:211,302): a DJ page-reload
  re-runs publish; `create_sender_transport`/`create_producer` overwrite the old
  Arc<Transport>/Arc<Producer>, closing the old producer — every listener's consumer dies
  server-side with NO event sent, while their transport stays `connected` so recovery sees
  "healthy" and never re-joins → permanent silence. → Broadcast `producerChanged {producerId}`
  from `Room::create_producer` when replacing; listener treats it as forced re-consume /
  full re-join. (This is the precise mechanism behind the old "DJ reconnect should renew
  listener transport/consumer" TODO.) [impact: high, effort: L]
- [ ] **DJ reload is a dead end** (DJRoom.tsx:104-124): DJRoom depends entirely on router
  `location.state.djWebSocketUrl`; reload/crash → lobby → forced re-announce (hits the
  stale-name bug). Listener page already derives its WS URL from route params. → Derive
  `/ws/room/{roomId}` from the route param + persist roomId in sessionStorage so a reloaded
  DJ lands back in their live room within the grace window. [impact: high, effort: S]
- [ ] **Announce-reuse returns stale room metadata** (ws/mod.rs:363-402) — confirms the
  known Go-Live-retry bug is still present: `AnnounceRoom` finds the existing room by DJ
  session_id and ignores the new name/description/tags. → Update metadata on reuse, or
  close-and-recreate when the room has no producer yet. [impact: med, effort: S]
- [ ] **Setup-state rooms can leak forever; no idle sweeper; AbortRoom never implemented**
  (room.rs:167 `idle_duration` has zero callers): grace timer only arms on WS *close* — a DJ
  that announces but never opens the room WS leaks a room+router permanently. → Periodic
  lobby sweep closing Setup rooms idle > N min via the existing `idle_duration()`.
  [impact: med, effort: S]
- [ ] **WS `subscribe()` is last-writer-wins per event type** (WebSocketClient.ts:642-669):
  one handler per event type in a HashMap — a second subscriber to e.g. `roomClosed`
  silently replaces the first; works today only because subscriber sets are disjoint.
  → Store a Set of handlers per type; unsubscribe removes only its own. [impact: med, effort: S]
- [ ] **RoomAdded vs RoomUpdated decided by 30s wall-clock heuristic; client drops updates
  for unknown rooms** (lobby.rs:270-287; lobby.store.ts:75-81): a DJ taking >30s between
  announce and produce (slow mic prompt) publishes as `RoomUpdated` → connected lobbies
  never show the room. → Backend: track `was_public`, send `RoomAdded` exactly on the
  false→true transition; frontend: make `updateRoom` an upsert. [impact: med, effort: S]
- [ ] **Graceful shutdown is dead code** (main.rs:113 no `.with_graceful_shutdown`;
  `shutdown_signal` defined at 120-144, never referenced): SIGTERM (deploy/restart on the
  Pi) abruptly kills all sockets → reconnect churn against a booting server. → Wire it +
  broadcast "server restarting" to all rooms before exit. [impact: med, effort: S]
- [ ] **Dead-code cluster in WS/domain layer** (ws/mod.rs:2067-2137 `handle_request_join`
  uncalled; room.rs `connect_dj`/`pause_streaming`/`resume_streaming`/`stop_streaming`
  bypassed by inline handlers; listener.rs `pause`/`resume` unwired): inline WS handlers
  reimplement transport connect, losing the domain's 10s connect timeout. → Delete or route
  through domain methods so timeouts/DTLS-role logic live in one place. [impact: low, effort: S]

## Edge cases
- [ ] **Joining a paused room shows "live/playing" until next resume** (UserService.ts
  ~:644-650 sets STREAMING + playing unconditionally): backend sends `producer_paused` in
  consumer params (listener.rs:495), schema decodes it, nothing reads it — a listener
  joining during DJ pause (incl. the 15-min grace) sees healthy UI over silence. → Branch
  on `consumerParameters.producerPaused` after createConsumer → set PAUSED. [impact: med, effort: S]
- [ ] **`streamResumed` handler lacks the guard `streamPaused` has** (UserService.ts
  ~:771-791): sets STREAMING unconditionally — a stray frame after teardown re-poisons
  `webrtcConnectionState` (the stale-flag class X3 fixed). → Same activeRole+isConnected
  guard. [impact: low, effort: S]
- [ ] **In-flight commands not failed on socket drop → 30s frozen spinner on a
  mid-handshake WiFi blip** (WebSocketClient.ts:411-431 `onclose` never touches
  `pendingRequests`): distinct from X6 (error *frames*); this is the socket-close case,
  common on party WiFi during the multi-command join handshake. → Fail all pending
  deferreds in `onclose` so joins error fast and retry kicks in. [impact: med, effort: S]
- [ ] **ResumeConsumer failures computed then thrown away — listener stuck in silence with
  zero signal** (ws/mod.rs:1557-1617: success/error built, response block commented out;
  client fire-and-forgets): if `consumer.resume()` fails, the paused-created consumer never
  unpauses and neither side knows. → Re-enable the response (pairs with M3 type-mapping fix);
  client treats failure as full-re-join trigger. [impact: med, effort: S]
- [ ] **More lock/guard-across-await instances beyond M2** (lobby.rs:150-191 DashMap iter
  entry held across per-room RwLock reads; ws/mod.rs:2233-2259 room WRITE guard held across
  `transport.consume().await` — serializes all consumer creations during a join wave;
  ws/mod.rs:2159-2205 room read guard across an UN-TIMED `transport.connect().await`, unlike
  the domain method's 10s timeout): one wedged DTLS handshake can stall the room's writer
  queue and block every concurrent join. → Clone Arcs out of guards before awaiting; add the
  10s timeout to the inline connect. [impact: med, effort: M]

## Performance
- [ ] **Reconnect backoff has zero jitter → synchronized thundering herd after an AP blip**
  (WebSocketClient.ts:351): 80 phones retry in lockstep waves (1s, 2s, 4s…) hammering WS
  upgrade + rebind simultaneously. → ±50% random jitter on the computed delay (one line,
  disproportionate payoff). [impact: med, effort: S]
- [ ] **Command responses bypass the `send_ws` backpressure bound** (ws/mod.rs — all
  command replies use raw `sender.send(...)` e.g. :934,:1233,:1507,:1687,:1763, despite
  send_ws's own doc): a client that stops reading mid-command can wedge that connection's
  task, during which its heartbeat ticks can't fire. → Route every reply through `send_ws`,
  break on false. [impact: med, effort: S]
- [ ] **Per-message console logging at party scale** (WebSocketClient.ts:210-297 ~8
  console.info per inbound frame incl. every pong; similar density in UserService/
  MediaSoupClient): 80 phones × every frame × 3h = real CPU/battery + signal swamped.
  → Gate behind debug flag / strip console.info in prod Vite build (esbuild drop / leveled
  logger). [impact: med, effort: S]

## Battery
- [ ] **Double heartbeat stack wakes each phone's radio every ~7s all night**
  (server WS_PING_INTERVAL=10s to every socket + client 22s app-ping): liveness doesn't
  need this cadence — graces are 600/900s. → Server ping 20-25s + 60s pong deadline
  (detection ~1min, still fine), client app-ping 45-60s; consider visibility-aware cadence.
  [impact: med, effort: S]
- [ ] **`listenerCountUpdated` broadcast to every listener on every join/leave and no
  client code consumes it** (room.rs:122-127,234-239; zero frontend subscribers): arrival
  wave = O(N²) frames whose only effect is waking 80 radios. → Debounce/coalesce (2-5s)
  server-side; either display the count (see UX) or stop sending to listeners.
  [impact: med, effort: S]
- [ ] **A user-paused listener keeps receiving full-rate RTP** (AudioClient.ts:78-87
  pause only suspends AudioContext, RTP keeps flowing; backend `Listener::pause()` fully
  implemented but unwired): a paused phone burns ~160kbps radio + decode for hours.
  → Wire pauseConsumer/resumeConsumer to user-pause intent (server `consumer.pause()`
  keeps transport/ICE alive → resume is one RTT; anchor/focus mechanics untouched).
  [impact: med, effort: M]
- [ ] **Oscilloscope: 60fps rAF loop + its own third AudioContext per listener**
  (Oscilloscope.tsx:32,78,127): Android anchor mode = three live audio graphs + continuous
  canvas draws while screen on. → Throttle to ~15fps, reuse AudioClient's render context,
  and/or tap-to-enable. [impact: low, effort: S]

## UX
- [ ] **DJ (and listeners) have zero visibility of listener count/health** (DJRoom has no
  count anywhere; `DJ.event_tx` never written; ListenerCountUpdated goes to listeners only
  and their UI ignores it): the DJ can't tell if 5 or 50 people hear them. → New
  `DjEvent::ListenerCountUpdated` on the DJ socket + render count on both pages.
  [impact: med, effort: M]
- [ ] **Create-room button silently vanishes at >8 lobby rooms** (Landing.tsx:408):
  no message, no disabled state. → Disabled state + "room limit reached" copy, or lift the
  arbitrary limit. [impact: low, effort: S]
- [ ] **Lobby list not refetched after a lobby WS flap** (WebSocketClient.ts:419-422 clears
  the store on disconnect; REST refetch only on mount): after any blip the Landing page
  shows an empty list until manual reload. → Trigger `getRoomList()` from an on-reconnect
  hook (pairs with X4's proposed onReconnected callback). [impact: med, effort: S]

## Observability
- [ ] **No health endpoint** (main.rs:91-99): no cheap way for nginx/deploy scripts/a phone
  to confirm the backend is up on the headless Pi. → `GET /health` with version + worker +
  room count. [impact: med, effort: S]
- [ ] **Rich mediasoup stats implemented but unreachable** (dj.rs:492-499
  `get_producer_stats`, listener.rs:409-416 `get_consumer_stats` — dead code): mid-party
  "is RTP flowing to that phone?" requires log archaeology. → `GET /api/debug/rooms`
  dumping per-room DJ/producer state + listener entries (epoch, disconnected_at, consumer
  paused) + optional per-consumer stats. [impact: med, effort: M]
- [ ] **Info-level raw-frame logging churns the Pi's SD card for 3 hours**
  (ws/mod.rs:158-159,773-774 raw message content per frame; main.rs:40 plain fmt::init, no
  EnvFilter): 80 phones × heartbeats × join waves = flash writes all night + unreadable
  logs. → Demote raw-content to `trace`, default EnvFilter info/warn, per-frame logs behind
  `HUSHFM_WS_TRACE`. [impact: low, effort: S]
- [ ] **Phone-side failures unobservable after the fact** (no client log capture anywhere):
  every party post-mortem so far has been guesswork. → Small in-memory ring buffer of
  warn/error lines, POSTed to `POST /api/client-log` on pagehide/terminal errors, tagged
  with the device id — next post-mortem becomes data. [impact: med, effort: M]

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
