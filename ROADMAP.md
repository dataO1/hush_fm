# HushFM Roadmap

## 🎯 Vision
Build a robust, scalable live audio streaming platform using Rust and WebRTC with atomic room publication, enabling seamless DJ streaming and listener experiences.

## 📅 Development Phases

### Phase 1: Core Infrastructure ✅ (Completed)
- [x] Development environment setup (Nix flake with Python 3.11)
- [x] Backend skeleton (Rust/Axum with OpenAPI)
- [x] Frontend skeleton (SolidJS/TypeScript with Effect-TS)
- [x] Mediasoup integration (v0.20 with proper codec configuration)
- [x] Basic API structure (atomic room creation pattern)
- [x] WebSocket foundation for real-time communication
- [x] Build system fixes (SafeConfigParser, Ninja detection)

### Phase 2: Enhanced State Management ✅ (Completed)
- [x] Enhanced room state with Arc<RwLock<RoomState>>
- [x] Broadcast channels for real-time updates (tokio::sync::broadcast)
- [x] Transport pool management with DashMap
- [x] Producer/Consumer lifecycle management
- [x] Event system for room state changes
- [x] Proper resource cleanup on disconnects

### Phase 3: WebRTC Implementation ✅ (Completed)
- [x] DTLS transport connection handling (local network)
- [x] Audio producer creation with RTP parameters
- [x] Consumer setup for listeners with transport options
- [x] Simplified connection flow without ICE for local WiFi
- [x] Connection quality monitoring foundation
- [x] Media pipeline optimization
- [x] Transport architecture research (WebRTC local network optimization)

### Phase 4: Frontend Integration ✅ (Completed)
- [x] OpenAPI client generation with Orval
- [x] Effect-TS 3.0 API integration layer
- [x] Reactive WebRTC store with SolidJS signals
- [x] Mediasoup-client Device initialization with fine-grained reactivity
- [x] Audio device enumeration and selection
- [x] WebRTC transport management with signal updates
- [x] Producer/Consumer connection flows using Effect programs
- [x] Real-time status updates via WebSocket with event-driven architecture
- [x] Error recovery and reconnection logic with Effect error handling
- [x] Complete UI implementation with modern design
- [x] TypeScript compilation fixes and full type safety
- [x] Shared component architecture for reusability

### Phase 5: User Experience Features ✅ (Completed)
- [x] Audio visualizer using Web Audio API (real-time waveform visualization)
- [x] Stream pause/resume without connection teardown (producer pause/resume)
- [x] Connection status indicators (live streaming status badges)
- [x] Volume controls for listeners (audio element volume management)
- [x] Modern UI with DaisyUI components and monochrome theme
- [x] Complete UI cleanup and optimization (removed 300+ lines of custom CSS)
- [x] Production-ready build system with TypeScript compatibility
- [x] Essential device selection for DJ microphone input
- [ ] Listener count real-time updates (WebSocket integration)
- [ ] DJ preparation mode (configure before going live)
- [ ] Hot-swappable audio input devices

### Phase 6: Backend Integration ✅ (Completed - Week 3)
- [x] AsyncAPI 3.0 WebSocket specification with auto-generation
- [x] Clean API models layer with CQRS-lite pattern
- [x] JSON schema generation from Rust types using schemars
- [x] State machine documentation with visualization
- [x] Unified models architecture - single source of truth
- [x] WebSocket real-time communication implementation
- [x] Complete WebRTC flow integration (publish/join)
- [x] Unified WebRTC Service replacing four separate managers
- [x] WebSocket connection sharing between providers
- [x] Effect-TS Option types migration throughout WebRTC layer
- [x] Room state synchronization between frontend and backend
- [x] Error handling and connection recovery
- [ ] Performance optimization and load testing

### Phase 6.5: Frontend Architecture Refactor ✅ (Completed)
- [x] Migrated to provider-based architecture
- [x] Replaced module-level state with Context providers
- [x] Implemented createResource for all async data
- [x] Added proper Suspense and ErrorBoundary
- [x] Fixed SolidJS reactive context warnings
- [x] Integrated generated API client throughout
- [x] Removed all manual API type definitions
- [x] Fixed all TypeScript compilation errors
- [x] Integrated WebRTC flows with new provider system
- [x] Clean separation between Effect-TS flows and provider state
- [x] Production-ready build with full type safety

