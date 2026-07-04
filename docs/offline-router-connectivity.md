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

## Proceed plan

1. Do Tier 2 now (base layer; needed anyway as Tier 1's fallback if the
   venue tether dies mid-party).
2. Add Tier 1 at the venue: any guest phone hotspot on USB suffices —
   the allowlist means probe-only traffic (~KB/hour).
3. Print the signage regardless (covers Samsung Intelligent-WiFi + VPN/
   Private-DNS edge cases).
4. Run the airplane-mode matrix at home before the party.
