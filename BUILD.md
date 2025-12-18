# HushFM Build Instructions

This project uses a hybrid Nix + Cargo build approach for cross-platform support.

## Prerequisites

- Nix with flakes enabled
- Git

## Development Workflow

### 1. Native x86_64 Development

```bash
# Enter development shell
nix develop

# Build backend (native)
cd backend
cargo build --release

# Package with Nix
nix build .#hushfm-backend-x86_64
```

### 2. Cross-Compilation for ARM64 (Raspberry Pi)

```bash
# Enter cross-compilation shell
nix develop .#cross-aarch64

# Build backend for ARM64
cd backend
cargo build --release --target aarch64-unknown-linux-gnu

# Package with Nix
nix build .#hushfm-backend-aarch64
```

### 3. Frontend Development

```bash
# Frontend-only shell
nix develop .#frontend

# Build frontend
cd frontend
pnpm install
pnpm build
```

## Available Packages

- `hushfm-backend` - Native backend for current architecture
- `hushfm-backend-x86_64` - x86_64 backend binary
- `hushfm-backend-aarch64` - ARM64 backend binary (for Raspberry Pi)
- `hushfm-frontend` - SolidJS frontend

## Available Development Shells

- `default` - Native development with cross-compilation tools
- `cross-aarch64` - ARM64 cross-compilation environment
- `frontend` - Frontend-only development

## Architecture Detection

The build system automatically detects your architecture and selects the appropriate binary path:

- x86_64: `./backend/target/release/server`
- aarch64: `./backend/target/aarch64-unknown-linux-gnu/release/server`

## Build Validation

Before packaging, ensure binaries exist:

```bash
# Check native build
ls -la backend/target/release/server

# Check cross-compiled build  
ls -la backend/target/aarch64-unknown-linux-gnu/release/server
```

## Deployment

### Direct Binary

```bash
# Copy binary to target system
scp result/bin/server pi@raspberrypi:/home/pi/hushfm-backend
```

### NixOS System

See `nixos-module.nix` for system service configuration.

## Key Features

- ✅ **Cross-compilation support** - Build for ARM64 from x86_64
- ✅ **Vendored OpenSSL** - Avoids system library mismatches  
- ✅ **Architecture detection** - Automatic binary path selection
- ✅ **Simple packaging** - Just references pre-built binaries
- ✅ **Clean separation** - Nix provides toolchain, Cargo handles build