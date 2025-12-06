# Changelog

All notable changes to HushFM will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial project structure with Rust backend and SolidJS frontend
- Nix flake for reproducible development environment with Python 3.11
- Axum web framework with WebSocket support for real-time communication
- Mediasoup integration for WebRTC functionality (v0.20)
- Basic room creation and listing REST API
- WebSocket handlers for DJ control and lobby updates
- SolidJS frontend with Effect-TS for robust control flow
- Landing page with real-time room list and creation interface
- DJ control panel with audio device selection
- Listener room interface with waiting states
- OpenAPI documentation with utoipa integration

### WebRTC Implementation (Local Network)
- Complete WebRTC transport management for local WiFi networks
- Audio producer creation with Opus codec support (48kHz stereo)
- Consumer management for listeners with automatic transport creation
- Simplified connection flow without ICE negotiation for local network
- Real transport options generation for client connections
- DTLS-only security for local network communication
- Atomic room publication with WebRTC resources (router + producer required)

### Enhanced State Management
- Arc<RwLock<RoomState>> for thread-safe room management
- Multiple broadcast channels (lobby, room-specific, system events)
- Producer and consumer lifecycle tracking
- Real-time event broadcasting for streaming state changes
- Activity-based room cleanup and resource management
- Enhanced room status tracking (Setup → Live → Paused → Closing)

### Technical Implementation
- DashMap for concurrent room state management
- Atomic room publication pattern (rooms appear only when ready)
- WebSocket-based stream control (start/stop without REST)
- Effect-TS programs for async orchestration
- Proper error handling with anyhow and thiserror
- Local network transport with automatic IP detection
- Arc-swap for atomic timestamp updates
- tokio::sync::broadcast for multi-channel event distribution

### Fixed
- Mediasoup build issues with Python 3.13 SafeConfigParser removal
- Ninja version detection in meson build system
- RtpCodecCapability imports using correct mediasoup::prelude API
- WebRTC codec configuration with proper NonZero types
- Build system compatibility with NixOS environment
- WebRTC transport API compatibility issues with mediasoup v0.20
- Producer and consumer lifecycle management without deprecated methods
- MIME type checking using accessor methods instead of direct field access
- Local network transport configuration with proper IP binding

### Changed
- Updated mediasoup to v0.20 for latest WebRTC features
- Room state model enhanced with WebRTC resource tracking
- DJ streaming state handled via WebSocket events instead of REST endpoints
- Moved from manual dependency management to fully declarative Nix setup
- Room creation now initializes full WebRTC infrastructure (router + transport)
- API responses include real transport options instead of placeholder data
- Enhanced error handling for WebRTC operations with detailed error messages
- Room visibility tied to actual producer availability (atomic publication)

### Architecture Decisions
- Chose atomic room creation over multi-step setup for reliability
- WebSocket for stream control, REST for resource management
- Producer persistence across pause/resume for performance
- Effect-TS for composable error handling and async flows
- Local network optimization (no ICE/STUN/TURN) for WiFi-only deployment
- Simplified security model with DTLS-only for trusted local environment
- Multi-channel broadcast system for different event types
- Arc<RwLock<>> pattern for fine-grained concurrent access control

### Files Modified
- **New**: `src/webrtc/transport.rs` - Local network transport management
- **New**: `src/webrtc/producer.rs` - Audio producer lifecycle  
- **New**: `src/webrtc/consumer.rs` - Consumer management for listeners
- **New**: `src/state/room.rs` - Enhanced room state with WebRTC resources
- **New**: `src/state/broadcast.rs` - Multi-channel event broadcasting
- **Modified**: `src/webrtc/mod.rs` - WebRTC module exports and initialization
- **Modified**: `src/state/mod.rs` - Enhanced state management integration
- **Modified**: `src/ws/mod.rs` - WebRTC message handling
- **Modified**: `src/api/rooms.rs` - Real transport creation
- **Modified**: `src/models/mod.rs` - WebRTC message types
- **Modified**: `Cargo.toml` - Enhanced state management dependencies

## [0.1.0] - 2025-12-06

### Initial Release
- Project skeleton created with rust-rewrite branch
- Technical specification documented in README.md
- Basic API structure defined following atomic room publication pattern
- WebRTC integration started with mediasoup
- Development environment established with Nix flakes

### Development Environment
- Rust toolchain with cargo-watch and rust-analyzer
- Node.js 20+ with pnpm for frontend dependencies
- Python 3.11 for mediasoup C++ build compatibility
- Full reproducible builds via Nix with direnv integration

### Core Technologies
- **Backend**: Rust + Axum + Mediasoup + OpenAPI (utoipa)
- **Frontend**: SolidJS + Effect-TS + Mediasoup Client + Vite
- **Build System**: Nix flakes + direnv for reproducibility
- **State**: DashMap + tokio::sync for concurrent access