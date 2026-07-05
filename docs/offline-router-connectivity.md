# Offline-router connectivity: killing the "no internet" prompts

Verified research 2026-07-04 (deep-dive incl. AOSP NetworkMonitor source,
fakeinternet package source, GL.iNet specifics). Supersedes the
TODO_PARTY_FIXES §3 assumption that "install fakeinternet = done".

## The verified mechanics

- Every OS probes a known URL on join. iOS: `http://captive.apple.com/
  hotspot-detect.html` (expects "Success" — HTTP, fully spoofable).
  Android: BOTH `http://connectivitycheck.gstatic.com/generate_204` AND
  `https://www.google.com/generate_204`.
- **Since Android 9, VALIDATED requires the HTTPS probe to succeed** —
  unspoofable without a Google cert. HTTP-only success = "partial
  connectivity" → the "limited connectivity / stay connected?" dialog.
- **The party's re-prompt loop is by design:** NetworkMonitor re-evaluates
  on every reassociation (WiFi power-save wake, roam, DHCP renew) and
  periodically (1 s → 10 min backoff). "Stay connected" acceptance is
  per-WifiConfiguration and does NOT reliably survive re-evaluation.
  Samsung One UI adds its own "Intelligent Wi-Fi / switch to mobile data"
  layer on top (per-device setting, cannot be fixed from our side).
- **Conclusion: no spoof (DNS or DNAT) can produce zero prompts on modern
  Android.** Spoofing fully fixes iOS + Android ≤8 + Fire/desktop probes,
  and keeps the LAN route alive; the dialog recurrence on Android 9+ can
  only be eliminated by making the HTTPS probe genuinely succeed.

## fakeinternet package — verified state

Maintained (HEAD 2025-08; docs.mossdef.org/fakeinternet). Mechanism = BOTH
dnsmasq `address=` hijacks AND procd firewall **DNAT of LAN-outbound ports
53/80/443** to a local uhttpd CGI responder on :65530 (DNAT excludes
LAN-destined traffic → hushfm.dedyn.io → Pi is untouched, padlock safe;
no port-80 collision with the GL admin UI). The DNAT layer catches
hardcoded-IP and DoH-resolved HTTP probes that pure DNS spoofing misses.
Serves exact probe responses (204 for generate_204/gen_204, Apple Success
page, GNOME/Firefox/Kindle paths, generic 200 otherwise).

Default config gaps to add: Microsoft NCSI (www.msftconnecttest.com),
Samsung (connectivitycheck.samsung.com), connectivitycheck.android.com,
clients3.google.com. Do NOT use the `#` catch-all (would swallow
hushfm.dedyn.io). OpenWrt ≥15.05 compatible → Flint 2 GL firmware OK.
Risk: GL web-UI saves can rewrite UCI firewall/dhcp — retest after any
UI change.

Rejected alternative: embracing a captive portal (RFC 8908) — it
*guarantees* an interstitial and routes guests into the stripped captive
mini-browser, a known WebRTC trap. DIY-on-Pi-only cannot match the
router's DNAT (only the gateway can redirect other devices' traffic).

## The two tiers

### Tier 1 — bulletproof, zero prompts on EVERY OS (recommended)
Give the Flint 2 WAN a minimal real uplink (phone hotspot via USB tether,
or a cheap LTE dongle) + **firewall allowlist LAN→WAN to ONLY the probe
hosts** (connectivitycheck.gstatic.com, www.google.com,
clients3.google.com, connectivitycheck.android.com, captive.apple.com,
www.apple.com, www.msftconnecttest.com, connectivitycheck.samsung.com,
detectportal.firefox.com on 80/443 + DNS); DROP all other LAN→WAN.
- HTTPS probe genuinely succeeds → VALIDATED → no dialog ever, no
  mobile-data switch, on all OSes; guests still get no usable internet
  (no bandwidth leak); mobile-data-off signage becomes optional.
- Effort: ~30 min tether + allowlist rules, on top of Tier 2.

### Tier 2 — offline spoof (fallback / base layer, works with no uplink)
Install fakeinternet on the Flint 2 (stangri feed), add the missing
domains above, verify hushfm.dedyn.io still resolves to the Pi.
- iOS + old Android: fully clean. Modern Android: "limited connectivity"
  prompts still recur on reassociation, BUT with mobile data off there is
  no cell route to switch to → WiFi stays default → app keeps working.
