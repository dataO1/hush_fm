#!/usr/bin/env bash
# ============================================================================
# HushFM live party diagnosis — run on the LAPTOP connected to the party WiFi.
# No internet needed. Gathers Pi + router + network state into ONE log file
# to send back for analysis of audio/streaming problems (e.g. choppy audio).
#
# USAGE:  ./scripts/diagnose-party.sh
#         # ...let it run ~30s, then send the printed log file back.
#
# Optionally reproduce the problem WHILE it runs (join as a listener, play
# audio) so the logs capture the glitch window.
# ============================================================================
PI=data01@192.168.8.100
ROUTER=root@192.168.8.1
SSH="ssh -o ConnectTimeout=8 -o BatchMode=yes"
OUT="hushfm-diag-$(date +%Y%m%d-%H%M%S).log"

# Everything below is tee'd to the log file.
exec > >(tee "$OUT") 2>&1

sec() { echo; echo "==================== $* ===================="; }
run() { echo "\$ $*"; "$@" 2>&1; echo; }

echo "HushFM party diagnosis — $(date)"
echo "laptop: $(hostname 2>/dev/null)"

sec "0. NETWORK PATH (laptop -> pi/router/app)"
run ip route
run ping -c3 -W2 192.168.8.100
run ping -c3 -W2 192.168.8.1
run getent hosts hushfm.dedyn.io
run nslookup hushfm.dedyn.io 192.168.8.1
curl -sk -o /dev/null -w "app via LAN DNS: HTTP %{http_code} TLS %{ssl_verify_result} connect %{time_connect}s total %{time_total}s\n" \
  --resolve hushfm.dedyn.io:443:192.168.8.100 https://hushfm.dedyn.io/ 2>&1

sec "1a. PI: backend config table (bitrate/frame + the LATENCY buffers)"
# Ring Buffer + Audio Buffer Size are the audio-bot's extra latency vs browser.
$SSH $PI 'journalctl -u hushfm-backend --no-pager 2>/dev/null | grep -E "Opus (Bitrate|Complexity|FEC|VBR|Frame)|Packet Loss|Buffer Size|Ring Buffer|Thread Priority" | tail -12'

sec "1b. PI: audio-bot capture device (Scarlett) — WHAT cpal actually opened"
# The backend logs the selected device name, channel count and sample rate.
$SSH $PI 'journalctl -u hushfm-backend --since "40 min ago" --no-pager 2>/dev/null | grep -iE "audio bot|device|channel|sample.?rate|cpal|capture|WaitingForDevice|Running|Initializing|DeviceError|usb|Encoder configured" | tail -50'

sec "2. PI: THE CHOPPINESS SIGNALS — drops / timeouts / xruns / buffer"
echo "--- DirectProducer send-timeout drops (each = a dropped audio packet):"
$SSH $PI 'journalctl -u hushfm-backend --since "40 min ago" --no-pager 2>/dev/null | grep -c "DirectProducer send timeout"'
echo "--- recent drop/timeout/buffer/underrun/error lines:"
$SSH $PI 'journalctl -u hushfm-backend --since "40 min ago" --no-pager 2>/dev/null | grep -iE "timeout|drop|underrun|overrun|xrun|starv|lag|behind|buffer full|buffer empty|error|warn|fail|reconnect|disconnect|silence" | tail -80'

sec "3. PI: ALSA view of the Scarlett (sample rate / channels / format)"
$SSH $PI 'arecord -l 2>&1; echo "--- hw params per card:"; for c in $(arecord -l 2>/dev/null | sed -n "s/^card \([0-9]*\):.*/\1/p" | sort -u); do echo "== card $c =="; arecord -D hw:$c,0 --dump-hw-params 2>&1 | grep -iE "^RATE|^CHANNELS|^FORMAT|^PERIOD_SIZE|^BUFFER_SIZE"; done'

sec "4. PI: USB / kernel audio messages (disconnects, xruns, rate changes)"
$SSH $PI 'sudo dmesg -T 2>/dev/null | grep -iE "usb|scarlett|focusrite|snd|xrun|underrun|rate|disconnect|reset" | tail -40 || dmesg 2>/dev/null | tail -40'

sec "5. PI: CPU / THERMAL / LOAD (throttle = glitchy encode)"
$SSH $PI 'for v in measure_temp get_throttled measure_clock arm; do echo -n "$v: "; vcgencmd $v 2>/dev/null || echo "(vcgencmd unavailable)"; done
echo "cur freqs:"; cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq 2>/dev/null
echo "governor: $(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null)"
uptime; echo "--- mem:"; free -m | head -2
echo "--- top CPU procs:"; ps -eo pcpu,pid,comm --sort=-pcpu 2>/dev/null | head -8'

sec "6. PI: service + mediasoup worker + room/consumer state"
$SSH $PI 'systemctl is-active hushfm-backend; echo "--- mediasoup/worker/room lines:"; journalctl -u hushfm-backend --since "40 min ago" --no-pager 2>/dev/null | grep -iE "worker|consumer|producer created|room .*(live|public)|listener|transport|ice|dtls" | tail -40'

sec "7. ROUTER: WiFi radios + associated listeners + airtime"
$SSH $ROUTER 'for i in ra0 rax0; do echo "== $i =="; iwinfo $i info 2>/dev/null | grep -iE "ESSID|Channel|Bit Rate|Tx-Power|Signal|HT Mode"; echo "stations:"; iwinfo $i assoclist 2>/dev/null | grep -iE "dBm|expected|SNR|inactive|Rx:|Tx:" | head -30; done'

sec "8. ROUTER: fakeinternet + DNS state"
$SSH $ROUTER 'echo "fakeinternet enabled=$(uci -q get fakeinternet.config.enabled)"; nslookup hushfm.dedyn.io 127.0.0.1 2>&1 | tail -3; echo "recent watchdog:"; logread 2>/dev/null | grep fakeinternet-auto | tail -2'

sec "DONE"
echo "Log written to:  $OUT"
echo "Send that file back for analysis."
