# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HushFM is a live audio streaming platform with a Rust backend and SolidJS frontend. The architecture follows a clean separation between backend (Rust + Axum + Mediasoup) and frontend (SolidJS + Effect-TS + Mediasoup Client).

## Architecture

### Backend (Rust)
- **Stack**: Rust, Axum web framework, Mediasoup for WebRTC
- **Core Pattern**: Atomic Room Publication - rooms only appear publicly after DJ successfully establishes WebRTC transport and creates a Producer
- **State Management**: Arc<RwLock<RoomState>>, DashMap for concurrent collections, tokio-stream for broadcasting
- **Network**: Local WiFi optimization (empty ICE servers), WebRTC with DTLS security

### Frontend (SolidJS + Effect-TS)
- **Stack**: SolidJS, Effect-TS 3.11+, Mediasoup Client, Orval (OpenAPI generation)
- **State Management**: Domain-separated stores with SolidJS signals/stores, NO destructuring before use
- **Service Layer**: Services orchestrate multiple stores, handle API calls and business logic
- **Error Handling**: Effect-TS pipe patterns with centralized error recovery
- **Type Safety**: End-to-end from backend OpenAPI to frontend with Orval generation

### Store Architecture (Clean UI → Service → Store)

The frontend has been refactored from a monolithic room store to domain-separated stores:

#### Domain Stores
- **`connection.store.ts`** - Pure connection state management
- **`webrtc.store.ts`** - WebRTC transport status and timeout management
- **`room-metadata.store.ts`** - Room information and streaming status  
- **`dj.store.ts`** - DJ state with embedded MediaSoup state
- **`listeners.store.ts`** - Listener collection management

#### Service Pattern
Services orchestrate multiple stores without stores knowing about each other:
```typescript
// Services coordinate store updates
export const publishDJRoom = (roomId: string, deviceId?: string) => {
  stores.connection.connect(roomId, 'dj')
  stores.dj.setFlowStep('connecting')
  stores.webrtc.setStatus('connecting')
  // ... orchestration logic
}
```

### Key Framework Decisions

#### SolidJS Patterns
- **Signals for Primitives**: `const [value, setValue] = createSignal(initial)`
- **Stores for Objects**: `const [store, setStore] = createStore({})`
- **Fine-grained Updates**: Access store properties directly, avoid destructuring
- **Context API**: Store providers with type-safe hooks
- **Memos in Stores**: Use `createMemo()` for derived state calculations

#### Effect-TS 3.0 Patterns
- **Service Definition**: Use `Effect.Service` class pattern for dependency injection
- **Pipe Composition**: `pipe(Effect.succeed(value), Effect.andThen(fn), Effect.catchAll(handler))`
- **Option Types**: Use `Option.Option<T>` instead of nullable types throughout
- **Schema Validation**: Effect Schema for runtime validation with type inference

### Key Invariants
- Public rooms ALWAYS have a valid router and audio_producer
- DJ must complete full publish sequence before room becomes visible
- Stream control uses pause/resume (not close/reopen) for performance
- Frontend state is event-driven with fine-grained reactivity
- All async operations wrapped in Effect for composable error handling
- Stores never contain Effects, only pure state transitions

## Development Commands

### Backend (Rust)
```bash
cd backend
cargo check         # Type checking and basic compilation
cargo run          # Run the backend server (port 3000)
cargo test         # Run tests
cargo build --release  # Production build with optimizations
```

### Frontend (TypeScript/SolidJS)
```bash
cd frontend
npm run dev        # Start development server (port 5173)
npm run build      # Production build
npm run type-check # TypeScript type checking
npm run generate:api  # Generate OpenAPI client with Orval
npm run dev:api    # Watch mode for API generation
```

### Development Environment
- Uses Nix flake setup (`.envrc` with `use flake`)
- Python 3.11 required for mediasoup build compatibility
- Local development: listen/bind IP should be 127.0.0.1
- Production: listen IP 0.0.0.0, announced IP from environment variable

## Project Structure

### Backend Structure
```
backend/
├── src/
│   ├── main.rs           # Entry point with Axum server setup
│   ├── lib/              # Core library modules
│   │   ├── models/       # Data models and schemas
│   │   ├── handlers/     # HTTP/WebSocket handlers
│   │   ├── services/     # Business logic and Mediasoup integration
│   │   └── state/        # Application state management
```

### Frontend Structure  
```
frontend/
├── src/
│   ├── stores/           # Domain-separated reactive stores
│   │   ├── adapters/     # Store implementation adapters
│   │   └── *.store.ts    # Individual domain stores
│   ├── services/         # Business logic and orchestration
│   │   ├── application/  # Use-case orchestrators
│   │   ├── domain/       # Business rules
│   │   └── infrastructure/ # API/WebSocket clients
│   ├── domain/
│   │   └── schemas/      # Effect Schema definitions
│   └── ui/
│       ├── components/   # Reusable components
│       └── pages/        # Route pages (Landing, DJRoom, ListenerRoom)
```

## Technical Specification Highlights

### Atomic Room Publication Pattern
1. **Init**: DJ sends InitRoom, backend creates Router and Transport (Room in Setup state)
2. **Connect**: DJ connects Transport via DTLS
3. **Produce**: DJ creates Producer, backend marks room as Public
4. **Broadcast**: Room appears in public list only after Producer exists

### WebRTC Flow
- **Local Network Optimization**: Empty ICE servers for WiFi/LAN deployment
- **Transport Management**: WebRtcTransport with host candidates only
- **Stream Control**: pause()/resume() instead of close/reopen
- **Error Recovery**: AbortRoom command on publish failures

## Critical Implementation Notes

### Backend
- Follow atomic room publication pattern from README.md
- Use Arc<RwLock<RoomState>> for thread-safe state management
- Implement proper cleanup on publish failures (AbortRoom command)
- Local network optimization with empty ICE servers configuration

### Frontend
- **CRITICAL**: Never destructure store properties before use (breaks reactivity)
- Use Effect-TS pipe patterns for all async operations
- Services orchestrate stores, components only read stores and call services
- Use Context API for global state sharing, not prop drilling
- Keep UI components pure (presentation only)
- Always initialize stores with complete objects matching their types

### API Generation
- Backend exposes OpenAPI spec for REST endpoints
- Frontend uses Orval to generate TypeScript clients
- Custom Effect-TS mutator wraps fetch operations
- AsyncAPI 3.0 specification for WebSocket events

### Error Handling Strategy
- Services use Effect.catchAll for recovery strategies
- Stores remain in consistent state on errors
- UI shows appropriate feedback via ErrorBoundary
- WebRTC errors trigger reconnection flows

## Common Pitfalls to Avoid

1. **Store Anti-Patterns**
   - ❌ Cross-store reactions with createEffect
   - ❌ Components orchestrating multiple stores
   - ❌ Destructuring store properties before use
   - ✅ Services orchestrate, stores are passive

2. **Effect-TS Usage**
   - ❌ Mixing Promises and Effects without proper wrapping
   - ❌ Using nullable types instead of Option
   - ✅ Consistent Option types throughout
   - ✅ Effect.gen for complex async flows

3. **WebRTC Management**
   - ❌ Closing transports on stream pause
   - ❌ Creating multiple device instances
   - ✅ Single device, pause/resume producers
   - ✅ Proper cleanup on disconnection