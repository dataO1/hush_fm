# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HushFM is a live audio streaming platform being rewritten from Python to Rust. The architecture follows a clean separation between backend (Rust + Axum + Mediasoup) and frontend (SolidJS + Effect-TS + Mediasoup Client).

## Architecture

### Backend (Rust)
- **Stack**: Rust, Axum web framework, Mediasoup for WebRTC
- **Core Pattern**: Atomic Room Publication - rooms only appear publicly after DJ successfully establishes WebRTC transport and creates a Producer
- **State Management**: Rooms have Setup → Public lifecycle with guaranteed audio producer for public rooms

### Frontend (SolidJS)
- **Stack**: SolidJS, Effect-TS for control flow, Mediasoup Client
- **DJ Flow**: Linear Effect sequence (PublishRoomFlow) - init → transport → media → produce
- **Listener Flow**: Instant join (JoinRoomFlow) since rooms are guaranteed to have active streams

### Key Invariants
- Public rooms ALWAYS have a valid router and audio_producer
- DJ must complete full publish sequence before room becomes visible
- Stream control uses pause/resume (not close/reopen) for performance

## Development Commands

Since this is a fresh rewrite, build/test commands will be established as the codebase develops. Check for:
- `Cargo.toml` for Rust backend commands
- `package.json` for frontend commands
- Nix flake setup (`.envrc` indicates direnv/nix usage)

## Project Structure

This is currently a blank slate for the rust-rewrite branch. The technical specification in README.md defines the target architecture for:

1. **Room State Management**: Setup vs Public status with mandatory producers
2. **WebRTC Flow**: Atomic publication pattern for reliability  
3. **Stream Control**: Pause/resume without connection teardown
4. **Error Handling**: Effect-based error handling with cleanup sequences

## Notes for Implementation

- Follow the atomic room publication pattern described in README.md
- Use Effect-TS for frontend control flow and error handling
- Implement proper cleanup on publish failures (AbortRoom command)
- Maintain the invariant that public rooms always have active audio producers