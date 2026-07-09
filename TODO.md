
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
- [ ] **DJ re-publish → listeners recover (ProducerChanged)**: DJ live with N listeners
  hearing audio → DJ reloads/reconnects and re-goes-live (or: DJ back to lobby → rejoin →
  reconnect) → within a few seconds every listener's audio resumes automatically (forced
  re-join to the new producer), no manual reload needed, no permanent silence.
- [ ] **#9 join-while-paused UI**: join a room while the DJ is paused (manual pause OR the
  15-min disconnect grace) → the listener sees PAUSED UI + a "{djName} paused" ⏸ glyph in the
  oscilloscope, NOT a fake "live" waveform; when the DJ resumes → audio + UI recover
  automatically (no manual action needed on the listener side).
- [ ] **#11 join-drop fast-fail → retry → lobby**: drop WiFi mid-join (freeze / go offline
  during the join handshake) → NO 30s frozen "Connecting…" spinner; the client silently
  retries under the spinner for up to 15s once the socket is back; if it still can't recover
  → bounced to the lobby with an explanatory error banner ("Lost connection while joining …").
- [ ] **#11 follow-up (LOW, verifier flag)**: a genuinely-dead room that manifests as an
  abrupt socket close (instead of an app-level `roomClosed`/`listenerNotFound` reply) will
  flush ConnectionDroppedError → burn the full 15s retry → bounce with the generic
  WiFi-drop message (cause misattribution + 15s stall). Common dead-room paths are app-level
  and correctly surfaced, so this is a corner. Optional hardening: backend sends a terminal
  "room gone" reply on the pending command before closing, or a fast-path distinguishes
  "socket closed with zero reconnect progress" from a transient blip. [impact: low, effort: M]
- [ ] **#12 resume-failure recovery**: (hard to force naturally) if a listener's ResumeConsumer
  fails server-side, the client should auto full-re-join and recover audio rather than sit silent;
  primarily verify NO regression to the normal join (audio still starts on every normal join).
