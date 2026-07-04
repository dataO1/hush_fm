# Native-Client Rewrite Research — hush_fm v2

Deep research, 2026-07-04 (four parallel research agents: client frameworks +
store publishing, transport/latency, Rust server options, off-the-shelf prior
art). Goal: evaluate an alternative implementation with native mobile clients
that beats the browser's enforced latency floor and its platform limits
(Android lock-screen audio), publishable to both app stores within ~3 weeks.

---

## 0. The three findings that reshape the whole decision

1. **The latency never lived in the server or the protocol — it lived in the
   browser's playout buffer.** mediasoup is a pure packet router (no
   transcode/mix, sub-ms contribution; rated ~500 consumers/worker). Native
   clients that control their own jitter buffer erase the 100–500 ms floor
   regardless of which wire protocol we pick. On WiFi, native WebRTC
   (~40–80 ms) and hand-rolled RTP/UDP (~15–40 ms) converge in practice,
   because **WiFi jitter dominates, not protocol overhead**.

2. **A full public dual-store listing in 3 weeks is not realistic — but the
   fast channels are equivalent for our use case.** Google Play gates new
   personal accounts behind a 12-tester/14-continuous-day closed test before
   production; Apple's Guideline 4.2 (minimum functionality) is a real
   rejection risk for an app whose server is an unreachable LAN box. The
   de-risked plan: **iOS TestFlight external link** (only first build
   reviewed, ~24–48 h) + **Android Play internal-testing track** (≤100
   testers, no review, instant link, exempt from the 14-day gate). Because
   the venue is offline, guests must install *before* arriving no matter the
   channel — a public listing buys nothing extra for this party. The **web
   app stays as the zero-install walk-in fallback** in every scenario.

3. **Sync-uniformity is probably the better product goal than minimal
   latency.** Listeners hear only their own headphones: inter-listener
   audio-fusion/comb-filter thresholds don't apply; only *visual* dance sync
   matters, and the DJ monitors off the mixer, so absolute crowd delay is
   nearly irrelevant **as long as it is uniform**. Commercial RF silent-disco
   systems win on uniformity (all receivers identical), not on latency. A
   fixed common playout offset (~50–150 ms) with <20 ms inter-phone skew
   plausibly beats minimal-but-per-phone-variable latency on the dance floor.

---

## 1. Store publishing critical path (do these regardless of architecture)

| Step | Duration | Notes |
|---|---|---|
| Apple Developer enrollment (INDIVIDUAL, not org) | 1–2 days | Org needs D-U-N-S: up to 4 weeks — avoid |
| Google Play developer account | ~1 day + $25 | Personal account is fine for internal testing |
| iOS TestFlight external: first build Beta App Review | ~24–48 h (budget for tail) | Later builds usually skip review; public link, 10k testers |
| Android internal testing track | instant | ≤100 testers, no review, **not subject to 12/14 rule** (production-only gate) |
| Full public listings | NOT in 3 weeks | Play: 12 testers × 14 continuous days (new personal accts, still in force 2026, orgs exempt-ish); Apple 4.2 risk. Post-party follow-up. |

Actions to start **on day 1** (long poles): Apple individual enrollment,
Play account creation, and — if we ever want a public Play listing — decide
on an organization account now.

Client-side WebRTC caveat: `flutter_webrtc` and `react-native-webrtc` both
have documented iOS background-audio failure modes (flutter-webrtc #1005,
#816; rn-webrtc #984 — audio dies ~15 s after lock without VoIP/CallKit
config). A plain decoded-PCM playback pipeline (AVAudioSession `.playback` +
`UIBackgroundModes: audio`; Android foreground service `mediaPlayback` +
MediaSession) is the well-trodden music-app path and cures our lock-screen
problem structurally. Configurable, not disqualifying — but the custom-decode
path has the *cleaner* background story.

**WASM is not a store path** (stores take native IPA/AAB only). KMP/Compose
is the least mature for audio. Fully-native dual codebases in two unlearned
languages is the highest 3-week risk.

## 2. Transport facts (numbers that constrain every design)

