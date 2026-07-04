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
