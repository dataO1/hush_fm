# Party Post-Mortem Fixes

Prioritized worklist from the 2026-07-02 research pass (four deep-research agents).
Work through top to bottom. Full reports with sources live in the session transcript;
distilled root causes below.

Status legend: `[ ]` open · `[~]` in progress · `[x]` done

---

## 0. STATUS SUMMARY — updated 2026-07-05

Authoritative current state (supersedes individual checkboxes below where they conflict):

**DONE & verified in code / on the Pi:**
- **§1 Android lock-screen** — SOLVED via the "anchor" approach (muted `srcObject` RTP
  pump + WebAudio render + audible looping `anchor.ogg` as the media-session-eligible
  sink) plus `navigator.mediaSession`. Verified on-device on Chromium AND Firefox;
  iOS already worked (regression-safe). `AudioClient.ts`, `frontend/public/anchor.ogg`.
- **§3 Offline router** — SOLVED. `scripts/router-party-setup.sh` (idempotent one-shot:
  dnsmasq hostname override + fakeinternet + auto-toggle watchdog + radio hardening).
  `fakeinternet-auto` auto-enables spoof when no uplink (no manual toggle). Verified
  8/8 party-mode + 4/4 home-mode via `scripts/router-party-test.sh`.
- **§4 Trusted HTTPS offline** — SOLVED. LE wildcard via DNS-01 (deSEC), real domain
  `hushfm.dedyn.io`, sops-encrypted token, router dnsmasq resolves to the Pi.
- **NEW — Pi audio-bot line-in path (Scarlett 18i20 → cpal → Opus → mediasoup):**
  now stable and clean. Fixed: device-monitor flapping, PipeWire removed from the
  capture path (direct ALSA), encoder keeps up under load (full-drain + 200ms ring
  headroom), and a cpal frames/samples buffer bug that doubled capture latency.
  Field-tested "definitely good enough" 2026-07-05. See §6.

**OPEN — top remaining party-critical item:**
- **§2 old-iPhone `esnext` crash — STILL OPEN.** `vite.config.ts` still targets
  `esnext` in all 3 places → iOS ≤14.4 crashes before mount. This is the #1 next fix.

**OPEN — optional / measure-first:**
- NetEQ receive-latency levers (§7, new) — researched 2026-07-05; not applied.
- Various non-party bugs in `TODO.md` (DJ reconnection, Go-Live-retry room reuse,
  Firefox oscilloscope).

---

## 1. Android: audio/connection lost on lock screen  ⟵ MOST PRESSING

**Symptom at party:** Android listeners lost audio and/or connection after the phone
sat on the lock screen for a while; it never recovered until manual rejoin.

**Diagnosed causes (✅ VALIDATED in code 2026-07-02 — all confirmed, plus extras below):**
- Remote stream plays via a detached `new Audio()` never attached to the DOM
  (`frontend/src/services/infrastructure/AudioClient.ts`) and there is **no
  `navigator.mediaSession` usage** → Chrome/Android does not classify the tab as
  media playback → tab suspended shortly after lock.
- **No WebSocket heartbeat** → socket dies silently on screen-off.
- Recovery broken: reconnect capped at 5 attempts (~31 s) then gives up forever;
  reconnect only reopens the socket, never re-runs the listener join flow;
  no `restartIce`; no `visibilitychange`/`pageshow`/`online` handlers;
  consumer-recreate hook exists but is never registered (dead code).

**Validation extras (found during code review, beyond the research report):**
- The consumer-recreate mechanism is *doubly* dead: besides `setConsumerRecreateCallback`
  never being called, the `newproducer` observer event it hangs on
  (`MediaSoupClient.ts:519`) only fires when *this* transport creates a producer —
  a recv-only listener transport never does, so the event can never fire. Replace
  with a server-sent "producer available" WS event or delete.
- `UserService.ts:451`: `joinRoomAsListener` short-circuits when
  `connectionAdapter.isRoomConnected()` is true — after a WS reconnect with stale
  connection state, even a manual re-join can no-op. Re-join path must reset/bypass
  this check.