- **Opus 20 ms frames are mandatory at our scale.** 80 listeners × 50 pps =
  4,000 pps ≈ ~60% channel airtime on the Flint 2 (per-frame fixed 802.11
  overhead ~130–160 µs dominates the tiny payload). 10 ms frames = 8,000 pps
  → saturation. Bandwidth itself is trivial (~11.5 Mbps at 128 kbps).
  96 kbps mono/stereo is worth considering for headroom.
- **Multicast on WiFi: ruled out** (base-rate transmission, no ACK/retry,
  >5% loss, power-save breakage — IETF mboned draft). Unicast fan-out only.
- **QUIC/MoQ**: maturing (2026) but solves internet-relay problems we don't
  have; mobile FFI immature. **SRT/RIST**: ≥120 ms floors, wrong tool.
- **WiFi power-save on locked phones is real**; the fix is a steady 20 ms
  downlink cadence (aligns with U-APSD/WMM-PS VoIP triggers) + **DSCP EF /
  AC_VO tagging from the native client** — something browsers can't do.
- **Clock drift correction is mandatory** for continuous playback (80
  independent phone DACs). libwebrtc/NetEQ gives it free (time-stretch);
  DIY needs `rubato` adaptive resampling + a control loop. No Rust NetEQ
  exists (`jittr` is minimal); the adaptive-jitter-buffer + drift loop is the
  classic >2-week tail of a hand-rolled stack.
- **80 clients on one radio is above best practice (~20–30/radio).** 30–40 is
  comfortable on the Flint 2's 5 GHz; **plan a second AP above ~40 guests**
  regardless of software architecture.
- NetEQ knobs browsers hide are available natively: `jitterBufferTarget` /
  `playoutDelayHint` / DelayManager min-delay → target low tens of ms.
  (Note: the "never touch playoutDelayHint" veto was about protecting the
  *browser* app's behavior; deliberately setting a low target is the entire
  point of the native rewrite — decision to be re-confirmed by user.)

## 3. Server options (Rust-favored, Pi 4, ≤2 weeks)

| # | Option | Latency contribution | Effort | Code survival | Verdict |
|---|---|---|---|---|---|
| 1 | **Keep mediasoup + native clients** | ~0 (router only) | ~zero server work | 100% (Axum, rooms, WS signaling, audio-ingest) | **Primary** |
| 2 | **Custom tokio UDP/RTP fan-out** | theoretical floor (no SRTP/ICE) | ~1 wk (encoder + RTP packetizer already in tree!) | Axum rooms + audio subsystem; mediasoup dropped | **Strong #2** |
| 3 | Snapcast server | fixed 50–300 ms, sample-accurate sync | server trivial (nixpkgs); client is the problem | little | Paradigm wildcard |
| 4 | str0m own-SFU | ~0 | high (build an SFU) | partial | Only if dropping C++ worker is a goal |
| 5 | GStreamer rtpbin fan-out | ~0 | medium | less than #2 | Dominated by #2 |
| 6 | LiveKit self-hosted | fixable | medium | zero | Misconfig post-mortem below; nothing over #1 |
| 7 | webrtc-rs SFU | ~0 | high, weakest maturity | partial | No |

**Already built and load-bearing:** the "DJ plugs straight into the Pi" path
exists in `backend/src/lib/audio/` — cpal USB line-in capture → Opus encode →
RTP packetize → mediasoup DirectProducer, with hot-plug lifecycle. It removes
the DJ laptop's network+encode hop in every architecture (and adapts to #2 by
swapping the DirectProducer sink for the UDP socket).

