# Party Router (GL.iNet Flint 2) — setup & operation

The party runs on a GL.iNet Flint 2 (GL-MT6000) with **no internet uplink**.
This doc is the current-state reference. The router config is imperative
(not in the Nix flake) and lives in two scripts:

- **`scripts/router-party-setup.sh`** — idempotent one-shot that makes a
  (possibly factory-reset) router fully party-ready. Re-run after any
  factory reset or GL web-UI change.
- **`scripts/router-party-test.sh party|home`** — self-contained PASS/FAIL
  verifier (Claude/tools have no internet while on the offline party net,
  so testing is a script you run yourself).

Setup prerequisites (one-time after a factory reset): set the admin
password in the GL wizard, `ssh-copy-id root@192.168.8.1`, and give the
router internet **once** so the fakeinternet package can install.

Verified live end-to-end on 2026-07-05 (router side, via the test script).

---

## Decisions (2026-07-09 grill) — what's settled

The connectivity + HTTPS work is **substantially done**; these are the residual
calls made after reviewing the state:

1. **Router stays IMPERATIVE (scripts, not Nix) — accepted.** The Flint 2 runs
   OpenWrt, not NixOS; a declarative router would be a large rewrite of a rarely
   re-flashed party appliance. `router-party-setup.sh` is idempotent + verified.
   This is the one deliberate non-Nix exception in the project.
2. **Modern Android = "one tap, then quiet" — accepted; Tier 1 NOT built.** A
   truly zero-touch door would need a minimal real WAN uplink (spare-phone USB
   tether + firewall allowlist to only the OS probe hosts). Deemed not worth the
   extra venue hardware/config; one sticky tap + signage is good enough.
