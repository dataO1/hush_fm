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

### Phase 4: Frontend Integration 🏗️ (Current - Week 1)
- [x] OpenAPI client generation with Orval
- [x] Effect-TS 3.0 API integration layer
- [x] Reactive WebRTC store with SolidJS signals
- [x] Mediasoup-client Device initialization with fine-grained reactivity
- [x] Audio device enumeration and selection
- [x] WebRTC transport management with signal updates
- [x] Producer/Consumer connection flows using Effect programs
- [x] Real-time status updates via WebSocket with event-driven architecture
- [x] Error recovery and reconnection logic with Effect error handling
- [ ] Optimize WebRTC configuration for local network deployment
- [ ] TypeScript compilation fixes and library compatibility

### Phase 5: User Experience Features (Week 2)
- [ ] Audio visualizer using Web Audio API
- [ ] Stream pause/resume without connection teardown
- [ ] Listener count real-time updates
- [ ] DJ preparation mode (configure before going live)
- [ ] Hot-swappable audio input devices
- [ ] Connection status indicators

### Phase 6: Advanced Features (Week 3)
- [ ] Room recording capability
- [ ] Chat functionality via WebRTC data channels
- [ ] Room persistence and history
- [ ] Basic authentication and user management
- [ ] Stream quality controls (bitrate, sample rate)
- [ ] Listener feedback mechanisms

### Phase 7: Production Readiness (Week 4)
- [ ] Comprehensive error recovery
- [ ] Monitoring & metrics collection
- [ ] Load balancing across multiple workers
- [ ] Horizontal scaling with router pipelines
- [ ] Docker deployment configuration
- [ ] Performance optimization and profiling

## 🚀 Milestones

### Milestone 1: Basic Streaming (Target: Week 1)
**Goal**: DJ can create room and stream audio to listeners
- [x] Room creation API
- [x] WebSocket communication
- [x] WebRTC transport setup (backend)
- [x] Audio streaming infrastructure (Opus codec, backend)
- [ ] Frontend WebRTC integration
- [ ] Audio device selection and streaming (frontend)
- [ ] Listener joining and playback (frontend)

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
- **Backend**: Rust + Axum + Mediasoup + OpenAPI
- **Frontend**: SolidJS + Effect-TS + Mediasoup Client
- **State**: DashMap + tokio::sync + Arc/RwLock
- **Build**: Nix flakes + direnv for reproducibility
- **WebRTC**: Mediasoup with atomic room publication
- **Transport**: WebRTC optimized for local network deployment (no STUN/TURN required)

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