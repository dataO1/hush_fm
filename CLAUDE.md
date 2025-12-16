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
- use internal events and endpoints for the asyncapi specification but make sure to follow the following guidelines: Rule 1: Use Stable Serialization

Bad (leaks Rust internals):

rust
pub struct Room {
    pub id: Uuid, // Serializes to complex object in some formats
    pub created_at: DateTime<Utc>, // RFC3339 string
}

Good (stable JSON representation):

rust
#[derive(Serialize, Deserialize, JsonSchema)]
pub struct Room {
    #[serde(serialize_with = "serialize_uuid_as_string")]
    #[schemars(with = "String")] // AsyncAPI sees "string", not object
    pub id: Uuid,
    
    #[serde(rename = "createdAt")] // camelCase for frontend
    pub created_at: String, // Pre-format as ISO8601
}

Rule 2: Mark Internal Fields

Use #[serde(skip)] for things clients shouldn't see:

rust
pub struct Room {
    pub id: Uuid,
    pub name: String,
    pub listener_count: usize,
    
    // Hidden from AsyncAPI
    #[serde(skip)]
    #[schemars(skip)]
    pub(crate) router: Router, // Mediasoup router (internal)
    
    #[serde(skip)]
    pub(crate) listeners: DashMap<String, Listener>, // Full state
}

Rule 3: Separate Read/Write Models (CQRS-lite)

For complex entities, use different types for commands vs. events:

rust
// Command (client → server)
#[derive(Deserialize, JsonSchema)]
pub struct CreateRoomCommand {
    pub name: String,
    // Only fields client can set
}

// Event (server → client)
#[derive(Serialize, JsonSchema)]
pub struct RoomCreatedEvent {
    pub room_id: String,
    pub name: String,
    pub dj_name: String,
    pub created_at: String,
    // Full read model
}

// Internal domain
struct Room {
    // Can have 50 fields, clients don't see them
}

Rule 4: Version at the Message Level

Instead of API v1/v2, version messages:

rust
#[derive(Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type")]
pub enum ClientMessage {
    JoinRoom { room_id: String },
- Architectural Context: SolidJS + Effect TS Frontend

Architecture: Functional Core (Effect), Reactive Shell (SolidJS).
Pattern: Separates State (Stores), Logic (Services), and Definitions (Schemas).
Core Components & Roles

    Domain Schemas (The Model - src/domain/schemas/)

        Tool: Effect.Schema (or Zod).

        Role: Stateless data definitions, validation logic, and type inference.

        Rule: Defines what valid data looks like (mirrors Rust backend types).

    Services (The Controller - src/services/)

        Tool: Effect.Service / Effect.Layer.

        Role: Stateless orchestration, side effects (API calls), and business logic.

        Rule: Pure logic only. Never holds state. Validates inputs via Schemas, executes logic, and commits results to Stores.

    Stores (The State - src/stores/)

        Tool: SolidJS Store / Signal.

        Role: Single source of truth. Acts as an in-memory database.

        Rule: Domain-centric, not UI-centric. Normalized structure (dictionaries by ID). Mutated only by Services on success.

    Components (The View - src/ui/)

        Tool: Solid Components + createMemo.

        Role: Reactive rendering.

        Rule: Read-only. Derives UI state from Domain Stores using createMemo (Selectors). Triggers Service flows via event handlers.

Data Flow (Unidirectional)

    Trigger: UI Component invokes a Service function (e.g., UserService.updateProfile(data)).

    Read/Validate: Service validates inputs against Schema and (optionally) reads current Store state.

    Compute: Service executes logic (API calls, calculations) using Effect.gen.

    Write: On success, Service updates the Store.

    React: Store updates trigger UI re-renders automatically.