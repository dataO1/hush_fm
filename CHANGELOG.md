# Changelog

All notable changes to HushFM will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Complete UI Cleanup with DaisyUI Integration**
  - Minimal Landing page with DaisyUI cards for room creation/joining
  - Streamlined DJ Room with device selection and essential controls
  - Clean Listener Room with volume control and live visualization
  - Professional monochrome theme using DaisyUI "business" theme

- **Modern Audio Visualization**
  - Real-time waveform display using webaudio-oscilloscope package
  - Clean oscilloscope-style visualization replacing frequency bars
  - TypeScript-compatible audio visualization with proper build support
  - Canvas-based rendering with DaisyUI color theming

- **Production-Ready Build System**
  - Zero TypeScript compilation errors with proper type handling
  - Optimized production build (403KB → 100KB gzipped)
  - Compatible module imports for modern build tools
  - Removed 300+ lines of custom CSS in favor of DaisyUI

- **Essential Feature Preservation**
  - Device selection for DJ microphone input using DaisyUI select
  - Volume controls with DaisyUI range sliders
  - Mute/unmute functionality with SVG icons
  - Status indicators using DaisyUI badges

### Fixed
- **Audio Visualization Package Issues**
  - Replaced problematic oscilloscope package with webaudio-oscilloscope
  - Resolved CommonJS/ESM module compatibility issues
  - Fixed production build failures with proper package integration
  - Eliminated TypeScript declaration file errors

- **Component Architecture Cleanup**
  - Removed redundant components (AudioLevelMeter, MicControls, VolumeControls)
  - Integrated essential functionality directly into page components
  - Proper state management with SolidJS reactive patterns
  - WebRTC lifecycle management with Effect-TS

### Changed
- **Complete UI Framework Migration**
  - Replaced custom CSS with DaisyUI component library
  - Migrated from glass-morphism to clean monochrome design
  - Removed all emojis and non-essential text for professional appearance
  - Simplified component hierarchy and removed unused abstractions

- **Build System Optimization**
  - Updated Vite configuration for DaisyUI and Tailwind integration
  - Removed CommonJS-specific build configurations
  - Optimized bundle size with tree shaking and modern modules
  - Improved TypeScript compilation performance

### Removed
- **Legacy Components and Styling**
  - Deleted 300+ lines of custom CSS animations and effects
  - Removed bar-based AudioVisualizer in favor of waveform display
  - Eliminated redundant shared components and abstractions
  - Cleaned up unused dependencies and dead code

### Technical Implementation
- **DaisyUI Component Migration**:
  - `Landing.tsx`: DaisyUI cards, inputs, and buttons
  - `DJRoom.tsx`: Streamlined with essential controls only
  - `ListenerRoom.tsx`: Clean volume control with range slider
  - `DeviceSelector.tsx`: DaisyUI select dropdown for microphone choice

- **Audio Visualization Upgrade**:
  - `WaveformVisualizer.tsx`: Real-time oscilloscope using webaudio-oscilloscope
  - Canvas-based rendering with proper cleanup
  - TypeScript compatibility with CommonJS import handling

## [0.2.0] - 2025-12-06

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