- [ ] **#3 Go-Live rename**: start a room, crash/abandon mid-setup (before it goes live), then
  create a NEW room with a DIFFERENT name → you stream under the NEW name (old half-setup room
  is scrapped), no stale name. And: a live/paused room + reconnect keeps its original name and
  its listeners.

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
- [x] **DJ re-publish orphans all existing listeners** ✔️FIXED 2026-07-08: on producer
  REPLACE, `Room::create_producer` now broadcasts a new `ProducerChanged {roomId,producerId}`
  ListenerEvent (events.rs); the listener recovery coordinator subscribes and calls
  performFullRejoin() DIRECTLY — bypassing the transportDead matrix, which would NO-OP since
  the transport stays ICE/DTLS-connected → cleanup + force re-join to the new producer.
  Reuses the single-flight + 10s throttle. (This was the precise mechanism behind the old "DJ
  reconnect should renew listener transport/consumer" TODO.)
- [~] **DJ reload is a dead end** — WON'T FIX (user decision 2026-07-08): not crucial. A
  reloaded DJ is routed to the lobby, sees their still-live room (server holds it in the
  15-min grace), rejoins → back in DJ view → reconnects; the re-publish then triggers the
  ProducerChanged fix above so listeners recover. sessionStorage-persist approach was
  conceptually fine but unnecessary.
- [ ] **ProducerChanged follow-up — thundering herd on DJ reload** (verifier flag, med): on a
  DJ reload with N listeners, all N run a full handshake (~4 WS round-trips + transport/
  consumer creation) within ~1-2s → real load spike on the Pi at 50+ listeners. Deferred
  (surgical per-listener re-consume was the alternative). → Add jitter to the re-join, or
  do surgical re-consume, if room sizes grow. [impact: med, effort: M]
- [ ] **ProducerChanged follow-up — narrow double-republish stranding window** (verifier flag,
  low): if a DJ produces A then B within ~10s and B lands after the first re-join's consumer
  request resolves, the 2nd producerChanged is dropped by the 10s throttle → listener stuck
  consuming the dead A (evaluate() won't catch it — transport stays alive). → Re-arm a single
  deferred re-join when a producerChanged is dropped by the throttle. [impact: low, effort: S]
- [x] **Announce-reuse returns stale room metadata** (ws/mod.rs:363-402) — ✔️FIXED: the
  known Go-Live-retry bug is resolved via a server-authoritative `is_public()` split in the
  reuse branch — a no-producer (Setup) room is scrapped (`lobby.close_room`) and recreated
  fresh with the new name/description/tags; a live/paused room is reused unchanged (never
  renamed under a live audience). [impact: med, effort: S]
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
- [x] **Joining a paused room shows "live/playing" until next resume** (#9) ✔️FIXED 2026-07-08
  (DISPLAY-ONLY): `joinRoomAsListener` now reads `consumerParameters.producerPaused` after
  createConsumer → producerPaused ⇒ PAUSED + playing:false, else STREAMING + playing:true;
  Oscilloscope shows a centered ⏸ glyph + "{djName} paused" caption instead of a fake live
  waveform. DJ-resume recovery already works (step 8 audio unlock + step 9 unconditional
  ResumeConsumer untouched; the `streamResumed` broadcast flips the UI back to STREAMING).
- [ ] **`streamResumed` handler lacks the guard `streamPaused` has** (UserService.ts
  ~:771-791): sets STREAMING unconditionally — a stray frame after teardown re-poisons
  `webrtcConnectionState` (the stale-flag class X3 fixed). → Same activeRole+isConnected
  guard. [impact: low, effort: S]
- [x] **In-flight commands not failed on socket drop → 30s frozen spinner on a
  mid-handshake WiFi blip** (#11) ✔️FIXED 2026-07-08: `onclose` now flushes every pending
  deferred with a new retriable `ConnectionDroppedError` on NON-deliberate closes (gated on
  `shouldReconnect`; deliberate `disconnect()` keeps its own WebSocketError flush) — a
  recovery reconnect orphans in-flight replies too, so we flush on all non-deliberate closes.
  The ListenerRoom join wrapper retries the whole connect+join under the spinner ONLY on
  `ConnectionDroppedError` via `Schedule.spaced(1s)` capped by `Schedule.upTo(15s)`; on budget
  exhaustion it navigates to the lobby and sets the lobby error banner via
  `lobbyAdapter.setCreationError(...)`. No 30s hang. [impact: med, effort: S]
- [x] **ResumeConsumer failures computed then thrown away — listener stuck in silence with
  zero signal** (ws/mod.rs:1557-1617: success/error built, response block commented out;
  client fire-and-forgets): if `consumer.resume()` fails, the paused-created consumer never
  unpauses and neither side knows. → Re-enable the response (pairs with M3 type-mapping fix);
  client treats failure as full-re-join trigger. [impact: med, effort: S]
  FIXED (#12): lock-across-await fixed via clone-then-drop (clone the `Arc<Consumer>` under the
  room read-guard + DashMap entry guard, then drop BOTH before `consumer.resume().await`);
  `ListenerEvent::CommandFailed { command: "resumeConsumer", .. }` now sent on failure ONLY
  (no success event — client fire-and-forgets success); client's `startListenerRecovery`
  subscribes to `commandFailed`, filters to `resumeConsumer`, and re-joins via the existing
  throttled single-flight `performFullRejoin()` on failure.
- [ ] **More lock/guard-across-await instances beyond M2** (lobby.rs:150-191 DashMap iter
  entry held across per-room RwLock reads; ws/mod.rs:2233-2259 room WRITE guard held across
  `transport.consume().await` — serializes all consumer creations during a join wave;
  ws/mod.rs:2159-2205 room read guard across an UN-TIMED `transport.connect().await`, unlike
  the domain method's 10s timeout): one wedged DTLS handshake can stall the room's writer
  queue and block every concurrent join. → Clone Arcs out of guards before awaiting; add the
  10s timeout to the inline connect. [impact: med, effort: M]

## Performance
- [~] **Reconnect backoff has zero jitter** — DROPPED as NON-ISSUE (grilled 2026-07-08).
  Real-world impact negligible: clients detect a drop at naturally-staggered times (TCP/WS
  close detection + OS WiFi state + reassociation), so `detection + delay` is already spread
  without jitter; WiFi MAC-layer (CSMA/CA) adds more; and the actual bottleneck is the
  single-threaded mediasoup worker which SERIALIZES consumer creation regardless of arrival
  spread — jitter barely touches the real limiter. Party scale (60-80) is trivial for
  Axum/tokio. Not worth the change.
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
- [~] **Double heartbeat stack wakes each phone's radio every ~7s** — DROPPED as NON-ISSUE
  (grilled 2026-07-08). A listener playing audio is already receiving a continuous ~50 pkt/s
  Opus RTP stream — the radio is fully awake for that, and the ~0.1 Hz heartbeat is <0.3% of
  packet volume (rounding error against the audio). When the phone is locked the client 22s
  ping doesn't even fire (background timers frozen). Battery is dominated by RTP reception +
  decode + screen, not the ping. The server ping's real job (pong-deadline reap) is worth
  keeping as-is. (Note: the "paused listener still pulls RTP" item below was ALSO dropped —
  see it; the RTP-during-lock-screen-pause is a deliberate design choice, not waste.)
- [ ] **`listenerCountUpdated` broadcast to every listener on every join/leave and no
  client code consumes it** (room.rs:122-127,234-239; zero frontend subscribers): arrival
  wave = O(N²) frames whose only effect is waking 80 radios. → Debounce/coalesce (2-5s)
  server-side; either display the count (see UX) or stop sending to listeners.
  [impact: med, effort: S]
- [~] **A user-paused listener keeps receiving full-rate RTP** — DROPPED as NON-ISSUE
  (grilled 2026-07-08). (1) Listeners cannot pause in-app — the listener page has only
  Leave / navigate-to-lobby / Enable-Audio; they listen or leave. (2) The ONLY pause path
  is the lock-screen Media Session control, and its handler (AudioClient.ts:76-87)
  DELIBERATELY keeps the muted RTP pump playing — explicit comment: "the muted pump element
  must KEEP PLAYING or RTP stops flowing and resume would need a re-join". So RTP-during-
  lock-screen-pause is not waste; it's the deliberate price for instant resume + Android
  audio-focus survival. Pausing the consumer server-side would REGRESS the hard-won
  lock-screen resume behavior. There is no hours-long "paused but consuming" state to fix.
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

# Validation + UX Scan (2026-07-09)
> Three read-only scans at the final state (party-fixes @4356d330): frontend recovery-machinery
> interaction, backend lifecycle/edge-cases, and a frontend UX/UI design pass. Verdict below.

## Validation verdict — SOUND except one show-stopper
- **Recovery machinery composes SAFELY** (confirmed, not assumed): the 4 reconnect/re-join
  triggers are temporally disjoint — #11's ListenerRoom retry owns the initial-join window,
  the 3 `performFullRejoin` triggers (evaluate/producerChanged/resumeFailed) share ONE
  single-flight+10s throttle and own the post-join window (coordinator starts only after the
  join resolves). No concurrent double-join / duplicate consumer / racing cleanup.
- **Backend: no crash-class defect introduced** by the 20 commits — no new lock-across-await,
  no panic-on-None, no use-after-free, no worker-slot leak; `close_room` idempotent;
  grace-timer × #3-scrap × reaper all mutually exclusive under the room write lock.
- **The ONE real show-stopper = N1** (audio-bot silent-room on device unplug) — see Bugs/Critical.
- Low, leave-as-is: F1 = double-DJ-reload-in-10s → ~10s stale (== the ProducerChanged
  double-republish follow-up already listed under Full-Flow Architecture). F2 (below). N2/N3/N4
  backend (latent/narrow, overlap existing lock-across-await + RoomAdded/Updated items).
- [ ] **F2 (low) — #12 rejoin churn on a genuinely-paused room**: if a room's producer is
  paused, ResumeConsumer legitimately fails → #12 re-joins → resume fails again → one
  background re-join / 10s while the UI correctly shows PAUSED. Self-limited, no user-visible
  breakage. → Optional: gate the #12 `performFullRejoin` when local state is already PAUSED.
  [impact: low, effort: S]

## UX/UI — usability bugs (frontend-only, no backend changes; fix-first)
- [ ] **B1 — "DJ closed the room" shows as a scary RED error on the lobby** (UserService.ts
  ~:1058-1076 sets WebSocketError → Landing.tsx:348-362 red error-panel). Normal end-of-set
  reads as a failure. → route terminal `roomClosed` to a neutral/info banner variant + softer
  copy ("The set has ended — pick another room"). [impact: high, effort: S]
- [ ] **B2 — terminal→lobby nav can land the guest with NO explanation** (ListenerRoom.tsx
  ~:293 navigate('/'); depends on the connection error surviving the route change). → verify
  the banner renders post-nav; if not, show a brief in-room "The DJ ended the stream" card
  with a "Back to rooms" button before navigating. [impact: high, effort: S-M]
- [ ] **B3 — raw WebRTC/exception text leaks to guests** (WebRTCErrorHandler.tsx:72-77 monospace
  `error.message`; ListenerRoom.tsx:351; DJRoom.tsx:294; Landing.tsx:383). Tags like
  `TransportError` shown to users. → suppress the raw monospace block for guests (friendly
  title+description only; gate detail behind a dev flag). [impact: high, effort: S]
- [ ] **B4 — one concept, three words: DJ "MUTED" / listener "{djName} paused" / dot "PAUSED"**
  (ConnectionStatusGroup.tsx:35-43; Oscilloscope.tsx:207-209; ConnectionStatusDot). → unify on
  "Paused" everywhere the broadcast is paused (reserve "Muted" only for a true local mute).
  [impact: med, effort: S]
- [ ] **D2 — "Stop"/end-room has NO confirmation; sits next to "Mute", near-identical style**
  (StreamControls.tsx:56-64 → DJRoom.tsx:316 immediate closeDJRoom+navigate). One drunk tap
  kills the room for everyone. → client-side confirm ("End the room for everyone?") or
  hold-to-confirm; make Stop a distinct solid-red destructive style. [impact: high, effort: S]

## UX/UI — flow improvements (frontend-only; curated relevant set)
- [ ] **L1 — stuck "Connecting to lobby…" is a dead end** (Landing.tsx:426-431 infinite spinner,
  no timeout/retry). → 10s timeout → "Can't reach the lobby — tap to retry" + retry button.
  [impact: high, effort: M]
- [ ] **L4 — room cards give no "tap to join" affordance + own/active room only differ by a
  subtle dark tint** (RoomCard.tsx:55-91). → explicit trailing affordance per state ("▶ Join" /
  "You're DJ here — Resume" / "● Listening — Return") + text badge not just color. [impact: high, effort: S-M]
- [ ] **L5 — live vs paused room indistinguishable in the lobby** (RoomCard.tsx:64-69 dot only
  STREAMING vs CONNECTED; a paused room looks live → guests join to silence). → show a "Paused"
  badge when `room.isStreaming===false` on a public room (data already client-side); show the
  dot even at 0 listeners. [impact: med, effort: S]
- [ ] **L8 — "Enable Audio" modal is browser-policy jargon + blocks the content**
  (UserInteractionModal.tsx:66-73). → reframe to benefit: "Tap to hear the music" / "{djName}
  is live in {roomName}" / big "Start Listening" button; drop the browser-policy sentence.
  [impact: high, effort: S]
- [ ] **L9 — no plain "you're listening" confirmation** (ListenerRoom.tsx:382-415 only a
  waveform + "STREAMING" dot). → status line: "🎧 Listening live" / "⏸ {djName} paused" /
  "Connecting…" mapped from getWebrtcState(). [impact: high, effort: S]
- [ ] **L10 — raw enum tokens shown to listeners** (ConnectionStatusGroup.tsx:44-48 "SETUP",
  falls through to enum string / "DISCONNECTED"). → listener-facing label map: SETUP→Connecting,
  STREAMING→Live, PAUSED→Paused, DISCONNECTED→Reconnecting…, ERROR→Connection lost.
  [impact: med, effort: S]
- [ ] **L11 — "Connecting…" identical for first-connect vs the #11 15s silent retry**
  (ListenerRoom.tsx:375-380). → after ~5s swap copy to "Still connecting — hang tight…" (client
  timer). [impact: med, effort: S]
- [ ] **D3 — Mute and Stop look nearly identical** (StreamControls.tsx:29-33,57 both gray+red
  text). → Mute state-colored (green live / yellow muted), Stop distinct solid-red; more gap.
  [impact: med, effort: S]
- [ ] **D4 — "Go Live" hidden until a device is selected, no prompt** (DJRoom.tsx:274 Show gated
  on selectedDeviceId). → always render Go Live, disabled, with "Select an audio source above".
  [impact: med, effort: S]
- [ ] **X2 — sub-44px tap targets** (Landing.tsx:411 create "+" at btn-sm; ✕ dismiss glyphs
  Landing.tsx:353 / ListenerRoom.tsx:352). → enforce 44×44 hit area on icon-only buttons.
  [impact: med, effort: S]
- [ ] **X4 — join has no loading state on the tapped card** (Landing.tsx:443-461 /
  handleRoomAction async, no visual change → double-tap risk). → track joining room id, spinner
  overlay + disable the tapped card until navigate. [impact: med, effort: S]
- [ ] **L6 — "1 listeners" grammar + count is the dimmest text** (RoomCard.tsx:86-88,
  text-gruvbox-fg-4). → pluralize + bump contrast + headphone glyph. [impact: low, effort: S]
- [ ] **Optional DJ-name field** (Landing.tsx:123 hardcodes djName="DJ" → every room's DJ shows
  as "DJ"; `announceRoom` already propagates djName client-side, so frontend-only). → add an
  optional "Your DJ name" field. [impact: med, effort: S]
> NOTE — these three UX-scan items are ALREADY listed above under Full-Flow §UX (don't duplicate):
> DJ listener-count visibility (=D1/#21), create-button-vanishes-at-8 (=L2), lobby-refetch-after-flap (=L3).
> Quick-win batch (all small-effort/high-impact, pure copy/state): B1, B3, B4, L8, L9, D2.

# Bugs
## Critical
- [ ] **N1 — audio-bot line-in device unplug → whole floor silently dead, no signal, forever**
  (backend/src/lib/audio/audio_lifecycle.rs:455-468 `cleanup_audio_capture` + audio_room.rs:99-108;
  found by the 2026-07-09 backend validation scan). If the DJ's line-in is unplugged mid-set the
  encoder task dies → NO frames (not even silence) reach the DirectProducer, but `dj.is_paused`
  stays false and `producer.pause()` is never called → room stays Live/public, every listener
  keeps an unpaused consumer hearing dead silence, NO `StreamPaused` fires, no UI signal. And the
  bot room has no WS → no grace timer → it's never closed/reaped → the silent room persists until
  server restart. This is the PRIMARY physical failure mode of a silent-disco line-in rig.
  → On entering `WaitingForDevice`/`DeviceError`: `producer.pause()` on the DirectProducer +
  broadcast `StreamPaused` to the bot room's listeners; `resume()` + resume-broadcast when a
  device returns. [impact: HIGH (party UX show-stopper), effort: M] — fix before the next party.
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
- [x] ✔️FIXED DJ "Go Live" retry after a failure REUSES the previously announced room
  (old name/id) instead of announcing a new room with the newly entered name —
  user typed "lkalkja", ended up streaming as the earlier room
  "hahhahahahhahah" (2026-07-03). Fix: server-authoritative `is_public()` split in the
  AnnounceRoom reuse branch — scrap-and-recreate the no-producer (Setup) room with the
  fresh metadata; reuse a live/paused room unchanged.
- [ ] waveform oscilloscope only works on chrome based browsers but not for
  firefox based browsers! research why.
- [ ] on mobile the stream is running perfectly in the background, also in
  locked screen etc, but make sure we show a mediaplayer status or something
  that indicates that we are playing music on the lockscreen !.
- [x] ✔️FIXED (X7 + ProducerChanged, 2026-07-08) if the dj diconnects, the status is
  updated for listeners (DJ WS close → producer pause + `StreamPaused` broadcast → listeners
  show PAUSED); and DJ reconnect/re-publish renews the listener side via event: on producer
  REPLACE the backend broadcasts `ProducerChanged{roomId,producerId}` → listeners force a
  full re-join (new transport+consumer). Grace timer keeps the room alive during the gap.
- [~] PARTIAL (2026-07-08) handle producer disconnection via events — listeners now react
  via WS events (`StreamPaused` on DJ disconnect → PAUSED; `ProducerChanged` on re-publish →
  re-consume; `RoomClosed` terminal). We deliberately consolidated "djDisconnected" INTO the
  PAUSED state rather than adding a distinct connection-state + a client-side mediasoup
  producer-close handler. If a distinct "DJ disconnected (reconnecting)" affordance is wanted
  vs plain "Paused", that's a small remaining UX item (see UX scan B4/L10 vocabulary).
- [x] ✔️FIXED (2026-07-08) play/pause now set connectionstate: `streamPaused`→PAUSED,
  `streamResumed`→STREAMING subscribers, and #9 join-while-paused sets PAUSED on join.
  (Residual low item tracked above: `streamResumed` handler lacks the activeRole guard.)
## Whatever
- [ ] remote connection works for udp! but somehow my chromium browser on
  wayland linux fails to create matching local ice candidate for udp!
- [x] play/pause events are either not sent out by the backend or handled in the frontend! muting does not work.

# Architecture/Functionality
## Critical
- [x] ✔️DONE (2026-07-08) How to properly handle dj disconnection while streaming — the
  capability now exists: server keeps room state during the 15-min DJ-disconnect grace
  (room Paused, epoch guard); the DJ reconnects with the SAME session_id (`handle_dj_connection`
  cancels the timer + resumes); re-publishing a producer broadcasts `ProducerChanged` so every
  listener renews. NOTE: listeners' consumers are REBUILT (forced re-join), not literally kept
  attached to the new producer — the user-visible outcome (audio resumes for all after DJ
  reconnect) is achieved; a true keep-consumers-attached-swap-producer is a possible future
  optimization (relates to the deferred "surgical per-listener re-consume" follow-up).
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