**LiveKit 500 ms post-mortem (previous attempt):** textbook signature of
unreachable UDP ICE candidates → silent TCP fallback (default-on) →
head-of-line blocking + default buffer. Likely root causes: `use_external_ip:
true` STUNs out on an offline LAN and overrides `node_ip` (livekit #2088,
#4049); Docker bridge NAT breaking the UDP port range. Same bug class as our
mediasoup `announcedIp`-must-be-IP-literal fix. It was a misconfiguration,
not a LiveKit ceiling — but LiveKit still offers nothing over mediasoup here
(Go server, zero Rust reuse).

## 4. Off-the-shelf / prior art (build-vs-buy)

| Candidate | Topology | 80-listener fan-out | Store apps today | LAN offline | Verdict |
|---|---|---|---|---|---|
| **SonoBus** | P2P mesh (server = rendezvous only, no relay) | ✗ (~dozen peers; DJ would upload 80 streams) | ✓ both stores, polished | ✓ | Killed by mesh topology |
| **JackTrip** | hub-server star | ✗ (~30 max on Pi 4 = (cores+1)×6; uncompressed audio) | ✗ (mobile app is a cloud-bridge controller, not a LAN client) | partial | Killed twice over |
| **Snapcast** | server → N clients (TCP) | unproven at 80 (documented WiFi stutter issues; 5 GHz mitigates) | Android: Snapdroid ✓ mature; iOS: third-party, FLAC-only, reviewer-reported stutter | ✓ | **Only serious buy option**; sync-paradigm |
| Agora / Dolby.io / Millicast | cloud | — | — | ✗ | Cloud-locked, dead |
| ODIN (4Players) | self-hosted SFU | ✓ (1000/instance) | ✗ (SDK only — you still build clients) | ✓ | Defeats the purpose; ~€350/mo |
| AmpMe/SoundSeeder etc. | consumer sync apps | ✗ | ✓ | ✗ | Non-starters |

Snapcast's crown jewel: **<0.2 ms inter-client sync** (continuous time-sync +
sample insert/drop) — the RF-headset uniformity property. Its costs: TCP per
client, realistic 100–300 ms fixed latency on party WiFi (docs say 50 ms
floor; field reports often raise buffers), weak iOS client, no QR onboarding,
no branding, discards our room model.

---

## 5. Top 3 architectures (ranked)

### #1 — "Native shell, same engine": Flutter + libwebrtc against the existing backend

Server unchanged (mediasoup + Axum + rooms + WS signaling — 100% survives).
DJ: browser as today, or the built-in Pi line-in ingest. Listener app:
Flutter, `flutter_webrtc` (real libwebrtc: NetEQ, PLC, Opus FEC, drift
correction all free), drive `jitterBufferTarget`/playout delay low, DSCP
tagging, foreground-service/AVAudioSession background audio, QR auto-join.

- **Latency:** ~40–80 ms glass-to-ear (vs ~150–500 in browser).
- **Pros:** smallest total change; server risk zero; battle-tested audio
  pipeline; web fallback shares the same SFU (walk-in guests!); one Flutter
  codebase → TestFlight + internal track fits 3 weeks.
- **Cons/risks:** mediasoup's client protocol needs a Dart client —
  `mediasoup_client_flutter` is a community port of unverified freshness
  (week-1 spike: validate or hand-roll the small recv-only subset:
  createTransport/connect/consume); `flutter_webrtc` iOS background-audio
  needs careful config (documented issues); still WebRTC on the client (the
  fragility class we know).
- **Effort:** ~1 wk client core + 1 wk polish/store; server ~0.

### #2 — "Rust to the metal": Flutter UI + Rust core + custom UDP/RTP fan-out, synchronized playout

Server: keep Axum rooms/signaling; swap the DirectProducer sink for a tokio
UDP unicast fan-out (Opus encoder + RTP packetizer already in tree), 20 ms
frames, DSCP EF, per-client keepalive. Client: Rust core via
`flutter_rust_bridge` (UDP receive, **fixed common playout offset** of
~80–150 ms scheduled against RTP timestamps + server-broadcast clock, rubato
drift correction, Opus decode), Flutter for UI + low-latency output
(flutter_soloud/miniaudio) + background-audio glue. No WebRTC anywhere in
the client.

- **Latency:** ~15–40 ms achievable minimal, OR fixed ~100–150 ms with
  **RF-grade inter-phone sync** — the fixed-offset design is *simpler* than
  an adaptive NetEQ clone AND delivers the uniformity product win.
- **Pros:** plays to team strength (all hard parts in Rust); cleanest
  possible background-audio story (plain playback pipeline); kills the
  entire ICE/announced-IP/WebRTC bug class forever; full control (sync mode,
  FEC, QoS); protocol is ours.
