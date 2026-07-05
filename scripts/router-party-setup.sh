#!/usr/bin/env bash
# ============================================================================
# HushFM — Flint 2 (GL-MT6000) party-ready setup
# ============================================================================
# Makes a (possibly factory-reset) GL.iNet Flint 2 fully party-ready in one
# run. Idempotent: safe to re-run; every step checks before changing.
#
# Run FROM THE LAPTOP while connected to the router's WiFi/LAN:
#   ./scripts/router-party-setup.sh
#
# Prerequisites (one-time, after a factory reset):
#   - Set the admin password in the GL UI wizard (SSH root password = it)
#   - ssh-copy-id root@192.168.8.1
#   - Router needs internet ONCE for the fakeinternet package install
#
# What it configures (each verified live on the router 2026-07-05; see
# docs/offline-router-connectivity.md for the research + post-mortems):
#   1. DNS: hushfm.dedyn.io -> Pi (persistent uci; /etc/dnsmasq.d is tmpfs)
#   2. fakeinternet: spoofs OS connectivity probes (Android partial->one-tap
#      -then-validated path; iOS fully clean). Installed from stangri's feed,
#      config extended with Samsung/Microsoft/Xiaomi/Huawei domains.
#   3. Watchdog: auto-enables fakeinternet when the uplink is gone (party),
#      auto-disables when it is back (home). IP-LITERAL pings only — the
#      router's own DNS is hijacked while enabled; hostname checks deadlock
#      (2026-07-05 lockout post-mortem, see scripts/router-recover.sh).
#   4. Radio hardening for 30-80 phones streaming WebRTC audio:
#      - 5 GHz carries the primary SSID 'hushfm' (humans join the clean
#        name), FIXED channel 36, HE80 (never auto/ACS: a mid-party channel
#        change = mass reassociation = Android revalidation storm)
#      - 2.4 GHz demoted to fallback SSID 'hushfm-24', fixed channel 6
#      - 802.11k/BSS-transition OFF (steering roams re-run Android's
#        captive validation)
#      - dtim 1, max_inactivity 3600, disassoc_low_ack 0, maxassoc 100
#        (fewer forced reassociations of dozing phones)
#      - deliberately NOT touched: MAC retries + A-MPDU stay ON (they are
#        sub-ms and prevent 5-30% loss; disabling would hurt — research)
#
# QUIRK: this GL firmware uses MediaTek's proprietary driver — `wifi reload`
# does NOT apply wireless changes; only a REBOOT does. The script offers one
# at the end when wireless changed.
#
# After any change in the GL WEB UI: re-run this script (the UI rewrites
# UCI files) and reboot.
# ============================================================================
set -euo pipefail

ROUTER=root@192.168.8.1
PI_IP=192.168.8.100
DOMAIN=hushfm.dedyn.io

echo "== HushFM router party setup =="
ssh -o ConnectTimeout=10 "$ROUTER" PI_IP="$PI_IP" DOMAIN="$DOMAIN" 'sh -s' << 'REMOTE'
set -e
CHANGED_WIRELESS=0

# ── 1. DNS override: hushfm.dedyn.io -> Pi ─────────────────────────────────
if ! uci -q get dhcp.@dnsmasq[0].address | grep -q "$DOMAIN"; then
  uci add_list dhcp.@dnsmasq[0].address="/$DOMAIN/$PI_IP"
  uci commit dhcp
  /etc/init.d/dnsmasq restart
  echo "[1] DNS override ADDED"
else
  echo "[1] DNS override present"
fi

# ── 2. fakeinternet: feed key, feed, package ───────────────────────────────
if ! opkg list-installed 2>/dev/null | grep -q '^fakeinternet'; then
  printf 'untrusted comment: OpenWrt usign key of Stan Grishin\nRWR//HUXxMwMVnx7fESOKO7x8XoW4/dRidJPjt91hAAU2L59mYvHy0Fa\n' \
    > /etc/opkg/keys/7ffc7517c4cc0c56
  sed -i '/stangri_repo/d' /etc/opkg/customfeeds.conf
  echo 'src/gz stangri_repo https://ipk.mossdef.org' >> /etc/opkg/customfeeds.conf
  opkg update >/dev/null 2>&1
  opkg install fakeinternet
  echo "[2] fakeinternet INSTALLED"
else
  echo "[2] fakeinternet present"
fi

# Extra probe domains beyond the package defaults (defaults already cover
# google.com/gstatic.com/apple.com/firefox/gnome incl. all subdomains).
# NOTE: never use the '#' catch-all — it would swallow hushfm.dedyn.io.
for d in android.com msftconnecttest.com msftncsi.com \
         connectivitycheck.samsung.com connect.rom.miui.com \
         connectivitycheck.platform.hicloud.com; do
  if ! uci -q show fakeinternet | grep -q "address='$d'"; then
    uci add fakeinternet policy >/dev/null
    uci set fakeinternet.@policy[-1].address="$d"
    uci set fakeinternet.@policy[-1].action='fake'
    echo "[2] policy added: $d"
  fi