- `WebSocketClient.ts:631-635` already logs a warning that after auto-reconnect
  "no event callbacks registered. Service may need to re-subscribe" — the gap was
  half-known.
- Join is a one-shot `createResource` on ListenerRoom mount (`ListenerRoom.tsx:128`);
  nothing can ever re-trigger it without a full page reload.
- Reconnect backoff uses `Effect.sleep` timers → stretched further by background
  timer throttling, so the ~31 s budget is even smaller in practice.

**Fix plan (impact order):**
- [ ] P1: attach audio element to DOM + wire `navigator.mediaSession`
      (metadata, `playbackState='playing'`, play/pause handlers → lock-screen controls)
- [ ] R1: `visibilitychange`/`pageshow`/`online` → immediate heartbeat, reconnect,
      full re-join if socket/transport dead
- [ ] R2: remove 5-attempt reconnect cap (capped backoff, retry indefinitely while
      in room); successful reconnect must re-run `joinRoomAsListener`
- [ ] P2: app-level WS ping/pong every ~20-25 s; missed pong → force close+reconnect
      (small backend change: answer pings)
- [ ] R3: `transport.restartIce()` on `connectionstatechange === 'disconnected'`
      (backend: expose `webRtcTransport.restartIce()` over WS); register or delete
      the dead consumer-recreate hook
- [ ] R4: gate the 30 s connect/command timeouts on page visibility
      (background timer throttling causes spurious failures)
- [ ] Optional P3: screen Wake Lock while ListenerRoom visible (foreground-only aid)

**Backend reality check (2026-07-02 deep dive — GOOD news, less backend work than assumed):**
- Backend already sends WS protocol-level `Ping` frames every 25 s
  (`api/ws/mod.rs:566-596`) and handles `Pong`. Browsers answer these invisibly —
  the *client* cannot observe them — so the only backend gap for P2 is a tiny
  app-level `ping` ListenerCommand answered with a `pong` event.
- **Listener reconnection is already designed in**: the listener WS URL
  `/ws/listener/{roomId}/{sessionId}` is deterministic; `handle_listener_connection`
  (`domain/room.rs:498`) treats a known sessionId as reconnection (rebinds event
  channel, cancels cleanup timer); `get_receiver_transport` (`domain/listener.rs:72`)
  explicitly destroys the old transport and creates a fresh one "for reconnection
  scenarios"; `RequestConsumer` recreates the consumer. **Full client re-join over
  the same URL works end-to-end today with zero backend changes.**
- `stale_listener_timeout` defaults to 0 = listener entries are never reaped, so
  reconnects work for the life of the room.
- Gap: an unknown sessionId on the listener WS is rejected by silently closing the
  socket (`api/ws/mod.rs:553`) — no error event. Client re-join must detect this
  and fall back to the lobby `requestJoin` flow (or backend should send a
  `commandFailed`/`listenerNotFound` event first — small nice-to-have).
- restartIce (R3) is likely unnecessary for v1: since the backend recreates
  transports on re-join anyway, full re-join covers transport death. Keep R3 as
  optional optimization.
- `config.ts` already switches to https/wss + proxied ports for non-localhost
  hostnames — frontend config is HTTPS-ready.

**Notes:** Media Session + Wake Lock need a secure context → depends on item 4 (HTTPS).
The silent-audio keepalive hack is dead on modern Chrome — do not implement.
NB: old TODO.md claimed background/lock-screen playback "runs perfectly" — party
disproved this; only the missing lock-screen media indicator part is still accurate.

## 2. Old iPhones: page loads, stream never connects

**Diagnosed cause (✅ VALIDATED 2026-07-02, with corrections):** `vite.config.ts`
sets `target: 'esnext'` at lines 30/35/57. Verified against the exact resolved
packages: effect 3.19.12 ships a `#value` private class field in
`dist/esm/Utils.js:279` (class `YieldWrap` — backs `Effect.gen`, used everywhere,
guaranteed in the bundle) plus `??=` logical assignment and public static class
fields. **Corrections vs research report:** mediasoup-client 3.18.3 contains NO
`#` syntax (agent overstated that); no private methods/static blocks anywhere →
the true parse floor is **iOS 14.5** (private fields, Safari 14.1), not iOS 15.
So iPhones on iOS ≤ 14.4 crash before mount (stuck on index.html spinner).
⚠ If a failing party iPhone was actually on iOS ≥ 14.5, its cause was something
else (likely in-app QR browser) — worth confirming one affected device.

