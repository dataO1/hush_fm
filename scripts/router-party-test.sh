#!/usr/bin/env bash
# ============================================================================
# HushFM — party-mode verification (runs OFFLINE, prints PASS/FAIL)
# ============================================================================
# Claude/internet tools are unavailable while connected to the party network
# (no uplink + probe hijack) — this script is the self-contained verifier.
#
# USAGE:
#   Party test (WAN cable unplugged, router rebooted, laptop on 'hushfm'):
#       ./scripts/router-party-test.sh party
#   Home test (WAN cable back in, waited ~2 min for the watchdog):
#       ./scripts/router-party-test.sh home
#
# 'party' expects: fakeinternet auto-ENABLED by the watchdog, probes spoofed,
#                  app reachable with clean TLS, real internet dead.
# 'home'  expects: fakeinternet auto-DISABLED, real internet back.
# ============================================================================
set -uo pipefail

MODE="${1:-party}"
ROUTER=root@192.168.8.1
DOMAIN=hushfm.dedyn.io
PI_IP=192.168.8.100
PASS=0; FAIL=0

ok()   { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }
check() { # check <description> <expected:0|1 as success> <command...>
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then ok "$desc"; else bad "$desc"; fi
}

echo "== HushFM router test — mode: $MODE =="

# ── router-side state ──────────────────────────────────────────────────────
STATE=$(ssh -o ConnectTimeout=8 "$ROUTER" 'uci -q get fakeinternet.config.enabled' 2>/dev/null || echo "ssh-failed")
if [ "$MODE" = party ]; then
  [ "$STATE" = "1" ] && ok "watchdog auto-ENABLED fakeinternet (state=1)" \
                     || bad "fakeinternet state=$STATE (expected 1 — watchdog did not engage?)"
else
  [ "$STATE" = "0" ] && ok "watchdog auto-DISABLED fakeinternet (state=0)" \
                     || bad "fakeinternet state=$STATE (expected 0 — watchdog did not disengage?)"
fi
echo "  --- recent watchdog log:"
ssh -o ConnectTimeout=8 "$ROUTER" 'logread | grep fakeinternet-auto | tail -3' 2>/dev/null | sed 's/^/      /'

# ── DNS + app (must work in BOTH modes) ────────────────────────────────────
RESOLVED=$(nslookup "$DOMAIN" 192.168.8.1 2>/dev/null | awk '/^Address: /{print $2}' | tail -1)
[ "$RESOLVED" = "$PI_IP" ] && ok "DNS: $DOMAIN -> $PI_IP" || bad "DNS: $DOMAIN -> '$RESOLVED' (expected $PI_IP)"

APP=$(curl -s -o /dev/null -w "%{http_code}:%{ssl_verify_result}" -m 8 "https://$DOMAIN/" 2>/dev/null)
[ "$APP" = "200:0" ] && ok "app: https://$DOMAIN 200 + clean TLS" || bad "app: got '$APP' (expected 200:0)"

if [ "$MODE" = party ]; then
  # ── spoofed probes (what guests' phones will see) ────────────────────────
  P1=$(curl -s -o /dev/null -w "%{http_code}" -m 6 http://connectivitycheck.gstatic.com/generate_204 2>/dev/null)
  [ "$P1" = "204" ] && ok "Android HTTP probe -> 204 (partial->one-tap path)" || bad "Android probe: '$P1' (expected 204)"

  P2=$(curl -s -m 6 http://captive.apple.com/hotspot-detect.html 2>/dev/null)
  echo "$P2" | grep -q "Success" && ok "Apple probe -> Success (iOS validated)" || bad "Apple probe wrong: '$(echo "$P2" | head -c 40)'"

  P3=$(curl -s -m 6 http://detectportal.firefox.com/success.txt 2>/dev/null)
  echo "$P3" | grep -qi "success" && ok "Firefox probe -> success" || bad "Firefox probe wrong: '$P3'"

  P4=$(curl -s -o /dev/null -w "%{http_code}" -m 6 http://connectivitycheck.samsung.com/generate_204 2>/dev/null)
  [ "$P4" = "204" ] || [ "$P4" = "200" ] && ok "Samsung probe answered ($P4)" || bad "Samsung probe: '$P4'"

  # HTTPS probe MUST fail fast in party mode (that is the design)
  if curl -s -o /dev/null -m 6 https://www.google.com/generate_204 2>/dev/null; then
    bad "HTTPS probe unexpectedly SUCCEEDED (uplink still present? cable in?)"
  else
    ok "HTTPS probe fails (expected — no uplink, fast-fail via DNAT)"
  fi
else
  # ── home mode: real internet restored ────────────────────────────────────
  H=$(curl -s -o /dev/null -w "%{http_code}" -m 8 https://www.google.com/generate_204 2>/dev/null)
  [ "$H" = "204" ] && ok "real internet restored (Google 204 over HTTPS)" || bad "internet: '$H' (expected 204)"
fi

echo
echo "== RESULT: $PASS passed, $FAIL failed =="
[ $FAIL -eq 0 ] && echo "ALL GOOD ✅" || echo "CHECK FAILURES ABOVE ❌ (recovery: ./scripts/router-recover.sh)"
exit $FAIL