### Phase 6.75: WebRTC Service Consolidation ✅ (Completed - December 2025)
- [x] **Unified WebRTC Service Architecture**
  - Consolidated four separate managers (Device, Transport, Producer, Consumer) into single `WebRTCService`
  - Eliminated code duplication and simplified state management
  - Consistent Effect-TS patterns throughout WebRTC layer
- [x] **WebSocket Connection Optimization**
  - Removed duplicate WebSocket connections between SignalingProvider and WebRTCService
  - Implemented shared WebSocket pattern for efficient resource usage
  - Added `getRoomWebSocket()` method to SignalingProvider for WebSocket sharing
- [x] **Effect-TS Option Types Migration**
  - Replaced all nullable types with `Option.Option<T>` throughout WebRTC service
  - Improved type safety and eliminated null-related runtime errors
  - Consistent Option handling patterns using `Option.match()`
- [x] **Flow Integration with Shared WebSocket**
  - Updated `publishRoomFlow` and `joinRoomFlow` to accept WebSocket parameters
  - Proper WebSocket connection timing to fix "WebSocket not connected" errors
  - Clean dependency injection pattern for WebRTC operations

### Phase 7: Advanced Features (Week 4)
- [ ] Room recording capability
- [ ] Chat functionality via WebRTC data channels
- [ ] Room persistence and history
- [ ] Basic authentication and user management
- [ ] Stream quality controls (bitrate, sample rate)
- [ ] Listener feedback mechanisms

### Phase 8: Production Readiness (Week 5)
- [ ] Comprehensive error recovery
- [ ] Monitoring & metrics collection
- [ ] Load balancing across multiple workers
- [ ] Horizontal scaling with router pipelines
- [ ] Docker deployment configuration
- [ ] Performance optimization and profiling

## 🚀 Milestones

### Milestone 1: Basic Streaming ✅ (Completed)
**Goal**: DJ can create room and stream audio to listeners
- [x] Room creation API
- [x] WebSocket communication
- [x] WebRTC transport setup (backend)
- [x] Audio streaming infrastructure (Opus codec, backend)
- [x] Frontend WebRTC integration
- [x] Audio device selection and streaming (frontend)
- [x] Listener joining and playback (frontend)
- [x] Complete UI implementation with modern design system

**Success Criteria**:
- DJ can select audio input and go live
- Multiple listeners can join and hear audio
- Room appears in list when streaming

### Milestone 2: Robust Platform (Target: Week 2)
**Goal**: Multiple concurrent rooms with stable connections
- [ ] Concurrent room management
- [ ] Stable WebRTC connections
- [ ] Proper error handling and recovery
- [ ] Resource cleanup on disconnects
- [ ] Performance under load

**Success Criteria**:
- 10+ concurrent rooms without issues
- Graceful handling of network interruptions
- Proper cleanup when users disconnect
- No memory leaks or resource exhaustion

### Milestone 3: Production Features (Target: Week 3)
**Goal**: Feature-complete platform ready for users
- [ ] Audio recording and playback
- [ ] Real-time chat functionality
- [ ] User authentication
- [ ] Room persistence
- [ ] Quality monitoring

**Success Criteria**:
- Users can record and replay streams
- Chat works alongside audio streaming
- Rooms persist across server restarts
- Quality metrics available

### Milestone 4: Scale & Deploy (Target: Week 4)
**Goal**: Production deployment with monitoring
- [ ] Multi-worker support for scaling
- [ ] Docker containerization
- [ ] Monitoring and alerting
- [ ] Load balancing
- [ ] Documentation for deployment

**Success Criteria**:
- Can handle 100+ concurrent users
- Deployable with Docker
- Comprehensive monitoring in place
- Clear deployment documentation

## 🔧 Technical Architecture

### Current Stack
- **Backend**: Rust + Axum + Mediasoup + OpenAPI + AsyncAPI 3.0
- **Frontend**: SolidJS + Effect-TS + Mediasoup Client + Auto-generated clients
- **State**: DashMap + tokio::sync + Arc/RwLock
- **Build**: Nix flakes + direnv for reproducibility
- **WebRTC**: Mediasoup with atomic room publication
- **Transport**: WebRTC optimized for local network deployment (no STUN/TURN required)
- **API Generation**: schemars for JSON schemas, Orval for REST, Modelina for WebSocket

### Transport Architecture Decision

