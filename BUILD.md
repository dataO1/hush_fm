# HushFM Build Instructions

This project uses a hybrid Nix + Cargo build approach.

> **⚠ NO CROSS-COMPILATION.** Cross-compiling the backend for the Pi (aarch64)
> from x86_64 was attempted and never worked (mediasoup's C++ worker build
> breaks under cross toolchains). **The backend is always built natively on
> the machine it runs on** — for the Pi, that means building ON the Pi.

## Prerequisites

- Nix with flakes enabled
- Git

## Development Workflow (x86_64 dev machine)

```bash
# Enter development shell (direnv does this automatically)
nix develop

# Build backend (native)
cd backend
cargo build --release

# Package with Nix (wraps the locally built binary)
nix build .#hushfm-backend
```

## Frontend Development

```bash
cd frontend
npm install
npm run dev          # dev server
npm run build        # production build
npm run type-check
```

## Raspberry Pi (build ON the Pi)

```bash
# On the Pi:
git clone <repo> hush_fm && cd hush_fm     # or git pull / switch branch
nix develop

cd backend
# Optional Pi optimization — enables NEON, VFPv4, CRC32 on Pi 4:
RUSTFLAGS="-C target-cpu=native" cargo build --release

# Binary lands at ./backend/target/release/server (native, same as x86_64)
```

Then rebuild the system so the NixOS module (`nixosModules.hushfm` in
`flake.nix`) picks up the new binary, frontend, nginx, and cert config:

```bash
sudo nixos-rebuild switch --flake <the Pi's system flake>
```

See `docs/https-setup.md` for the certificate/DNS parts of deployment.

## Available Packages

- `hushfm-backend` — wraps the natively built `./backend/target/release/server`
  of the current machine (fails with a hint if you haven't run
  `cargo build --release` yet)
- `hushfm-frontend` — SolidJS frontend (buildNpmPackage)

## Build Validation

```bash
ls -la backend/target/release/server
```
