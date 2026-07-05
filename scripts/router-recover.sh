#!/usr/bin/env bash
# Emergency recovery for the Flint 2 after fakeinternet locked the LAN.
# Run from the laptop WHILE CONNECTED TO THE 'hushfm' WIFI (192.168.8.x).
#
# What happened (2026-07-05): the first fakeinternet-auto watchdog used
# HOSTNAME-based connectivity checks — but fakeinternet hijacks the router's
# own DNS too, so once enabled it could never see the uplink again and kept
# itself on (deadlock). This script removes the watchdog, disables
# fakeinternet, and brings the WAN back up.
set -euo pipefail

ROUTER=root@192.168.8.1

ssh -o ConnectTimeout=10 "$ROUTER" '
  # 1. Remove the (buggy) auto-toggle watchdog so nothing re-enables it
  sed -i "/fakeinternet-auto/d" /etc/crontabs/root
  /etc/init.d/cron restart
  rm -f /etc/hotplug.d/iface/99-fakeinternet-auto
  # 2. Disable the probe hijack (DNS + DNAT back to normal)
  uci set fakeinternet.config.enabled=0
  uci commit fakeinternet
  /etc/init.d/fakeinternet restart
  # 3. Bring the WAN back up (was ifdown-ed during testing)
  ifup wan
  sleep 12
  # 4. Report
  echo "fakeinternet enabled=$(uci get fakeinternet.config.enabled)"
  ping -c1 -W3 8.8.8.8 >/dev/null 2>&1 && echo "router WAN: OK" || echo "router WAN: STILL DOWN (check cable/ISP)"
'

echo "--- laptop-side check:"
sleep 2
curl -s -o /dev/null -w "internet via hushfm: HTTP %{http_code} (204 = real Google, all good)\n" \
  -m 8 https://www.google.com/generate_204 || echo "internet check failed — is the laptop on the hushfm WiFi?"
