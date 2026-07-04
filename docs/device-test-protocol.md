# Device Test Protocol — listener lock-screen fix

Test matrix from the listener-lockscreen-fix plan (card 9). DJ on laptop
(Firefox, works), listeners on real phones over LAN + HTTPS
(hushfm.dedyn.io → Pi).

## Round 1 — 2026-07-04

Devices: iPhone 11 (Safari), Android (Samsung, model unconfirmed — possibly
Galaxy A5, browser: **Ecosia**, a Chromium fork).

| # | Check | iPhone 11 / Safari | Android / Ecosia |
|---|-------|--------------------|------------------|
| a | Locked 10+ min keeps playing, lock-screen controls | — | ❌ FAIL: no lock-screen controls at all; audio stops ~1 min after lock. Reproduced identically in **Ecosia, stock Chrome, and Brave** → generic Chromium gap confirmed, not a fork quirk. Firefox not yet installed/tested. |
| b | iPhone regression: locked 10+ min plays exactly as before | ✅ PASS (controls shown, long-term stable) | — |
| unlock behavior | | | Stream resumes INSTANTLY on unlock (WebRTC transport + consumer stayed alive; pure audio-output suspension) |

Checks c–i (call interruption, headphone replug, WiFi toggle, DJ
pause/resume, ringer switch, padlock, latency) not yet executed — blocked on
resolving (a).

### Diagnosis (research 2026-07-04)

Client code verified correct and deployed (bundle `index-CJvIPydA.js`
contains Media Session setup; flake.lock pin `eedbf79d` includes all fixes).
The failure is a **known Chromium-on-Android platform gap**, not an
implementation bug:

- Chromium only grants **"full" audio focus** (= persistent media
  notification + background-playback exemption) to media elements whose
  duration is ≥ ~5 s. A WebRTC `srcObject` MediaStream reports
  `duration = NaN/Infinity` and is not wired into the media-session/
  audio-focus path → **no notification, no exemption** → Android suspends
  audio output ~60 s after lock. Transport is untouched → instant resume on
  unlock. (w3c/mediasession#261; crbug 41452188, 41132724;
  webrtc.org 41480843; web.dev/articles/media-session)
- Firefox for Android uses Gecko's own media-control service and is
  reportedly NOT affected.
- iOS/Safari treats recv-only `<audio>` as ordinary media playback → works
  (confirmed).
- Ecosia adds an independent unknown: Chromium forks can lack the
  media-notification UI wiring entirely or ship aggressive battery savers.

### Disambiguation result (2026-07-04, same day)

Stock **Chrome** and **Brave** reproduce the exact same symptoms (no
controls, ~60 s death, instant resume on unlock) → the failure is the
**generic Chromium `srcObject`/full-audio-focus gap**, not an Ecosia quirk.
Any code fix must therefore attack the Chromium gap itself (candidates 1/2/3
below). Remaining optional check: **Firefox for Android** (not yet
installed) — expected to survive via Gecko's media-control path; would
validate the fallback guidance but is not required for the fix.

### Fix implemented (2026-07-04): anchor-audio element

Research round 2 (Chromium source + field reports) established:
- Chromium's audibility silence threshold is **-72.25 dBFS**
  (`services/audio/output_stream.cc` `kSilenceThresholdDBFS`), measured
  AFTER `element.volume` is applied → the level must be baked into the
  file and played at `volume = 1.0`. Silent-below-threshold for >100 ms
  → stream classified silent; -60 dBFS noise stays audible; -72+ fails.
- Full audio focus (media notification + background exemption) requires
  duration ≥ ~5 s; `setPositionState` alone CANNOT grant it (kills fix
  candidate 1 as standalone).