- [ ] Set build target to **`['esnext', 'safari12']`** in all three places in
      `vite.config.ts` (researched 2026-07-02: browser-target-only avoids the
      needless double-lowering an ES-year constraint causes; ~+4-9% gzipped;
      covers the iOS 12.2 hard floor = maximum possible range; effect confirmed
      free of Promise.allSettled/WeakRef so no polyfills/plugin-legacy needed);
      verify emitted `dist/**/*.js` has no `#`-private syntax AND no regexp
      lookbehind `(?<=`/`(?<!` (esbuild passes lookbehind through silently)
- [ ] Catch mediasoup `UnsupportedError` (`Device.load()`) → clear "browser
      unsupported" UI instead of silent spinner; consider Safari12 handler fallback
- [ ] In-app browser detection (Instagram/WhatsApp/QR-scanner WKWebView) →
      "Open in Safari" prompt on the listener path
- [ ] Decide + document minimum supported iOS (hard floor iOS 12.2 / Unified Plan;
      pragmatic target iOS 14.5); test on a real old device

## 3. Offline router: newer phones fight the no-internet WiFi

**Cause:** OS connectivity checks. iOS probes `http://captive.apple.com/hotspot-detect.html`
(spoofable → fully fixable). Android also probes `https://www.google.com/generate_204`
which is **unspoofable** → Android 10+ never reaches "validated", shows
"stay connected?" prompt, moves default route + DNS to LTE (breaks local hostname),
may drop the SSID (Adaptive Connectivity / avoid-bad-WiFi).

- [ ] Install stangri's `fakeinternet` package on the Flint 2 (dnsmasq hijack +
      uhttpd CGI answering 204 / "Success" for all check domains); do NOT hijack
      `www.google.com`
- [ ] Verify GL.iNet firmware doesn't override the dnsmasq config / own port 80
      (GL UI + AdGuard layer); test that config survives a GL-UI save
- [ ] Guest signage + join-screen text: **turn off mobile data** (or airplane mode
      + WiFi); Android: tap "stay connected", disable "switch to mobile data
      automatically"; open the site by hostname, not IP
- [ ] Test matrix before next party: old Android (≤9), Android 13+ Pixel/Samsung,
      iOS 17+, one iOS 26 device

## 4. Trusted HTTPS on the offline network

**Decision from research:** real domain + Let's Encrypt **wildcard cert via DNS-01**
issued/renewed at home before each event; router dnsmasq resolves the domain to the
LAN server. Zero guest interaction, real padlock, secure context. Self-signed / own
CA rejected (iOS two-step trust + profile install impossible from captive-portal
browser; Android permanent "monitored" warning). OCSP retired Aug 2025 → offline
validation is a non-issue. Cert expiry offline = hard fail → renewal before each
event is non-negotiable.

- [ ] Buy/choose domain at a registrar with acme.sh-supported DNS API
- [ ] On Flint 2: `opkg install acme-acmesh acme-acmesh-dnsapi luci-app-acme`;
      configure DNS-01 wildcard issuance (`*.hush.<domain>` + apex)
- [ ] dnsmasq override: `address=/hush.<domain>/<server-LAN-IP>` (+ `rebind_domain`
      whitelist if GL firmware blocks local answers)
- [ ] Serve app over HTTPS with the real cert (terminate on LAN server or router);
      redirect 80→443; WSS for the WebSocket
- [ ] Pre-event checklist item: renew cert (90-day expiry), verify validity window
      covers the event
- [ ] Signage note for the rare pinned-Private-DNS/DoH guest (set Private DNS to
      Off/Automatic)