**WebRTC Local Network Optimization**:
- **Empty ICE Servers**: Configure RTCPeerConnection with `{ iceServers: [] }`
  - Restricts connections to local network peers only
  - ICE still gathers host candidates for local discovery
  - Eliminates unnecessary STUN/TURN server queries
  - Maintains WebRTC security with DTLS encryption
- **Browser Compatibility**: WebRTC is the only transport browsers support
  - PlainTransport is for server-to-server communication only
  - Local optimization provides best performance for WiFi environments
  - Simplified deployment without external infrastructure dependencies

### API Architecture Strategy

**AsyncAPI 3.0 WebSocket Specification**:
- **Schema Generation**: Use schemars to generate JSON schemas from Rust types
  - Ensures type safety and consistency between backend and frontend
  - Automatic API documentation and validation
  - Schema evolution tracking with version control
- **Client Generation**: Auto-generate TypeScript clients using @asyncapi/modelina
  - Effect-TS patterns for composable WebSocket interactions
  - Type-safe event handling with compile-time guarantees
  - Centralized error recovery and reconnection logic
- **Clean API Layer**: Separate internal models from external API contracts
  - CQRS-lite pattern with read/write model separation
  - Stable serialization with camelCase and string UUIDs
  - Trace context support for distributed tracing

### Scaling Strategy
1. **Vertical**: Multiple workers per host
2. **Horizontal**: Router pipelines across hosts
3. **Edge**: CDN for recorded content
4. **Database**: Event sourcing for room history

### Quality Assurance
- Unit tests for core logic
- Integration tests for WebRTC flows
- Load testing for concurrent users
- Security audit for production deployment

## 📊 Success Metrics

### Performance Targets
- **Latency**: <200ms audio end-to-end
- **Capacity**: 100+ concurrent rooms per server
- **Reliability**: 99.9% uptime
- **Quality**: Opus audio at 48kHz stereo

### User Experience Goals
- **Time to Stream**: <30 seconds from room creation to live
- **Join Latency**: <5 seconds from click to audio
- **Connection Stability**: <1% dropped connections
- **Cross-Platform**: Support all modern browsers

## 🔧 API Architecture Decisions

### AsyncAPI Implementation (December 2025)

**Decision**: Manual AsyncAPI 3.0 spec generation instead of asyncapi Rust crate

**Rationale**:
- The asyncapi Rust crate had significant limitations and API inconsistencies
- Missing types (Payload, OperationType) and mismatched field signatures
- Manual generation provides full control over spec structure and compatibility
- Better alignment with frontend auto-generation tools (@asyncapi/modelina)

**Implementation**:
- Use schemars to generate JSON schemas from Rust API models
- Build AsyncAPI spec using serde_json::json! macro for full control
- Clean API models layer separate from internal business models
- Stable serialization patterns (camelCase, string UUIDs, ISO dates)
- Comprehensive state machine documentation with Mermaid diagrams

**Benefits**:
- Type safety through schema generation from actual Rust types
- Frontend compatibility with latest AsyncAPI tooling (2025)
- Clean separation between API contracts and internal models
- Future-proof schema evolution and versioning
- Full traceability from backend types to frontend generated code

### Unified Models Architecture (December 2025)

**Decision**: Eliminate duplicate models and use single source of truth

**Problem**: 
- Duplicate `Room` vs `RoomInfo` models causing maintenance overhead
- Inconsistent API contracts between REST and WebSocket endpoints
- Type mismatches between internal logic and external API

**Solution**:
- Single `Room` model in `models/schemas.rs` serves all purposes
- Clean serialization with `#[serde(skip)]` for internal fields
- Proper camelCase transformation for frontend compatibility
- ISO8601 datetime serialization with custom serde module

**Result**:
- Single source of truth across REST API, WebSocket events, and internal logic
- Consistent type contracts between all API endpoints
- Simplified maintenance with no duplicate model definitions
- Full compatibility with both AsyncAPI and OpenAPI generation

## 🎯 Future Enhancements

### Advanced Features (Post-MVP)
- Video streaming support
- Screen sharing capabilities
- Advanced audio effects
- Multi-room broadcasting
- API for third-party integration

### Enterprise Features
- Branded room experiences
- Analytics and reporting
- Role-based access control
- SLA guarantees
- Professional support

This roadmap balances technical implementation with user value, ensuring we build a solid foundation while delivering features that matter to our users.