- No production web service ships a fix (Whereby: "keep screen on";
  Discord/X/Meet/Zoom → native app with foreground service); no open-source
  SDK (LiveKit/Jitsi/Millicast) contains one. The anchor pattern is the
  canonical community workaround (w3c/mediasession#261) — plausible,
  unproven in production, confidence ~70%, must be device-tested.

Implementation (frontend, commit on `party-fixes`):
- `frontend/public/anchor.ogg` — 20 s brown-noise loop, Opus 24k, mono,
  **-46.4 dBFS RMS** (26 dB above the silence floor, inaudible under
  music), 50 KB.
- `AudioClient.ts`: `needsAnchorAudio()` gate = `Android` + `Chrome/` UA
  (covers Chrome/Brave/Ecosia/Samsung Internet; iOS and Firefox excluded —
  zero change on iOS). DOM-attached looping anchor starts BEFORE the
  stream element (same gesture), survives re-joins, torn down only on full
  stopStream. Media Session: `setPositionState({duration: Infinity})`
  (anchor path only, try/catch); lock-screen play/pause handlers drive the
  stream element while the anchor KEEPS PLAYING on pause (pausing it would
  drop focus and let Android suspend the tab ~60 s later). OS-interruption
  auto-resume restarts the anchor first.

### Round 2 — RESULT (2026-07-04): ❌ FAIL

Android still shows NO media notification / lock-screen controls, and audio
still stops ~1–2 min after lock (instant resume on unlock unchanged). The
anchor fix as deployed did not produce the expected notification. Not yet
known WHICH layer failed (anchor never played / played but no focus / focus
but notification suppressed by the unmuted srcObject player / notification
suppressed by OEM). On-device debugging required — see round-3 debug
protocol (research in progress 2026-07-04 evening). Leading untested
hypothesis: two-player shadowing — the unmuted srcObject element may win
the tab's media-session routing while being focus-ineligible, suppressing
the anchor; candidate fix = mute the stream element, route its audio via
WebAudio (createMediaStreamSource → destination), anchor stays the only
audible media element. Decision: pursue web fix (prio 1) with proper adb
debugging; fallback A = Android-only app (Flutter/native WebRTC vs existing
mediasoup backend; iOS stays on web); fallback B = Snapcast hybrid. Custom
UDP protocol ruled out by user.

### Round 3 — anchor v2 (mute-pump + WebAudio + anchor) — 2026-07-04

**PASS on Android Chromium: media-player notification appears** (the
two-player-shadowing hypothesis was correct — muting the srcObject pump
let the anchor win the session binding).

Follow-ups same evening, all deployed + user-verified:
- **Brown noise kept playing after DJ closed the room** → frontend never
  subscribed to the `roomClosed` event the backend sends before ejecting
  listeners; raw WebRTC error shown in lobby. FIXED: roomClosed →
  terminal state with full audio teardown + "The DJ closed the room"
  message; listenerNotFound terminal got the same teardown (same leak).
- **Noise bed too audible** → anchor regenerated at **-59.9 dBFS** RMS
  encoded (was -46.4); 12 dB above Chrome's -72.25 silence cliff = the
  safe minimum.
- **Firefox Android failed identically on its plain path** (no controls,
  ~1 min death — Gecko has the same srcObject media-control exclusion) →
  anchor mechanism gate extended to Firefox/Android. **USER CONFIRMED:
  WORKS ON FIREFOX TOO** (2026-07-04 late). Gate now = Android +
  (Chrome/ or Firefox/) UA; iOS remains untouched/excluded.

Remaining verification for the full matrix: (a) 10+ min locked longevity,
(b) lock-screen pause/play behavior, (c) Brave/Ecosia/Samsung Internet
sweep, (d) iPhone regression re-check, (e) call-interruption / WiFi-drop
recovery items from the round-2 checklist below.

### Round 2 — original checklist (superseded by result above)

1. Join as listener, verify music plays. Faint noise bed should be
   inaudible (if audible when DJ is silent, we lower the file level —
   floor is -72 dBFS).
2. Lock screen: **media notification with HushFM metadata + play/pause
   should now appear.**
3. Locked 10+ min → music keeps playing.
4. Lock-screen pause → music stops; lock-screen play → resumes (anchor
   keeps focus meanwhile).
5. iPhone regression re-check: unchanged behavior (anchor gated off).
6. Then continue matrix items c–i.

### Fix candidates (original ranking, superseded by the above; none touch stream latency/jitter)

1. `mediaSession.setPositionState({duration: <finite>, ...})` on the
   existing element — free, ~10 lines, unproven for srcObject (test).
2. Parallel real-file "anchor" `<audio>` (looping ≥5 s, near-inaudible but
   NOT silent — silent is deprioritized post-2024) owning the media session
   + full audio focus; play/pause handlers routed to the WebRTC element.
   The classic community workaround.
3. Route remote track through AudioContext (output-side only, no latency
   impact) — keeps audio alive on some devices, no controls by itself;
   combine with 2.
4. Supported-browser guidance for guests (Firefox/Chrome; Ecosia/in-app
   browsers best-effort).
5. Wake Lock — VETOED (no keep-screen-on banners).