**Interactions:** HTTPS is a prerequisite for #1 (Media Session / Wake Lock secure
context) and for the DJ's `getUserMedia`; the dnsmasq override must be more specific
than #3's catch-all so the app domain never gets hijacked.

---

## 5. Other device pitfalls (2nd research pass, 2026-07-02) — ranked

**5a. ~~iOS Safari suspends WebRTC on lock screen~~ — REFUTED BY PARTY REALITY
(user, 2026-07-02): iPhones kept playing on the lock screen at the actual party;
this was an Android-only problem.** The research claim likely applies to
getUserMedia/AudioContext pipelines, not this recv-only `<audio>` setup. The
working iOS behavior is now a REGRESSION CONSTRAINT: every §1 change must be
additive/conditional. Wake Lock + "keep screen on" UX rejected (music apps
don't do this — SoundCloud web works via exactly the DOM-audio + Media Session
mechanism §1 adds).

**5b. No audio-interruption / route-change handling.** Incoming calls, WhatsApp
voice messages, alarms pause the audio element and it never auto-resumes;
Bluetooth headphone disconnect re-routes the stream to the phone's LOUDSPEAKER
(sound in a silent disco).
- [ ] Listen for audio-element `pause`/`ended` + `devicechange`; auto-resume or
      show "audio paused — tap to resume"; consider auto-mute on unexpected route
      change (folds into §1 work)

**5c. `playoutDelayHint = 0` (`MediaSoupClient.ts:751-770`) — OPTIONAL VERY LAST
RESORT ONLY (user decision 2026-07-02: latency is king, do NOT touch stream
performance).** Research flagged zero jitter buffer as an underrun risk on
crowded RF; only revisit IF choppy audio is actually observed at an event, and
then floor at ~0.15 s as an experiment. Not part of any current plan.

**5d. Broaden §2's browser detection into a general capability check.** Opera
Mini/UC (proxy browsers, no WebRTC), Brave strict shields (strips
RTCPeerConnection methods), ancient WebViews — a handful per 100 guests.
- [ ] On missing `RTCPeerConnection` or failed `Device.load()` → "please open in
      Chrome/Safari" screen

**5e. WiFi airtime is the 100-guest ceiling, not bandwidth.** ~10 Mbps aggregate is
trivial, but real-time guidance is ~20-25 clients/radio; WMM power-save interop
bugs can drop RTP to sleeping phones.
- [ ] Router config pass: force 5 GHz steering, disable legacy 11b rates, test
      WMM-PS on/off; consider a 2nd AP above ~50 guests; load-test before a big party

**5f. Signage additions:** disable Always-on/full-tunnel VPN (blocks LAN server).

**Must-test on device (unresolved by research):** iPhone ringer-switch OFF with the
WebRTC `<audio>` element (HTML5 audio should play through silent mode, but the
srcObject/WebRTC case is undocumented — high stakes since guests silence phones at
parties); Flint 2 under ~100 concurrent RTP streams; Samsung Internet "Background
Play" toggle with WebRTC.

**Refuted (do NOT build):** cross-listener sync drift correction (each guest hears
only their own headphones; BT latency dominates and is unfixable from the browser);
desktop autoplay handling (existing UserInteractionModal covers it); opusDtx is
already correctly false for music; mDNS candidate obfuscation (server is ICE-lite).

---

## 6. Pi audio-bot line-in path + latency (NEW — worked 2026-07-05)

The DJ rig feeds XLR → Scarlett 18i20 (USB) → Pi; the Rust server captures via cpal
and produces the Opus stream directly (DirectProducer), no browser DJ. Getting this
clean took three stacked fixes, all DONE + deployed + verified:

- [x] **Device-monitor flapping** — false "disconnect" during active capture; fixed
      with name-enumeration debounce (3-poll threshold), no open-probe while running.
- [x] **PipeWire removed from the capture path** — its ALSA layer sat between the
      Scarlett and cpal, async-resampling → rate drift (~89k vs 96k) → ring overruns
      → choppy. `services.pipewire/pulseaudio.enable = false` on the Pi; cpal opens
      the Scarlett directly via ALSA (still gets 48k/2ch).