done
uci commit fakeinternet

# ── 3. Watchdog: auto-toggle by uplink (IP-literal checks ONLY) ────────────
cat > /usr/bin/fakeinternet-auto << 'EOF'
#!/bin/sh
# Auto-toggle fakeinternet based on real uplink availability.
# Party (no uplink) -> enable probe spoofing; home (uplink) -> disable.
# CRITICAL: the check uses IP LITERALS ONLY. fakeinternet hijacks the
# router's own DNS, so hostname-based checks deadlock in the enabled
# state (2026-07-05 post-mortem). ICMP to hardcoded IPs bypasses both the
# DNS hijack and the LAN-only DNAT.
# Test override: FAKEINTERNET_TEST_TARGETS="203.0.113.1" simulates offline.
TARGETS="${FAKEINTERNET_TEST_TARGETS:-8.8.8.8 1.1.1.1}"
STATE=$(uci -q get fakeinternet.config.enabled)
ONLINE=0
for ip in $TARGETS; do
  ping -c1 -W3 "$ip" >/dev/null 2>&1 && { ONLINE=1; break; }
done
if [ "$ONLINE" = "1" ] && [ "$STATE" != "0" ]; then
  uci set fakeinternet.config.enabled=0; uci commit fakeinternet
  /etc/init.d/fakeinternet restart
  logger -t fakeinternet-auto "uplink detected -> fakeinternet DISABLED"
elif [ "$ONLINE" = "0" ] && [ "$STATE" != "1" ]; then
  uci set fakeinternet.config.enabled=1; uci commit fakeinternet
  /etc/init.d/fakeinternet restart
  logger -t fakeinternet-auto "no uplink -> fakeinternet ENABLED (party mode)"
fi
EOF
chmod +x /usr/bin/fakeinternet-auto
cat > /etc/hotplug.d/iface/99-fakeinternet-auto << 'EOF'
[ "$INTERFACE" = "wan" ] && { sleep 5; /usr/bin/fakeinternet-auto; }
EOF
grep -q fakeinternet-auto /etc/crontabs/root 2>/dev/null \
  || echo "*/2 * * * * /usr/bin/fakeinternet-auto" >> /etc/crontabs/root
/etc/init.d/cron restart
echo "[3] watchdog installed (cron every 2 min + wan hotplug)"

# ── 4. Radio hardening ─────────────────────────────────────────────────────
set_w() { # set_w <uci-key> <value>
  if [ "$(uci -q get "$1")" != "$2" ]; then
    uci set "$1=$2"; CHANGED_WIRELESS=1; echo "[4] $1 -> $2"
  fi
}
# 5 GHz = primary, clean name, fixed channel (radio: mt798612, iface: wifi5g)
set_w wireless.wifi5g.ssid            'hushfm'
set_w wireless.mt798612.channel       '36'
set_w wireless.mt798612.htmode        'HE80'
set_w wireless.wifi5g.ieee80211k      '0'
set_w wireless.wifi5g.bss_transition  '0'
set_w wireless.wifi5g.dtim_period     '1'
set_w wireless.wifi5g.max_inactivity  '3600'
set_w wireless.wifi5g.disassoc_low_ack '0'
set_w wireless.wifi5g.maxassoc        '100'
# 2.4 GHz = fallback, demoted name, fixed channel
set_w wireless.wifi2g.ssid            'hushfm-24'
set_w wireless.mt798611.channel       '6'
set_w wireless.wifi2g.ieee80211k      '0'
set_w wireless.wifi2g.bss_transition  '0'
uci commit wireless

# ── 5. Report ──────────────────────────────────────────────────────────────
echo "── state ──"
echo "dns:          $(uci -q get dhcp.@dnsmasq[0].address)"
echo "fakeinternet: enabled=$(uci -q get fakeinternet.config.enabled) ($(uci -q show fakeinternet | grep -c policy) policies)"
echo "5g:  ssid=$(uci -q get wireless.wifi5g.ssid) ch=$(uci -q get wireless.mt798612.channel)"
echo "2g:  ssid=$(uci -q get wireless.wifi2g.ssid) ch=$(uci -q get wireless.mt798611.channel)"
[ "$CHANGED_WIRELESS" = "1" ] && echo "WIRELESS_CHANGED" || true
REMOTE

echo
echo "== laptop-side verification =="
sleep 2
nslookup "$DOMAIN" 192.168.8.1 | grep -A1 "^Name" || echo "DNS check failed"
curl -s -o /dev/null -w "app via LAN DNS: HTTP %{http_code}, TLS verify %{ssl_verify_result}\n" -m 8 "https://$DOMAIN/" || true

echo
echo "NOTE: if any '[4] ...' line appeared above, wireless changed —"
echo "      the MTK driver only applies wireless via REBOOT:"
echo "      ssh $ROUTER reboot"
