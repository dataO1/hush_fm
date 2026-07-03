# Party Post-Mortem Fixes

Prioritized worklist from the 2026-07-02 research pass (four deep-research agents).
Work through top to bottom. Full reports with sources live in the session transcript;
distilled root causes below.

Status legend: `[ ]` open · `[~]` in progress · `[x]` done

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

## Suggested execution order

1. §2 build-target fix (5 lines, unblocks old iPhones)
2. §4 domain + cert + dnsmasq (prerequisite for §1)
3. §1 Android lock-screen work (largest chunk, frontend + small backend additions)
4. §3 router `fakeinternet` + signage (independent, can run anytime)