- [x] **Encoder keeps up under load** — consumer now drains the full backlog each
      wake; ring buffer 4800→19200 (200ms headroom, runs near-empty ~12ms measured).
- [x] **cpal buffer unit bug** — `BufferSize::Fixed`/`Range` are in FRAMES, not
      samples (verified cpal 0.17 source); code passed frames×2 → 2048-frame ALSA
      period (42.7ms). Fixed → 1024-frame period (21.3ms). Halved capture latency.

**Deployed on the Pi: 1024-frame capture buffer (commit 2e5f776f).** A further
1024→512 tune (~11ms period, commit 47039398) is committed but NOT deployed — deploy
it if you want ~10ms more (env-var only, revert to 1024 if the diagnostic shows
xruns/POLLERR).

Tooling: `scripts/deploy-pi.sh` (one-shot push+build+rebuild+restart+verify),
`scripts/diagnose-party.sh` (offline diagnostic log: network path, capture device,
period_size, flap count, overruns, `fill:%/ms` metric, CPU/thermal, router WiFi).

- [ ] Optional bulletproofing: current path assumes 48kHz + ≥2ch (Scarlett + most DJ
      gear OK). A `rubato` resampler + channel-adapt stage would make it work with
      ANY interface (44.1k-only / mono). Deferred — not needed for the party rig.
- [ ] Optional: startup guard that logs a clear error on a non-48k/non-stereo device.

## 7. NetEQ receive-jitter-buffer latency (RESEARCHED 2026-07-05, not applied)

Full 3-agent research in the session transcript + memory. Core finding: the browser
NetEQ buffer (~100ms, biggest remaining latency) is big because it **adapts to real
WiFi jitter** — `playoutDelayHint=0` is already set, so the JS knob is near-maxed on
Chrome/Android. The real lever is **reducing on-air jitter** (mainly phone WiFi
power-save bursts) so NetEQ voluntarily shrinks. Structural floor is ~40-80ms (20ms
ptime + decode + OS buffer), so the realistic win is ~100 → ~50-80ms, not zero.

Rejected: NetEQ bypass (WebCodecs/AudioWorklet) — modest gain AND re-breaks the §1
Android lock-screen fix (AudioWorklet is media-session-ineligible). FEC/RED don't
shrink the buffer (only make a small buffer safe under loss). Already on UDP
(enable_udp + prefer_udp true; TCP is an unused fallback candidate).

Ranked levers (impact/risk), all UNAPPLIED — decide before implementing:
- [ ] Verify WMM + U-APSD on / DTIM=1 on the router (biggest, low risk — kills
      power-save burst jitter).
- [ ] Add `jitterBufferTarget = 40` (ms, small non-zero — 0 stutters) alongside the
      existing `playoutDelayHint` at `MediaSoupClient.ts:721`; extends the lever to
      Firefox, inert on iOS. Low risk.
- [ ] `enableTcp = false` (configuration.nix) — defensive; removes any TCP-select risk.
- [ ] A/B ptime 20→40ms (`HUSHFM_OPUS_FRAME_DURATION`) — halves on-air packet rate
      but +20ms fixed; net win only if NetEQ shrinks more. MUST field-measure.
- [ ] DSCP→AC_VI (nftables on Pi) — near-zero benefit on a dedicated audio LAN;
      user's stance is "leave DSCP as-is". Skip unless page-load/reconnect chatter.
- [ ] 2nd AP / band-split — biggest physical jitter cut for 40-100 phones.
Verify any change on-device via `getStats()` `jitterBufferDelay/jitterBufferEmittedCount`.

---

## Suggested execution order

1. **§2 build-target fix** (5 lines, unblocks old iPhones) — TOP remaining party item.
2. §1/§3/§4 — DONE (see §0 status).
3. §6 audio-bot path — DONE; optional 512 deploy + resampler bulletproofing remain.
4. §7 NetEQ latency levers — optional, measure-first; setup is "good enough" as-is.