3. **Real-phone Android FIELD test is a hard pre-party gate** (see TODO "TO TEST
   AT HOME"). The router side is lab-verified; the "sticky one-tap then quiet"
   Android behavior post-fix has only been reasoned through, never confirmed on
   actual guest hardware. Must validate on ≥2 Android models before the party.
4. **Cert-expiry safety net (being built):** the DJ page will show a warning when
   the TLS cert is near expiry, fed by a `certDaysRemaining` field on `/health`
   (backend reads the LE cert's notAfter). So a cert that quietly aged out (Pi
   didn't get home-internet inside the 30-day renewal window) can't ambush you at
   the door. See https-setup.md §6 + TODO.
5. **Single AP — no second AP.** The doc's ">40-50 guests wants a second AP" note
   stands as a KNOWN CEILING, not a plan: with one Flint 2, coverage past ~40-50
   phones through a crowd will degrade and there is no software fix. Keep guest
   count in mind; AP height/placement (§ radio) is the only lever we have.

---

## What the router does

### 1. Serves the app over a trusted name
dnsmasq resolves `hushfm.dedyn.io → 192.168.8.100` (the Pi) via a
persistent uci `address` entry. The Pi holds a real Let's Encrypt cert for
that name, so phones get a clean padlock with no internet. (`/etc/dnsmasq.d`
on this firmware is tmpfs — uci is the persistent path.)

### 2. Silences the "no internet" warnings (fakeinternet, automatic)
Phones validate a new WiFi by fetching probe URLs; with no uplink these
fail, so the OS shows "no internet", deprioritises the WiFi, and (Android
with mobile data on) switches to cellular — breaking the LAN app.

**fakeinternet** answers those probes locally (real HTTP 204 / Apple
"Success" / etc.) via a dnsmasq hijack **plus** a firewall DNAT of all
LAN-outbound 53/80/443 — the DNAT also catches phones with pinned DoH/
Private-DNS that bypass dnsmasq. LAN-destined traffic is excluded, so the
Pi and its padlock are untouched.

Per-OS result:
- **iOS / old Android / Fire / desktop:** fully clean, no prompts.
- **Android 9+ :** the HTTPS probe to Google is unspoofable, so the network
  is "partial connectivity" until the guest taps **once** — after that
  Android stores `mUseHttps=false` for the network (persists across reboot),
  the HTTP-204 spoof then validates it, and it goes quiet. So modern Android
  is "one tap, then quiet" (not zero-touch; that would need a real uplink,
  which we deliberately don't have).

The spoof answers probes with a genuine **204, never a 302 redirect** — a
302 lands phones in captive-portal state (restricted WebView, no WebRTC,
re-prompts every reconnect).

**Fully automatic — no manual toggle.** A watchdog
(`/usr/bin/fakeinternet-auto`, cron every 2 min + WAN hotplug) enables
fakeinternet when the uplink is gone (party) and disables it when it's back
(home). It checks **IP literals only** (`ping 8.8.8.8`) — hostname checks
would deadlock because fakeinternet hijacks the router's own DNS.

### 3. Radio tuned for 50-80 phones streaming audio on an open field
- **2.4 GHz = PRIMARY**, SSID **`hushfm`**, fixed **channel 1**, HE20.
  Chosen on technical merit for an outdoor crowd: human bodies attenuate
  5 GHz ~2-3 dB more each (a dance floor stacks 12-18 dB), 5 GHz also
  starts ~6.5 dB behind on free-space loss, and 2.4's usual weakness
  (congestion) doesn't exist on an empty field. The load is packet-RATE
  bound (~2000 pps at 80 guests), which is band-independent — so 2.4's
  better penetration wins with no throughput downside. (Legality is not a
  factor in this choice; 2.4 is simply the better radio through a crowd.)
- **5 GHz = SECONDARY**, SSID **`hushfm-5`**, fixed **channel 36**, HE80 —
  headroom for phones near the booth with line-of-sight.
- **Fixed channels, no DFS** (ch ≥100): a radar hit → channel move → mass
  reassociation → Android revalidation storm. Never auto/ACS.
- **802.11k / BSS-transition OFF** on both: steering roams re-run Android's
  captive validation.
- `dtim 1`, `max_inactivity 3600`, `disassoc_low_ack 0`, `maxassoc 100`:
  fewer forced reassociations of dozing phones.
- **Left ON deliberately:** MAC-layer retries (sub-ms, turn 5-30% raw loss
  into <1%) and A-MPDU aggregation (opportunistic at our packet rate —
  saves airtime, ~zero added delay). The "no retries / no aggregation for
  latency" instinct is wrong here; those help.
- **AP placement (physical, not scriptable):** elevate 2.5-3 m above head
  height at the floor edge, angled in — the single biggest coverage lever
  through a crowd. Plan a **second AP above ~40-50 guests** (single-radio
  ceiling; tuning can't move it).

**MTK driver quirk:** `wifi reload` and even reboot do NOT reliably apply
wireless uci changes — `wifi down; wifi up` does (the setup script does this
automatically). After any GL web-UI save, re-run the setup script (the UI
rewrites the uci files).

---

## Pi-side companions (in the Nix flake / rpi4-nixos)

These are declarative (rpi4-nixos configuration.nix), not router config:
- **Audio (party-tuned):** 20 ms Opus frames (50 pps/client — low latency;
  40 ms would halve the packet rate, the WiFi ceiling, and is worth switching
  to only for big >50-guest crowds — below that 20 ms is fine), 160 kbps stereo
  (earbud-transparent; 256k was overkill), **FEC on** (`opusEnableFec=true`,
  overridden in rpi4-nixos — crowd body-shadow fades cause isolated loss MAC
  retries can't always bridge; cheap at 160k, pairs with `opusPacketLossPerc=10`),
  **CBR** (`opusEnableVbr=false` — predictable airtime under load).
- **DSCP 48 (CS6)** so downlink audio lands in the WiFi voice queue (AC_VO)
  that locked phones' U-APSD services — EF/46 maps to AC_VI (video) under
  Linux's RFC 8325 rule. (Downlink AC on the MTK driver is worth an
  on-device check at the load test.)
- **CPU governor `performance`** + onboard WiFi blacklisted (Pi is wired):
  consistent latency for a 6-hour encode; check `vcgencmd get_throttled`
  stays `0x0` (needs a heatsink/fan).

---

## Pre-party test protocol

**Router (offline verifier):**
1. Unplug WAN, power-cycle, wait ~2 min (watchdog cron), laptop on `hushfm`.
2. `./scripts/router-party-test.sh party` → expect all PASS (probes spoofed,
   DNS→Pi, app clean-TLS, HTTPS probe correctly failing, watchdog enabled).
3. Optional: join with a phone — iOS silent, Android one sticky tap, app loads.
4. Plug WAN back, wait ~2 min, `./scripts/router-party-test.sh home` → all PASS.

**1-hour Pi/RF burn-in (catch thermal/airtime/OFDMA before guests):**
- Confirm `iw reg get` = DE; baseline `vcgencmd measure_temp` /
  `get_throttled` (0x0) and mediasoup worker RSS.
- Drive 60-80 consumers with real DJ audio for the full hour.
- Every ~10 min: router `iw dev <wlan> station dump` — watch `tx retries` /
  `tx failed` climbing or rates collapsing to legacy = airtime saturation →
  go to 60 ms frames or lower bitrate.
- A/B GL's OFDMA toggle 20 min on / 20 min off; keep the cleaner one
  (MT7986 OFDMA maturity is unproven — verify, don't assume).
- Temp < 80 °C throughout, `get_throttled` stays 0x0, worker RSS flat.
- Crowd sim: 5-10 people between AP and a far phone — audio survives
  (validates FEC + AP height). WiFi off/on a phone → rejoins in seconds,
  no persistent re-prompt (validates steering-off).

## Signage (residuals no router setting can fix)
"Connect to **hushfm** WiFi, open **hushfm.dedyn.io**." For Android: if
asked "stay connected?", tap yes (once). Samsung: Settings → Connections →
Wi-Fi → Intelligent Wi-Fi → turn off "Switch to mobile data". Turn off any
always-on VPN / Private DNS if the app won't load.

## Facts / gotchas
- SSH `root@192.168.8.1` (password = GL admin password; laptop key installed).
- fakeinternet default config never uses the `#` catch-all (would swallow
  hushfm.dedyn.io); domain list extended with Samsung/MS/Xiaomi/Huawei.
- Re-verify DNS + fakeinternet + radio after any GL web-UI save (it rewrites
  uci) by re-running the setup script.