- **Cons/risks:** we own the jitter/drift tail (mitigated by fixed-offset +
  rubato, but it's net-new reliability code); web-app fallback then needs the
  mediasoup path kept alive in parallel (two audio paths on the server —
  they can share the encoder); most net-new code of the three.
- **Effort:** ~1 wk server + ~1.5–2 wk client — tight but feasible; the
  fixed-offset simplification is what makes it fit.

### #3 — "Buy sync, build (almost) nothing": Snapcast

snapserver on the Pi (nixpkgs), DJ line-in → ALSA/pipe input. Android guests
install the published **Snapdroid** today (zero dev, zero publishing).
iOS: the third-party client is a reliability gamble → realistic plan is a
minimal own Flutter/Swift snapclient (a Rust `snapcast-client` protocol crate
exists) shipped via TestFlight.

- **Latency:** fixed, realistically 100–300 ms on party WiFi — but
  **sample-accurate (<0.2 ms) sync across every phone**.
- **Pros:** best dance-floor uniformity of anything here; Android story is
  literally done; proven server on SBCs; paradigm matches the product.
- **Cons/risks:** TCP-per-client at 80 on WiFi is unproven (documented
  stutter issues); iOS client work sneaks back in; no QR/branding/room
  model — hush_fm the *product* dissolves into a generic audio pipe; buffer
  tuning vs dropout is a live risk on party WiFi.
- **Effort:** days for server + Android; the iOS client decides everything.

### Cross-cutting recommendations (all paths)

- Keep the **web app as the walk-in fallback** (it shares mediasoup in #1
  automatically; needs the parallel path retained in #2/#3).
- **Start store accounts on day 1** (Apple individual enrollment, Play
  account) — they're the calendar-critical path, not the code.
- **Second AP above ~40 guests.**
- Week-1 go/no-go spikes: (#1) mediasoup_client_flutter viability;
  (#2) flutter_rust_bridge + flutter_soloud round-trip on a real phone;
  (#3) Snapcast 40+ client load test incl. the iOS app.

## 6. Open questions for the discussion

1. **Latency vs sync**: is fixed ~100–150 ms with tight inter-phone sync
   acceptable (better dancing), or is absolute minimum latency the goal
   (e.g., DJ needs crowd reaction timing)? This decides #1 vs #2's playout
   design and whether #3 is even eligible.
2. Do we commit to **Flutter** (new language, one codebase) — the research
   consensus — or React Native (TS familiarity, weaker audio/FFI story)?
3. Is the **DJ line-in-to-Pi** path (already built) the party configuration,
   removing the DJ laptop from the audio path entirely?
4. How much does the **hush_fm product layer** (rooms, QR join, branding,
   lobby) matter vs "audio arrives on phones"? (#3 sacrifices it.)
5. Play **organization account** now for a future public listing, or accept
   testing-track distribution indefinitely?

## 7. Source index (key citations)

- Play 12-tester/14-day rule: support.google.com/googleplay/android-developer/answer/14151465
- Play internal testing (no review, 100 testers): answer/9845334
- TestFlight external review: developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview
- Apple 4.2 minimum functionality: developer.apple.com/app-store/review/guidelines
- flutter_webrtc iOS background issues: github.com/flutter-webrtc/flutter-webrtc/issues/1005, /816
- NetEQ/jitterBufferTarget: webrtchacks.com/how-webrtcs-neteq-jitter-buffer-provides-smooth-audio, MDN RTCRtpReceiver.jitterBufferTarget
- WiFi multicast problems: datatracker.ietf.org/doc/html/draft-ietf-mboned-ieee802-mcast-problems-12
- U-APSD/WMM-PS, AC_VO: dot11ap.wordpress.com/unscheduled-automatic-power-save-delivery-u-apsd
- mediasoup scalability: mediasoup.org/documentation/v3/scalability
- LiveKit LAN misconfig: github.com/livekit/livekit/issues/2088, /4049; kb.livekit.io firewall article
- Snapcast: github.com/snapcast/snapcast (+discussions/743, issues/804, /937); Rust protocol crate: crates.io/crates/snapcast-client
- SonoBus mesh limitation: github.com/sonosaurus/sonobus README; audiotechnology.com/free-stuff/sonobus
- JackTrip hub limits: manpages.debian.org jacktrip.1
- str0m: github.com/algesten/str0m; rubato: github.com/HEnquist/rubato
- flutter_rust_bridge / flutter_soloud / flutter_opus: respective GitHub repos
- Silent-disco RF baseline: inda-audio.com UHF-vs-2.4GHz comparison
