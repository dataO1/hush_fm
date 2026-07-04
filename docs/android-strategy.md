# Android Strategy — web fix, app fallback, Snapcast safety net

Research 2026-07-04 (three parallel deep-research agents) after round-2
device test failed (anchor fix produced no media notification; audio still
dies ~1–2 min after lock on Ecosia/Chrome/Brave). Priority order set by
user: (1) make the current web solution work on Android, (2) Android-only
app against the existing backend (iOS stays on web), (3) Snapcast hybrid.
Custom UDP protocol ruled out.

---

## Track 1 — Web fix (prio 1): what we now know, how to debug, the last lever

### Why the anchor failed (evidence)

- Chrome **deliberately declines to expose srcObject-backed media sessions
  to system UI**. The Chrome media engineer (steimelchrome) said so in
  w3c/mediasession#261; the Chromium bug (crbug 1181214) is **WontFix**;
  the API he named as the proper fix (`navigator.audioSession`) ships
  **only in Safari** — dead on Chrome Android.
- **One media session per tab**, bound to the "topmost controllable"
  player. Field evidence (AlexxIT/WebRTC#578): a WebRTC element **even
  when muted still claims Android audio focus**. Our *unmuted* srcObject
  element very plausibly wins the tab's arbitration while being
  focus-ineligible → Chrome exposes nothing → no notification — exactly
  the observed symptom. The anchor pattern has **no field confirmation of
  ever producing Android lock-screen controls for a WebRTC tab** (its
  confirmations are desktop media-key retention).
- **Potential OS hard veto: Android 17 background-audio hardening**
  (fails `requestAudioFocus()` for backgrounded apps; docs explicitly say
  MediaSession/focus do NOT exempt). If the test phone runs Android 17 /
  equivalent One UI, **no web fix can work** → skip to Track 2.

### The one untried web lever (medium confidence)

**Make the anchor the only audible media element:**
1. `streamElem.muted = true` — kept in DOM as the RTP "pump" (Chrome needs
   a playing sink element for WebRTC audio to flow — TwoSeven writeup).
2. Actual sound via WebAudio: `ctx.createMediaStreamSource(stream)
   .connect(ctx.destination)`.
3. anchor.ogg stays unmuted at volume 1.0 → should become the bound,
   exposed session (finite duration, file-backed, audible).

Caveats: the muted pump may *still* participate in focus (AlexxIT#578);
AudioContext output survival under lock is unverified. This experiment
settles the web path.

### Debug protocol (real device required; emulator not faithful)

Prep: USB debugging on the phone; `adb` on the laptop; test in **stock
Chrome** (Brave remote-inspect is broken, Ecosia unknown). For forks: serve
**eruda** on-page console behind `?debug=1` (also sidesteps our terser
`drop_console`). Add `Cache-Control: no-cache` to index.html (currently
ETag-only) and confirm in DevTools → Network the phone loads the current
bundle.

- **Step 0 — OS veto + stale bundle**: `adb shell getprop
  ro.build.version.release`. If Android 17: `adb shell cmd audio
  set-enable-hardening disable`, retest; if audio then survives → OS is
  the cause, web path dead. Check bundle name in Network tab.
- **Step 1 — anchor playing?** chrome://inspect console:
  `[...document.querySelectorAll('audio')].map(a=>({src:a.currentSrc,paused:a.paused,t:a.currentTime,muted:a.muted}))`
  — re-read after 3 s. Paused/stuck → play() rejected (activation/ordering
  bug) → fix ordering.
- **Step 2 — focus requested?** `adb shell dumpsys audio` → is
  com.android.chrome in the Audio Focus stack with AUDIOFOCUS_GAIN?
  No → shadowing confirmed → apply the mute+WebAudio lever.
- **Step 3 — session exposed?** `adb shell dumpsys media_session` +
  chrome://media-internals → which player holds the session. Session
  exists but no UI → Chrome declining exposure → same lever.
- **Step 4 — notification exists but audio still dies?** → OS suspension;
  `dumpsys deviceidle force-idle` to confirm → web platform exhausted →
  Track 2.

## Track 2 — Android-only app (fallback A): Kotlin + crow-misia/libmediasoup-android

iOS stays on the working web app → **Flutter's one-codebase advantage
evaporates**; decision tilts to the most mature mediasoup lib + cleanest
native audio = **Kotlin**.

- **Client lib**: `crow-misia/libmediasoup-android` (Maven Central,
  NDK-compiled official libmediasoupclient, bundles libwebrtc; repo pushed
  2026-07; last feature release 2025-05 — fine against our pinned
  mediasoup 0.20). Dead: Blancduman flutter port, haiyangwu android.
  Live Flutter alternative if overruled on language:
  `mediasfu_mediasoup_client` (young, active 2026-06).
- **Zero backend changes** — our Axum WS protocol + mediasoup v3 +
  announced-IP/ICE-lite/UDP-40000-49999 serve standard clients as-is.
- **THE landmine**: libwebrtc Android defaults audio out to
  `USAGE_VOICE_COMMUNICATION`/`CONTENT_TYPE_SPEECH` (= phone call:
  earpiece routing, AEC/NS mangling music, NO media focus/notification —
  the native mirror of our web bug). Must set
  `JavaAudioDeviceModule.Builder.setAudioAttributes(USAGE_MEDIA,
  CONTENT_TYPE_MUSIC)` + hardware AEC/NS off + never
  `MODE_IN_COMMUNICATION`. Do this in the week-1 spike.
- **Background audio (structural)**: foreground service
  `mediaPlayback` + MediaSession + AUDIOFOCUS_GAIN → survives lock +
  Doze by design; Samsung "sleeping apps" prompt for
  battery-optimization exemption. Native jitter knob: low
  `jitterBufferTarget` (audio ramps slowly — measure).
- **Distribution**: (a) **Play internal-testing track** — instant, no
  review, ≤100 testers, no unknown-sources/Play-Protect friction; create
  the Play account ($25) NOW, it's the calendar path. (b) **APK sideload
  from the LAN site** (hushfm.dedyn.io/hushfm.apk): viable — self-signed
  v2+v3 fine, Play Protect only soft-warns offline ("install anyway") —
  but 3–4 scary taps; good walk-in fallback, not the primary channel.
  (Developer-verification requirement lands 2026-09 in four pilot
  countries, global 2027 — not a blocker for a July German party.)
- **Plan**: Week 1 = spike: WS-join → Device.load → createWebRtcTransport
  → DTLS connect → consume → audio out, with correct audio attributes
  (go/no-go by mid-week; no sample app in the repo — read
  mediasoup-broadcaster-demo C++ for the flow). Week 2 = FGS + QR join
  (CameraX/ML Kit) + room list + reconnect matrix + internal track upload.

## Track 3 — Snapcast hybrid (fallback B)

- **Dual-feed is easy and ours**: tee raw PCM inside
  `backend/src/lib/audio/audio_capture.rs` (cpal callback) → snapserver
  named pipe (`pipe:///run/snapserver/djfeed?sampleformat=48000:16:2`),
  parallel to the existing Opus/mediasoup path. NixOS:
  `services.snapserver` one block (declare in rpi4-nixos).
- **The hard limit: buffer floor is HARDCODED 400 ms** (requests below are
  silently raised); field-reliable party-WiFi values 500–1000 ms. iOS web
  cohort sits at ~150–300 ms → **cohorts cannot be aligned downward**;
  only lever = delaying the iOS path up. Inter-cohort skew 100–700 ms:
  headphones mean no acoustic clash, only visual dance skew — no prior
  art; would need a two-phone field test.
- **Snapdroid as-is**: active (v0.29.0.2), GPLv3, proper mediaPlayback
  FGS + wake lock → structurally survives lock. Gap: NO deep-link/QR —
  onboarding = mDNS autodiscovery (verify multicast passes the Flint 2
  SSID!) or manual IP. Fork for branding/QR ≈ 3–5 days of Android
  toolchain. Rust `snapcast-client` crate exists for a thin custom client
  (re-opens the FGS work — only if branding is a hard requirement).
- **Pi 4: not the bottleneck** (encode once, fan out N TCP writes). WiFi
  radio is; second AP above ~40 guests (unchanged).

## Track 1b — THE missing web answer: WebSocket → MSE fallback (research 2026-07-04 late)

"How do streaming services do it?" — answered, and it vindicates the user's
skepticism. **No service delivers WebRTC to passive web listeners.**
SoundCloud/Spotify/YouTube(-Live)/Twitch web all play through an
HTMLMediaElement fed by src or **MSE** (HLS/DASH) — a real media timeline →
full audio focus → notification → lock survival. The load-bearing prior
art is **X Spaces**: WebRTC/SFU for interactive speakers (app only), but
**web listeners get HLS** off Periscope infra. The industry answer to
"WebRTC that must survive a locked browser" is exactly a **playback-path
split**.

**Proposed: keep WebRTC for iOS (works, ~150-300 ms); serve Android web
listeners the same Opus audio over WebSocket → MediaSource Extensions.**
- `audio/webm; codecs=opus` in MSE: supported on Chrome Android (Opus
  required in WebM since Chrome 33; `audio/mp4; codecs=opus` since 70).
  Runtime-gate with `MediaSource.isTypeSupported(...)`.
- MSE live audio = ordinary media playback = the SAME path YouTube
  Live/Twitch use, which demonstrably shows the notification and survives
  lock. Highest-confidence web option we have (validate once on-device:
  it's inference-plus-empirics, no spec line says it verbatim).
- Latency: realistic **0.5–2 s** (small WebM clusters, chunked SourceBuffer
  appends in sequence mode, playbackRate catch-up loop to the live edge).
  Worse than WebRTC's ~150-300 ms — acceptable for listeners? (DJ monitors
  off the mixer; inter-cohort skew vs iOS ~0.5-1.5 s — same product
  question as Snapcast but much smaller.)
- Server effort (Rust, modest): tap the Opus frames we already produce in
  backend/src/lib/audio/, mux WebM clusters (`webm` crate) or fMP4
  (`muxide`), broadcast over an Axum WS route; reuse the room model.
- WebCodecs/AudioWorklet: DEAD END for lock survival (Web Audio output is
  explicitly excluded from media notifications). Firefox-Android rescue:
  evidence leans no; not a solution.

If the anchor-v2 (mute+WebAudio) test fails, **this is the next web move,
ahead of the native app** — it keeps zero-install for Android.

### Track 1c — Encoded-Transform loopback (research 2026-07-04 night):
### the <300 ms client-only path

User rejected 0.5–2 s. Grounded follow-up research (latency table below)
found a better lever, newly possible: **`RTCRtpScriptTransform` reached
Chrome Android in v149 (Baseline Oct 2025)**. The receive-side tap sits
**after the depacketizer/reorder, BEFORE the decoder/NetEq jitter buffer**
— we get clean, ordered, already-encoded Opus frames at 20 ms cadence and
skip NetEq's ~150–300 ms playout delay entirely.

**Design (client-only, zero server change, zero re-encode):**
1. Keep the recv-only WebRTC transport; in ontrack:
   `receiver.transform = new RTCRtpScriptTransform(worker, ...)`.
2. Worker: read ordered RTCEncodedAudioFrames, tiny (1–2 frame) slack
   buffer, mux each as a WebM SimpleBlock (webm-muxer/Mediabunny with live
   timestamp override, or mse-audio-wrapper `codec:'opus'` with min
   segmentation thresholds); postMessage transferable chunks.
3. Main thread: MediaSource → SourceBuffer('audio/webm;codecs=opus'),
   'sequence' mode, duration=Infinity; append FROM the worker onmessage
   (event-driven, never setInterval — timers get throttled; audible tabs +
   WebRTC are exempt from intensive throttling but don't tempt fate).
   Live-edge governor: if buffered.end − currentTime > ~250 ms, nudge
   playbackRate 1.02–1.05.
4. The audible sink = this MSE `<audio>` element — real timeline →
   media-session eligible → notification + lock survival (YouTube-Live
   class). Media Session metadata/handlers on it. Anchor becomes redundant.
5. **Highest-value unknown (test first on device): does the receive
   pipeline keep delivering frames to the transform with NO srcObject
   element attached?** If yes → zero WebRTC-backed elements in the tab,
   MSE element owns the session unambiguously. If no → muted pump element
   returns, with its focus-shadowing risk (AlexxIT#578).
- Packet loss: no NetEq PLC — a lost frame ≈ 20 ms glitch in sequence
  mode (optionally synthesize Opus PLC/silence frames).
- Support gate: Chrome Android 149+ (legacy createEncodedStreams reaches
  further back); runtime-detect, fall back to anchor v2 / WS-MSE.

### Grounded latency table (research, LAN)

| Path | E2E floor | Client-only | Confidence |
|---|---|---|---|
| **Encoded-transform → mux → MSE** | **~150–350 ms** | ✅ | works: mod-high; latency: component-sum estimate, no field data — we'd be first |
| WS→MSE server push (20 ms clusters) | ~300–600 ms (200–300 unproven; Flashphoner's 1–3 s incl. video+transcode) | ❌ | moderate |
| MediaRecorder loopback → MSE | ~500 ms–1 s (re-encodes DECODED track → stacks NetEq + timeslice ≥100 ms + MSE) | ✅ | works: mod-high |
| Chunked-HTTP `<audio src>` (icecast-style) | ~0.5–1.5 s (field reports 1.5–30 s, mostly source misconfig) | ❌ (trivial client) | eligibility: high |

The original "0.5–2 s" was an internet-live-streaming synthesis, NOT a LAN
measurement — but sub-300 ms via server-push MSE remains unproven; the
encoded-transform loopback is the only structurally-<300 ms option.

## Track 2 addendum — APK distribution reality (research 2026-07-04 late)

- **CORRECTION to native-rewrite-research.md:** Play **open testing IS
  gated** behind production access (= the 12-tester/14-day closed test) for
  new personal accounts. Only **internal testing** (≤100 email-listed
  testers) is instant. Check account type: org accounts / pre-2023-11
  personal accounts escape the gate entirely.
- **Internal testing = prepare-at-home only**: guest's install needs
  internet + their email pre-added — impossible at the offline venue.
- **Sideload at the venue works on stock Android** (~8-10 taps, 2 scary
  screens: one-time unknown-sources + Play Protect offline soft-warning
  with "install anyway"). **Samsung One UI 6.1.1+ (mid-2024+) is the real
  blocker**: Auto Blocker hard-refuses all sideloads by default; guest must
  disable it in Settings beforehand. Non-Samsung success estimate with a
  good instruction page: ~80-90%; recent-Samsung at the venue: ~0 without
  prep.
- Serve APK with `Content-Type: application/vnd.android.package-archive` +
  `Content-Disposition: attachment` (else Chrome saves it as .zip and the
  flow dies). Uploading the same APK to a Play track does NOT reliably
  suppress offline Play Protect warnings — don't count on it.
- Developer-verification (Sept 2026) hits BR/ID/SG/TH only; Germany 2027+
  — not a blocker this year.
- **Two-QR funnel**: home QR ("prepare for the party": internal-testing
  opt-in or APK download + Samsung Auto Blocker instructions) + venue QR
  (LAN install page, offline sideload steps, web-player fallback footer).
  Install-page tone modeled on NewPipe/F-Droid ("this warning is expected,
  tap X"). F-Droid repo/Obtainium: rejected for normal guests.

## Recommended sequence

1. **Today/day 1 (non-code, calendar-critical): create the Google Play
   developer account** and generate a stable release signing key — needed
   in every world where Track 2 ships.
2. **Track 1 debug session (~30 min with the phone + USB)**: Step 0–4
   decision tree. Deploy first: index.html no-cache, `?debug=1` eruda,
   and the **mute-srcObject + WebAudio + anchor lever** (small AudioClient
   change) so the retest tests the best web configuration we have.
3. **Decision gate**: web lever works → done, harden + test matrix.
   Fails at Step 2/3/4 → **start the Kotlin spike immediately** (Track 2,
   go/no-go by mid-week 1); the web app remains iOS + walk-in fallback.
4. **Snapcast stays the safety net** (a weekend to stand up server-side;
   Snapdroid as-is + manual IP if everything else burns).