- Signage becomes LOAD-BEARING: "Turn OFF mobile data (or airplane mode
  + WiFi). Samsung: Intelligent Wi-Fi → disable 'Switch to mobile data'.
  If asked 'stay connected?' → Yes. No always-on VPN / Private DNS."
- Effort: 30–60 min on the router.

## Per-OS outcome (spoof-only vs Tier 1)

| Device | Spoof only (Tier 2) | + real probe uplink (Tier 1) |
|---|---|---|
| iOS 16-19 | ✅ clean, no prompts | ✅ |
| Android ≤8 | ✅ validated | ✅ |
| Android 9-17 stock | ⚠️ recurring "limited connectivity"; works with mobile data OFF | ✅ VALIDATED, zero prompts |
| Samsung One UI | ⚠️ prompts + Intelligent-WiFi auto-switch (needs per-device toggle) | ✅ |
| Fire OS/desktop | ✅ | ✅ |

## Test protocol (pre-party, extends device-test-protocol.md)

Airplane-mode matrix per device (iPhone, stock Android 13+, Samsung):
join SSID → watch for the no-internet notification → leave locked 10+ min
(forces power-save reassociation → re-probe) → confirm no recurring
prompt + hushfm.dedyn.io loads with padlock. Definitive Android signal:
`adb shell dumpsys connectivity | grep -i validat` → must say VALIDATED
(Tier 1) / shows PARTIAL (Tier 2, expected).

## Investigated and rejected alternatives (research 2026-07-04 late)

**Gatewayless DHCP ("printer-network" pattern — WiFi never claims internet,
phones keep 4G):** REJECTED for Android. The architectural killer: an
Android app (incl. the browser) can only send traffic over the phone's
DEFAULT network unless it explicitly binds sockets to another Network —
browsers never do. Per-network routing tables mean that with cellular as
default, the browser CANNOT reach the on-link 192.168.8.0/24 at all
(HTTPS, WSS, and WebRTC UDP all unroutable; ICE won't even enumerate the
non-default interface reliably). So the exact cohort the idea targets
(data-on Android) loses the app entirely. It also does NOT suppress the
Android nag (a gatewayless net is just "unvalidated" — probes fail with no
route out). iOS handles it fine (scoped routing; Safari exempt from the
Local Network permission) — but iOS already works under Tier 1/2.
The IoT precedent doesn't transfer: printer/GoPro/Chromecast setup apps
bind to local-only networks via WifiNetworkSpecifier — an app-only API
with no browser equivalent.

**"Local-only by design" declaration:** no such standard exists for
settings-joined networks. Capport `captive:false` → Android still runs
full HTTP+HTTPS probes (fail offline → nag); `captive:true` → guaranteed
sign-in interstitial + captive mini-browser (WebRTC trap, already
vetoed); `venue-info-url` is cosmetic.

**The overriding rule: for an Android browser to reach the LAN app, the
WiFi must be the phone's default (or only) network.** Tier 1 achieves
that via genuine validation; Tier 2 via mobile-data-off. Both new ideas
violate it.

Note for the test matrix: Chrome 142+ ships Local Network Access
permission gating — should not affect us (page is served FROM the private
IP; WS/WebRTC not gated) but verify on-device once.

## Final sweep (2026-07-05): the Tier-2 upgrade + hardening checklist

**The one new mechanism that matters (AOSP NetworkMonitor):** when a guest
accepts "partial connectivity" ONCE, Android calls
`setAcceptPartialConnectivity()` → `maybeDisableHttpsProbing(true)` →
**`mUseHttps = false` is stored for that saved network and persists across
reboot**. From then on the HTTP-204 spoof alone satisfies validation → the
network is promoted to **VALIDATED**, nag gone, real browser, WebRTC works.
This reconciles the party experience: the endless re-prompting happened in
the NO-spoof regime (both probes failing = "no internet" dialog path, no
acceptance bit). **With the Tier-2 spoof in place, modern Android becomes
"one tap, then quiet"** — modulo OEM skins (Samsung/MIUI more aggressive)
and MAC-randomization/forget-network resetting the bit. Still below
Tier 1's zero-tap, but far better than previously assumed.

Spoof engineering rules that make this work:
- Answer HTTP probes with a REAL `204` — **never a 302 redirect** (302 →
  CAPTIVE state → the restricted CaptivePortalLogin WebView: no WebRTC,
  re-prompts every reconnect, and IIAB documented 30-s connection drops.
  The deliberate-captive idea is dead).
