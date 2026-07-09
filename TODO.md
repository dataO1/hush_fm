
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
- [ ] **N1 audio-bot device unplug**: unplug the line-in mid-stream → listeners see PAUSED (not
  silent-but-live); replug → audio + UI auto-recover. No room close during the gap.
- [ ] **Android offline-WiFi FIELD test (HARD GATE — decision 2026-07-09)**: on ≥2 real Android
  models on the offline `hushfm` net — (a) join → the "no internet / stay connected?" prompt
  appears at most ONCE, tap yes → goes quiet; (b) lock/unlock the phone → NO re-prompt;
  (c) walk out of WiFi range and back (reassociate) → NO re-prompt, app still loads. This is the
  ONE unverified link in the offline-router chain (router side is lab-verified; the "sticky
  one-tap then quiet" Android behavior post-fix has never been confirmed on real hardware).
  Also confirm iOS stays fully silent. See docs/offline-router-connectivity.md §Decisions.
- [x] **Cert-expiry warning on the DJ page (build)** ✔️FIXED 2026-07-09 (party-fixes ea6180d3):
  `/health` gains `certDaysRemaining` (signed, negative when expired) + `certIsRealLE`
  (self-signed detection — days alone is misleading on the bootstrap cert), via a tested
  `lib::cert_status` (x509-parser, path from HUSHFM_TLS_CERT_PATH + fullchain fallback, both
  fields null + /health stays infallible on the group-nginx read gotcha). Shared
  `CertStatusBanner` on BOTH Landing + DJRoom: tiered hidden(>30d)/info(14-30)/warning(0-14)/
  critical(expired OR self-signed), UNKNOWN→warning, no shell command in copy, non-dismissable,
  fetched once. → STILL TODO (small): router-party-test.sh surfacing cert expiry as PASS/WARN
  offline; and the rpi4-nixos NixOS side — add the backend user to the acme/nginx group so it
  can actually READ the cert (else certDaysRemaining is always null → perpetual UNKNOWN warning).

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
- [x] **Setup-state rooms can leak forever; no idle sweeper** (#) ✔️FIXED 2026-07-09
  (party-fixes): added a periodic tokio sweeper (`HUSHFM_SWEEP_INTERVAL_SECS` def 60s) that
  closes non-public (Setup) rooms idle > `HUSHFM_SETUP_ROOM_IDLE_SECS` (def 10min) via the
  now-called `idle_duration()` + `close_room()`; EXPLICITLY skips public rooms AND the
  audio-bot room (dj_id == AUDIO_BOT_SESSION_ID) so a bot room sitting in Setup/Paused between
  sets is never swept.
- [ ] **WS `subscribe()` is last-writer-wins per event type** (WebSocketClient.ts:642-669):
  one handler per event type in a HashMap — a second subscriber to e.g. `roomClosed`
  silently replaces the first; works today only because subscriber sets are disjoint.
  → Store a Set of handlers per type; unsubscribe removes only its own. [impact: med, effort: S]
- [x] **RoomAdded vs RoomUpdated decided by 30s wall-clock heuristic** ✔️FIXED 2026-07-09
  (party-fixes, BACKEND part): the wall-clock `is_fresh_room` heuristic is replaced by a
  Lobby-tracked `was_public` state → `RoomAdded` fires EXACTLY on the false→true (became-public)
  transition, `RoomUpdated` otherwise; a DJ taking >30s to produce now correctly emits RoomAdded.
  (Frontend `updateRoom`-as-upsert half = X10, still open, lower priority now that the backend
  emits the correct event.)
- [x] **Graceful shutdown is dead code** ✔️FIXED 2026-07-09 (party-fixes): wired the existing
  `shutdown_signal()` into `axum::serve(...).with_graceful_shutdown(...)` so SIGTERM (Pi
  deploy/restart) drains cleanly instead of abruptly killing all sockets.
- [x] **Dead-code cluster in WS/domain layer** (#6) ✔️FIXED 2026-07-09 (party-fixes):
  deleted the confirmed-zero-caller wrappers — ws/mod.rs `handle_request_join` (grep: only
  its own definition; the LIVE listener-join path is `LobbyCommand::RequestJoin`) and
  room.rs `connect_dj`/`pause_streaming`/`resume_streaming` (grep: only their definitions;
  inline WS handlers own these flows). No imports went unused (`DtlsParameters` still used by
  `connect_listener`; `dj.pause`/`dj.resume` still called by the disconnect-grace paths).
  Separately (#6B) the inline listener-transport connect now has its own 10s timeout — see
  the connect-timeout fix below. Left in place (still referenced / out of this batch's scope):
  room.rs `stop_streaming`, listener.rs `pause`/`resume`.

## Edge cases
- [x] **Joining a paused room shows "live/playing" until next resume** (#9) ✔️FIXED 2026-07-08
  (DISPLAY-ONLY): `joinRoomAsListener` now reads `consumerParameters.producerPaused` after
  createConsumer → producerPaused ⇒ PAUSED + playing:false, else STREAMING + playing:true;
  Oscilloscope shows a centered ⏸ glyph + "{djName} paused" caption instead of a fake live
  waveform. DJ-resume recovery already works (step 8 audio unlock + step 9 unconditional
  ResumeConsumer untouched; the `streamResumed` broadcast flips the UI back to STREAMING).
- [x] **`streamResumed` handler lacks the guard `streamPaused` has** (UserService.ts
  ~:771-791): sets STREAMING unconditionally — a stray frame after teardown re-poisons
  `webrtcConnectionState` (the stale-flag class X3 fixed). → Same activeRole+isConnected
  guard. [impact: low, effort: S]
  FIXED (party-fixes 2026-07-09): streamResumed subscriber now only flips to STREAMING when
  `O.isSome(activeRole) && connectionAdapter.isConnected()` — same guard as streamPaused; a
  post-teardown stray frame is logged + ignored.
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
- [x] **Command responses bypass the `send_ws` backpressure bound** (#2) ✔️FIXED 2026-07-09
  (party-fixes): every DJ/listener/lobby COMMAND reply now goes through `send_ws` (the 10s
  `tokio::time::timeout` wrapper) instead of raw `sender.send(...)`. The three command
  handlers (`handle_dj_command`, `handle_listener_command`, `handle_lobby_command`) now return
  a liveness bool (`false` = send timed out/errored → sink may be mid-frame); each socket loop
  `break`s on `false`, arming the DJ-disconnect / listener-reap cleanup exactly like the
  event-delivery loop. A client that stops reading mid-command can no longer wedge its task for
  the TCP-retransmit tail. Two reply paths that built their message under a room read/write
  guard (listener GetRouterCapabilities, InitListener) now drop the guard before the bounded
  send so send_ws never holds a room lock. Handshake framing (initial room-list, Close frames,
  the pre-loop ListenerNotFound teardown) intentionally unchanged.
- [x] **Per-message console logging at party scale** ✔️FIXED 2026-07-09 (party-fixes):
  vite.config.ts now drops console.* + debugger in PRODUCTION builds only (esbuild.drop +
  terser drop_console gated on mode==='production'); dev logging intact. Bundle spot-check:
  our console strings gone from dist, sendBeacon/client-log survive. (Only vendor-mediasoup's
  own 3 debug-runtime console calls remain.)

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
- [x] **DJ (and listeners) have zero visibility of listener count** ✔️FIXED 2026-07-09
  (party-fixes, vertical slice 188077c4 + 9a4bf00c): found the DJ's `event_tx` was always
  None AND never drained — retyped it to `DjEvent`, created the DJ event channel in
  handle_room_socket, bound it per-(re)connect via handle_dj_connection, and added a
  drain arm forwarding through send_ws. New `DjEvent::ListenerCountUpdated {roomId,count}`
  emitted at add_listener + remove_listener (join/leave/reap); listeners still get the
  ListenerEvent. Frontend: `listenerCount` on the connection store/adapter (reset in
  resetRoom), a UserService.connect() subscription writing the count, and "🎧 N listening"
  rendered on BOTH DJRoom and ListenerRoom.
- [x] **Create-room button silently vanishes at >8 lobby rooms** (Landing.tsx:408):
  no message, no disabled state. → Disabled state + "room limit reached" copy, or lift the
  arbitrary limit. [impact: low, effort: S]
  FIXED (L2, party-fixes 2026-07-09): dropped the `<Show when={length<=8}>` wrapper; the "+"
  button is now ALWAYS rendered. Past MAX_LIVE_ROOMS (8) it renders disabled (btn-disabled +
  aria-disabled, title "Lobby full — too many live rooms") and tapping it surfaces a visible
  yellow banner ("Lobby full — too many live rooms") instead of silently doing nothing; the
  same banner covers the already-engaged case. Primary action never disappears.
- [x] **Lobby list not refetched after a lobby WS flap** (L3) ✔️FIXED 2026-07-09
  (party-fixes): Landing.tsx now runs a createEffect on `connectionAdapter.isLobbyConnected()`
  that refetches `getRoomList()` on every reconnect transition, guarded so the initial mount
  doesn't double-fetch. (Done Landing-only; WebSocketClient.ts unchanged.)

## Follow-ups from Wave 2a verifiers (low, 2026-07-09)
- [ ] **client-log: no global disk/size cap** (client_log.rs): per-device rate-limit guards a
  single spamming client, but a flood of DISTINCT device-ids could still grow the log dir +
  the limiter HashMap unbounded. Accepted for a local single-party Pi; add a global dir-size
  cap / oldest-file eviction + limiter TTL cleanup if it ever runs long-lived. [low]
- [ ] **`AUDIO_BOT_SESSION_ID` duplicated** (lobby.rs sweeper mirrors the const from
  audio_room.rs:21 — values currently match "audio-bot-session"): latent drift risk. → move to
  one shared const. [low]

## Observability
- [x] **No health endpoint** ✔️FIXED 2026-07-09 (party-fixes): added `GET /health` → 200 JSON
  with version (CARGO_PKG_VERSION) + worker count + room count, no auth, from AppState.
- [ ] **Rich mediasoup stats implemented but unreachable** (dj.rs:492-499
  `get_producer_stats`, listener.rs:409-416 `get_consumer_stats` — dead code): mid-party
  "is RTP flowing to that phone?" requires log archaeology. → `GET /api/debug/rooms`
  dumping per-room DJ/producer state + listener entries (epoch, disconnected_at, consumer
  paused) + optional per-consumer stats. [impact: med, effort: M]
- [~] **Info-level raw-frame logging churns the Pi's SD card for 3 hours** (#11-ws)
  (ws/mod.rs:158-159,773-774 raw message content per frame; main.rs:40 plain fmt::init, no
  EnvFilter): 80 phones × heartbeats × join waves = flash writes all night + unreadable
  logs. ✔️WS PORTION FIXED 2026-07-09 (party-fixes): both raw-content log pairs (DJ + listener
  receive loops) are now `tracing::trace!` AND gated behind a new `HUSHFM_WS_TRACE` env flag
  (read once via `OnceLock` in ws/mod.rs, independent of the EnvFilter so it can be flipped
  without touching main.rs; accepts 1/true/yes/on). Meaningful lifecycle logs stay at info.
  ✔️MAIN.RS PORTION ALSO FIXED 2026-07-09 (party-fixes): tracing EnvFilter default info/warn,
  RUST_LOG-overridable (replaces the plain fmt::init). #11 fully done.
- [~] **Phone-side failures unobservable after the fact** — BACKEND HALF ✔️FIXED 2026-07-09
  (party-fixes): `POST /api/client-log` endpoint added — writes one path-safe `<device-id>.jsonl`
  per entity (separate from the server log), per-device rolling-60s rate-limit
  (`HUSHFM_CLIENT_LOG_MAX_PER_MIN` def 30, over-cap dropped but still 204 so no client
  retry-storm), device-id sanitized against path traversal, best-effort via spawn_blocking.
  ✔️CLIENT HALF ALSO FIXED 2026-07-09 (party-fixes, d1af7d6e): new clientLog.ts hooks window
  'error' + 'unhandledrejection' (NOT a ring buffer — per-bad-event), sends via
  navigator.sendBeacon (fetch keepalive fallback), flushes on 'pagehide'; tagged with the X5
  device-id + route-derived role/roomId + UA; strictly best-effort (all try/caught, no retry,
  fails silent offline); wired once at bootstrap in App.tsx. #client-log FULLY DONE.
  (Follow-up: no global disk cap — see "Follow-ups from Wave 2a verifiers" above.)

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
- [x] **F2 (low) — #12 rejoin churn on a genuinely-paused room**: if a room's producer is
  paused, ResumeConsumer legitimately fails → #12 re-joins → resume fails again → one
  background re-join / 10s while the UI correctly shows PAUSED. Self-limited, no user-visible
  breakage. → Optional: gate the #12 `performFullRejoin` when local state is already PAUSED.
  [impact: low, effort: S]
  FIXED (party-fixes 2026-07-09): the resumeConsumer `commandFailed` handler now reads
  `connectionAdapter.getConnectionState().webrtcConnectionState` and returns early (skips
  performFullRejoin) when it is PAUSED — a failing ResumeConsumer is expected while paused.
  The genuine non-paused failure still forces a full re-join.

## UX/UI — usability bugs (frontend-only, no backend changes; fix-first)
- [x] **B1 — "DJ closed the room" shows as a scary RED error on the lobby** (UserService.ts
  ~:1058-1076 sets WebSocketError → Landing.tsx:348-362 red error-panel). Normal end-of-set
  reads as a failure. → route terminal `roomClosed` to a neutral/info banner variant + softer
  copy ("The set has ended — pick another room"). [impact: high, effort: S]
  FIXED (party-fixes 2026-07-09, decision 3a): enterTerminal no longer pushes a red
  WebSocketError into the connection store. onTerminal now carries `{kind, message}`;
  ListenerRoom renders a CALM in-room terminal card (neutral, not red) titled "The set has
  ended" with the DJ · room name and a single "Back to rooms" button.
- [x] **B2 — terminal→lobby nav can land the guest with NO explanation** (ListenerRoom.tsx
  ~:293 navigate('/'); depends on the connection error surviving the route change). → verify
  the banner renders post-nav; if not, show a brief in-room "The DJ ended the stream" card
  with a "Back to rooms" button before navigating. [impact: high, effort: S-M]
  FIXED (party-fixes 2026-07-09): terminal state is surfaced as an in-room card BEFORE any
  navigation (via a `terminalState` signal set by onTerminal). The guest always sees the
  explanation; the card's "Back to rooms" button is the only navigate('/'). listenerNotFound
  reuses the same card with "Your session expired" copy (kind:'error').
- [x] **B3 — raw WebRTC/exception text leaks to guests** (WebRTCErrorHandler.tsx:72-77 monospace
  `error.message`; ListenerRoom.tsx:351; DJRoom.tsx:294; Landing.tsx:383). Tags like
  `TransportError` shown to users. → suppress the raw monospace block for guests (friendly
  title+description only; gate detail behind a dev flag). [impact: high, effort: S]
  FIXED (DJRoom portion, party-fixes 2026-07-09): DJRoom.tsx:294 no longer renders
  `streamingOperation.error.message`; shows friendly "Couldn't start streaming — please try again"
  and logs the raw error via console.error for debugging.
  FIXED (listener portion, party-fixes 2026-07-09): WebRTCErrorHandler.tsx dropped the monospace
  `error.message` block (now console.error only); ListenerRoom.tsx join-error shows "Couldn't
  join — please try again" with the raw error logged to console.
  FIXED (Landing portion, party-fixes 2026-07-09): both `roomCreation.error` render sites in
  Landing.tsx (top banner + create modal) no longer print `roomCreation.error?.message`; they show
  "Couldn't create the room — please try again". No raw exception / WebRTC / tagged-error text
  reaches guests. WebRTCErrorHandler / ListenerRoom portions remain for their own batches.
- [x] **B4 — one concept, three words: DJ "MUTED" / listener "{djName} paused" / dot "PAUSED"**
  (ConnectionStatusGroup.tsx:35-43; Oscilloscope.tsx:207-209; ConnectionStatusDot). → unify on
  "Paused" everywhere the broadcast is paused (reserve "Muted" only for a true local mute).
  [impact: med, effort: S]
  DONE (party-fixes): DJ label MUTED→"Paused", dot MUTED/PAUSED→title-case "Paused"; oscilloscope
  "{djName} paused" caption kept (already attributed). Consistent title-case across all three.
- [x] **Oscilloscope false-clip — canvas edge now == true 0 dBFS, dropped 2.5×/0.4 gain; only
  touches edge on real clipping; throttled to 15fps** (Oscilloscope.tsx). New mapping:
  `y = height/2 - normalized*(height/2)` where `normalized=(dataArray[i]-128)/128` (±1.0 == 0 dBFS).
  Removed the 2.5× amplification and 0.4 factor so quiet music honestly looks smaller and the
  waveform reaches the edge ONLY on genuine clipping; the DJ no longer misreads normal levels as
  clipping. Draw loop throttled from ~60fps to ~15fps (66ms budget). AnalyserNode/AudioContext are
  created in-component and already torn down via onCleanup; reusing AudioClient's context is a
  follow-up (would need a cross-file edit, not owned here). [impact: high, effort: S]
- [x] **D2 — "Stop"/end-room has NO confirmation; sits next to "Mute", near-identical style**
  (StreamControls.tsx:56-64 → DJRoom.tsx:316 immediate closeDJRoom+navigate). One drunk tap
  kills the room for everyone. → client-side confirm ("End the room for everyone?") or
  hold-to-confirm; make Stop a distinct solid-red destructive style. [impact: high, effort: S]
  FIXED (party-fixes 2026-07-09): Stop now opens a client-side confirmation modal
  ("End the room for everyone?" → Cancel / End [destructive red]); endStream()/closeDJRoom() only
  fires on confirmed "End". Modal mirrors Landing.tsx createRoomModal (<dialog class="modal">,
  modal-box modal-glass, backdrop-tap to cancel) driven by a local SolidJS signal in
  StreamControls; no backend change. Stop restyled to distinct solid-red (see D3).

## UX/UI — flow improvements (frontend-only; curated relevant set)
- [x] **L1 — stuck "Connecting to lobby…" is a dead end** (Landing.tsx:426-431 infinite spinner,
  no timeout/retry). → 10s timeout → "Can't reach the lobby — tap to retry" + retry button.
  [impact: high, effort: M]
  FIXED (party-fixes 2026-07-09): client-side 10s timer (createSignal + setTimeout, armed onMount,
  cleared onCleanup) — if `connectionAdapter.isLobbyConnected()` is still false the spinner is
  swapped for "Can't reach the lobby — tap to retry" + a Retry button. Retry re-runs the same init
  the resource/onMount perform (`lobbyService.connectToLobby()` then `getRoomList()`) and re-arms
  the timer; no store changes.
- [x] **L4 — room cards give no "tap to join" affordance + own/active room only differ by a
  subtle dark tint** (RoomCard.tsx:55-91). → explicit trailing affordance per state ("▶ Join" /
  "You're DJ here — Resume" / "● Listening — Return") + text badge not just color. [impact: high, effort: S-M]
  FIXED (party-fixes 2026-07-09): each RoomCard now renders an explicit trailing TEXT affordance
  per state — default "▶ Join", own-DJ-room "You're DJ here — Resume", active-listen-room
  "● Listening — Return" — colour-coded (fg-2 / orange-bright / green-bright) but legible as text,
  so it survives the dark and is colourblind-safe (not colour-only).
- [x] **L5 — live vs paused room indistinguishable in the lobby** (RoomCard.tsx:64-69 dot only
  STREAMING vs CONNECTED; a paused room looks live → guests join to silence). → show a "Paused"
  badge when `room.isStreaming===false` on a public room (data already client-side); show the
  dot even at 0 listeners. [impact: med, effort: S]
  FIXED (party-fixes 2026-07-09): the status dot now renders for ANY public room (dropped the
  `listenerCount > 0` gate) so an empty-but-live room stays discoverable; the dot uses STREAMING
  vs PAUSED state, and a yellow "Paused" TEXT badge is shown next to the room name whenever a
  public room has `isStreaming === false`.
- [x] **L8 — "Enable Audio" modal is browser-policy jargon + blocks the content**
  (UserInteractionModal.tsx:66-73). → reframe to benefit: "Tap to hear the music" / "{djName}
  is live in {roomName}" / big "Start Listening" button; drop the browser-policy sentence.
  [impact: high, effort: S]
  FIXED (party-fixes 2026-07-09): title now "Tap to hear the music"; subtext "{djName} is live
  in {roomName}" (new `djName` prop, passed from ListenerRoom's navigationState.roomInfo); the
  browser-policy sentence is gone; button already reads "Start Listening".
- [x] **L9 — no plain "you're listening" confirmation** (ListenerRoom.tsx:382-415 only a
  waveform + "STREAMING" dot). → status line: "🎧 Listening live" / "⏸ {djName} paused" /
  "Connecting…" mapped from getWebrtcState(). [impact: high, effort: S]
  FIXED (party-fixes 2026-07-09): a plain listening-status line renders under the status dot,
  mapped from getWebrtcState(): STREAMING→"🎧 Listening live", PAUSED→"⏸ {djName} paused",
  else "… Connecting…".
- [x] **L10 — raw enum tokens shown to listeners** (ConnectionStatusGroup.tsx:44-48 "SETUP",
  falls through to enum string / "DISCONNECTED"). → listener-facing label map: SETUP→Connecting,
  STREAMING→Live, PAUSED→Paused, DISCONNECTED→Reconnecting…, ERROR→Connection lost.
  [impact: med, effort: S]
  DONE (party-fixes): ConnectionStatusGroup now maps every WebrtcConnectionState via a label map
  (CONNECTING/CONNECTED→Connecting, STREAMING→Live, PAUSED→Paused, DISCONNECTING/DISCONNECTED→
  "Reconnecting…", ERROR→"Connection lost"); no raw ALL-CAPS enum token can reach the UI. Labels
  read fine for the DJ too, so the shared component stays single-audience-safe.
- [x] **L11 — "Connecting…" identical for first-connect vs the #11 15s silent retry**
  (ListenerRoom.tsx:375-380). → after ~5s swap copy to "Still connecting — hang tight…" (client
  timer). [impact: med, effort: S]
  FIXED (party-fixes 2026-07-09): a tracked createEffect arms a 5s timer whenever the connecting
  state is entered (and clears/resets it on exit + onCleanup); after 5s the spinner copy swaps to
  "Still connecting — hang tight…" so a slow first-connect / #11 retry doesn't read as frozen.
- [x] **D3 — Mute and Stop look nearly identical** (StreamControls.tsx:29-33,57 both gray+red
  text). → Mute state-colored (green live / yellow muted), Stop distinct solid-red; more gap.
  [impact: med, effort: S]
  FIXED (party-fixes 2026-07-09): Mute is now solid-fill state-coloured — green (bg-gruvbox-green-
  bright, live/tap-to-mute) vs yellow (bg-gruvbox-yellow-bright, currently muted); Stop is solid-
  red (bg-gruvbox-red-bright) destructive fill. Row gap widened gap-3→gap-6 so a drunk thumb in
  the dark can't confuse the two.
- [x] **D4 — "Go Live" hidden until a device is selected, no prompt** (DJRoom.tsx:274 Show gated
  on selectedDeviceId). → always render Go Live, disabled, with "Select an audio source above".
  [impact: med, effort: S]
  FIXED (party-fixes 2026-07-09): Go-Live <Show> gate no longer requires selectedDeviceId(); the
  button always renders while not connected/connecting and is DISABLED (with helper text "Select an
  audio source above") until a source is chosen. Label already "Go Live".
- [x] **X2 — sub-44px tap targets** (Landing.tsx:411 create "+" at btn-sm; ✕ dismiss glyphs
  Landing.tsx:353 / ListenerRoom.tsx:352). → enforce 44×44 hit area on icon-only buttons.
  [impact: med, effort: S]
  FIXED (Landing portion, party-fixes 2026-07-09): create "+" button now carries
  `min-h-[44px] min-w-[44px]`; all three ✕ dismiss glyphs in Landing.tsx (connection-error,
  creation-error, room-creation-error banners) wrapped to a 44×44 flex hit area + aria-label
  "Dismiss error". ListenerRoom portion remains for its own batch.
- [x] **X4 — join has no loading state on the tapped card** (Landing.tsx:443-461 /
  handleRoomAction async, no visual change → double-tap risk). → track joining room id, spinner
  overlay + disable the tapped card until navigate. [impact: med, effort: S]
  FIXED (party-fixes 2026-07-09): new `joiningRoomId` signal set at the start of handleRoomAction
  and cleared in a finally; passed to RoomCard as `isJoining` (=== room.id). While joining the
  card shows a centred spinner overlay + dimmed/pointer-events-none, and handleRoomAction ignores
  repeat taps while any join is in flight — a drunk guest can't double-tap. On success the page
  navigates away (finally is a harmless post-unmount no-op); on failure the card re-enables.
- [x] **L6 — "1 listeners" grammar + count is the dimmest text** (RoomCard.tsx:86-88,
  text-gruvbox-fg-4). → pluralize + bump contrast + headphone glyph. [impact: low, effort: S]
  FIXED (party-fixes 2026-07-09): listener count now pluralises ("1 listener" / "N listeners"),
  contrast bumped fg-4 → fg-2, and a 🎧 glyph prefixes the count.
- [x] **Optional DJ-name field** (Landing.tsx:123 hardcodes djName="DJ" → every room's DJ shows
  as "DJ"; `announceRoom` already propagates djName client-side, so frontend-only). → add an
  optional "Your DJ name" field. [impact: med, effort: S]
  FIXED (party-fixes 2026-07-09): create-room modal gains an optional "Your DJ name" input;
  handleCreateRoom reads it into roomCreationData.djName and the roomCreation resource passes it
  through the existing `announceRoom(name, djName, …)` call (also used for `${djName}'s room`
  description). Empty → falls back to the "DJ" default. No backend change (djName already flows
  client-side).
> NOTE — these three UX-scan items are ALREADY listed above under Full-Flow §UX (don't duplicate):
> DJ listener-count visibility (=D1/#21), create-button-vanishes-at-8 (=L2), lobby-refetch-after-flap (=L3).
> Quick-win batch (all small-effort/high-impact, pure copy/state): B1, B3, B4, L8, L9, D2.

# Bugs
## Critical
- [x] ✔️FIXED **N1 — audio-bot line-in device unplug → whole floor silently dead, no signal, forever**
  (backend/src/lib/audio/audio_lifecycle.rs:455-468 `cleanup_audio_capture` + audio_room.rs:99-108;
  found by the 2026-07-09 backend validation scan). If the DJ's line-in is unplugged mid-set the
  encoder task dies → NO frames (not even silence) reach the DirectProducer, but `dj.is_paused`
  stays false and `producer.pause()` is never called → room stays Live/public, every listener
  keeps an unpaused consumer hearing dead silence, NO `StreamPaused` fires, no UI signal. And the
  bot room has no WS → no grace timer → it's never closed/reaped → the silent room persists until
  server restart. This is the PRIMARY physical failure mode of a silent-disco line-in rig.
  FIX (2026-07-09, decision 1a): `AudioLifecycleManager` now holds a `Lobby` handle; on entering
  `WaitingForDevice`/`DeviceError` (device lost — incl. the encoder-death path) it reaches the
  bot's room and pauses the DirectProducer + broadcasts `StreamPaused` + flips the room to Paused
  (new `Room::handle_audio_bot_device_loss`, mirrors `handle_dj_disconnect`); on device RETURN
  (capture resumes → `Running`) it resumes the producer + broadcasts `StreamResumed` + flips the
  room back to Live (`Room::handle_audio_bot_device_return`). Listeners see PAUSED (the #9/#12
  frontend already handles `StreamPaused`→PAUSED) instead of dead-silent-Live. Stays Paused
  INDEFINITELY if the device never returns (no grace-timer/close for the bot — a line-in rig
  between sets keeps its room; decision 1a). Transition-guarded (Live→Paused pauses once,
  Paused→Live resumes once) so flapping never spams `StreamPaused` or double-pauses. Lock
  discipline (M2): the room write guard is dropped before the lobby broadcast — no guard held
  across the `producer.pause()/resume().await` mediasoup call's lobby update. [impact: HIGH, effort: M]
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
