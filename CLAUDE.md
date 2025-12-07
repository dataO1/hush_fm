# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HushFM is a live audio streaming platform being rewritten from Python to Rust. The architecture follows a clean separation between backend (Rust + Axum + Mediasoup) and frontend (SolidJS + Effect-TS + Mediasoup Client).

## Architecture

### Backend (Rust)
- **Stack**: Rust, Axum web framework, Mediasoup for WebRTC
- **Core Pattern**: Atomic Room Publication - rooms only appear publicly after DJ successfully establishes WebRTC transport and creates a Producer
- **State Management**: Enhanced with Arc<RwLock<RoomState>>, DashMap, and multi-channel broadcasting
- **Network**: Local WiFi optimization (empty ICE servers), WebRTC with DTLS security

### Frontend (SolidJS + Effect-TS)
- **Stack**: SolidJS, Effect-TS 3.0, Mediasoup Client, Orval (OpenAPI generation)
- **State Management**: Fine-grained reactivity with signals/stores, NO destructuring before use
- **Error Handling**: Effect-TS pipe patterns with centralized error recovery
- **Type Safety**: End-to-end from backend OpenAPI to frontend with Orval generation

### Key Framework Decisions

#### SolidJS Patterns (2024-2025)
- **Signals for Primitives**: `const [value, setValue] = createSignal(initial)`
- **Stores for Objects**: `const [store, setStore] = createStore({})`
- **Fine-grained Updates**: Access store properties directly, avoid destructuring
- **Context API**: Use for global state sharing without props drilling
- **Lazy Creation**: Signals created on-demand for optimal performance

#### Effect-TS 3.0 Patterns
- **Pipe Composition**: `pipe(Effect.succeed(value), Effect.andThen(fn), Effect.catchAll(handler))`
- **Error Channel Operations**: Centralized error handling with recovery strategies
- **Resource Management**: Automatic cleanup with finalizers and interruption
- **Type Safety**: Full type inference through pipe chains

#### OpenAPI Integration
- **Orval**: Auto-generate TypeScript clients from backend OpenAPI spec
- **Custom Mutator**: Effect-TS wrapper for fetch operations
- **Type Validation**: Runtime validation with compile-time guarantees
- **Real-time Updates**: Combine REST (Orval) + WebSocket (manual) for full coverage

### Key Invariants
- Public rooms ALWAYS have a valid router and audio_producer
- DJ must complete full publish sequence before room becomes visible
- Stream control uses pause/resume (not close/reopen) for performance
- Frontend state is event-driven with fine-grained reactivity
- All async operations wrapped in Effect for composable error handling

## Development Commands

### Backend (Rust)
- `cargo check` - Type checking and basic compilation
- `cargo run` - Run the backend server
- `cargo test` - Run tests

### Frontend (TypeScript/SolidJS)
- `npm run dev` - Start development server
- `npm run generate:api` - Generate OpenAPI client with Orval
- `npm run dev:api` - Watch mode for API generation
- `npm run build` - Production build
- `npm run type-check` - TypeScript type checking

### Development Environment
- Nix flake setup (`.envrc` indicates direnv/nix usage)
- Python 3.11 for mediasoup build compatibility

## Project Structure

This is currently a blank slate for the rust-rewrite branch. The technical specification in README.md defines the target architecture for:

1. **Room State Management**: Setup vs Public status with mandatory producers
2. **WebRTC Flow**: Atomic publication pattern for reliability  
3. **Stream Control**: Pause/resume without connection teardown
4. **Error Handling**: Effect-based error handling with cleanup sequences

## Notes for Implementation

### Backend
- Follow the atomic room publication pattern described in README.md
- Use Arc<RwLock<RoomState>> for thread-safe state management
- Implement proper cleanup on publish failures (AbortRoom command)
- Maintain the invariant that public rooms always have active audio producers
- Local network optimization (empty ICE servers configuration for WebRTC)

### Frontend
- **CRITICAL**: Never destructure store properties before use (breaks reactivity)
- Use Effect-TS pipe patterns for all async operations
- Wrap mediasoup-client with reactive signals for state updates
- Generate API clients with Orval from backend OpenAPI spec
- Implement proper error boundaries with Effect error handling
- Use Context API for global state sharing
- Keep UI components pure (presentation only)