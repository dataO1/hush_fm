#!/usr/bin/env bash
# ============================================================================
# HushFM — one-shot deploy to the Pi (run from the laptop on the party network)
# ============================================================================
# Pushes the latest code, rebuilds the backend NATIVELY on the Pi (nixos-rebuild
# does NOT compile the Rust — cargo does), bumps the system flake, switches, and
# restarts. Verifies the service came up and prints the live audio config.
#
# Usage:  ./scripts/deploy-pi.sh
#
# Assumes: laptop on the 192.168.8.x network, ssh keys to data01@192.168.8.100
# (Pi) and the Pi's git remotes (Projects/hush_fm + /etc/nixos) set up.
# ============================================================================
set -uo pipefail
PI=data01@192.168.8.100
HUSH=/home/data01/Projects/hush_fm
NIXOS=/home/data01/Projects/rpi4-nixos
BRANCH=party-fixes

step() { echo; echo "==> $*"; }

step "0. Pi reachable?"
ping -c1 -W2 192.168.8.100 >/dev/null 2>&1 || { echo "Pi not reachable — are you on the party WiFi?"; exit 1; }

step "1. push app code to the Pi's clone"
git -C "$HUSH" push "$PI:Projects/hush_fm" "$BRANCH:$BRANCH"

step "2. build the backend natively on the Pi (~6 min)"
ssh "$PI" 'cd ~/Projects/hush_fm && nix develop --command bash -c "cd backend && cargo build --release 2>&1 | tail -3"' \
  || { echo "BACKEND BUILD FAILED — aborting"; exit 1; }

step "3. bump the system flake lock to the new app commit"
( cd "$NIXOS" && nix flake update hush && git commit -aqm "lock: deploy $(git -C "$HUSH" rev-parse --short "$BRANCH")" \
  && git push -q origin main 2>/dev/null; git push -q "$PI:/etc/nixos" main )

step "4. rebuild + restart on the Pi"
ssh "$PI" 'sudo nixos-rebuild switch --flake /etc/nixos#hushfm 2>&1 | tail -2 && sudo systemctl restart hushfm-backend.service && sleep 4 && echo "backend: $(systemctl is-active hushfm-backend)"'

step "5. live audio config (verify the deployed settings)"
ssh "$PI" 'journalctl -u hushfm-backend --since "20 sec ago" | grep -E "Opus (Bitrate|Complexity|FEC|Frame)|Packet Loss|Ring Buffer|pipewire" | tail -8'

echo
echo "Deploy done. Plug in the Scarlett, play audio, then ./scripts/diagnose-party.sh"