- Let the HTTPS probe fail FAST (TCP RST beats blackhole — same resulting
  state, snappier UX). fakeinternet's DNAT does this.
- Disable GL.iNet's "DNS Rebinding Attack Protection" (would block local-
  hostname answers).

**Router association-stability checklist** (each reassociation re-runs
validation → fewer reassociations = fewer prompt opportunities):
- Single SSID, band steering OFF (or 2.4 GHz-only SSID for listeners).
- Disable 802.11r/k/v (no roaming exists on one AP; 11r causes spurious
  reconnects).
- hostapd: `max_inactivity` 300→3600, `disassoc_low_ack 0` (stop deauthing
  dozing phones).
- DHCP lease 24 h+.
- (Evidence qualitative; changes the COUNT of validations, not outcomes.)

**Prior art (offline-education at scale — IIAB/RACHEL/Kiwix):** converged
on captive portal OFF for Android + memorable plain-HTTP hostname + heavy
signage. Confirms our direction; their captive-portal lessons are why we
must stay in PARTIAL, never CAPTIVE.

**Exotic levers, all confirmed dead:** user CA certs (probe trusts system
store only), captive_portal_* device settings (adb-only), Passpoint (same
probes), WISPr (legacy), scoring/suggestion APIs (app-only).

**iOS 18 note:** the captive sheet may no longer auto-appear — moot for us
(we spoof Apple's probe → validated), but signage should still say "open
hushfm.dedyn.io in Safari".

## ✅ INSTALLED on the Flint 2 (2026-07-05, post factory-reset)

Router state is NOT declarative — this section is the reproducible runbook
(re-run after any future factory reset). SSH: `root@192.168.8.1` (password
= web admin password; laptop key installed via ssh-copy-id).

Applied and verified:
1. **DNS override (persistent, uci — card 8):**
   `uci add_list dhcp.@dnsmasq[0].address='/hushfm.dedyn.io/192.168.8.100'
   && uci commit dhcp && /etc/init.d/dnsmasq restart`
   Verified: resolves to the Pi from router + laptop; HTTPS via LAN DNS =
   HTTP 200, TLS verify clean.
2. **stangri feed + fakeinternet 0.1.4-5:** usign key →
   `/etc/opkg/keys/7ffc7517c4cc0c56`; `src/gz stangri_repo
   https://ipk.mossdef.org` in customfeeds.conf; `opkg install
   fakeinternet` (luci app not in feed — uci-managed). uhttpd +
   dnsmasq-full were already present.
3. **Config:** defaults (google.com/gstatic/apple/firefox/gnome domains,
   subdomains covered) + added: android.com, msftconnecttest.com,
   msftncsi.com, connectivitycheck.samsung.com, connect.rom.miui.com,
   connectivitycheck.platform.hicloud.com (15 policies). Service
   **enabled='0' at home** (its DNAT hijacks ALL LAN port-53/80/443 —
   would break home internet while the uplink exists).
4. **Live-tested (30 s window):** generate_204→204 ✓, Apple→Success ✓,
   HTTPS probe→fast fail ✓, hushfm.dedyn.io unaffected during hijack ✓
   (LAN exclusion), home internet restored after disable ✓.

**PARTY-DAY TOGGLE (when router runs with no uplink):**
```
ssh root@192.168.8.1 "uci set fakeinternet.config.enabled=1; uci commit fakeinternet; /etc/init.d/fakeinternet restart"
# after the party (back home):
ssh root@192.168.8.1 "uci set fakeinternet.config.enabled=0; uci commit fakeinternet; /etc/init.d/fakeinternet restart"
```
(With no uplink there's no harm in leaving it on all night; disable is for
returning the router to home duty.)

Still pending on the router: radio/association-stability hardening (waiting
on the mt76/Flint-2 tuning research + repo notes synthesis); GL-UI-change
retest rule (any save in the GL web UI may rewrite UCI — re-verify DNS
override + fakeinternet after UI changes).

## Proceed plan

1. Do Tier 2 now (base layer; needed anyway as Tier 1's fallback if the
   venue tether dies mid-party).
2. Add Tier 1 at the venue: any guest phone hotspot on USB suffices —
   the allowlist means probe-only traffic (~KB/hour).
3. Print the signage regardless (covers Samsung Intelligent-WiFi + VPN/
   Private-DNS edge cases).
4. Run the airplane-mode matrix at home before the party.
