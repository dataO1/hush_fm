Document 1: Backend Technical Specification

Target Audience: Rust Backend Engineer
Stack: Rust, Axum, Mediasoup, OpenAPI
1. System Overview

The backend treats Room creation as a multi-step setup that results in an atomic "Publish" event. A room does not appear in the public listing until the DJ has successfully established their WebRTC Transport and created a Mediasoup Producer.

Invariant: If a Room ID is in the public list, that Room has a valid router and a valid audio_producer.
2. State & Models
2.1 Room State

rust
enum RoomStatus {
    Setup,   // Router created, waiting for DJ to Produce
    Public,  // Producer active, visible to listeners
}

struct Room {
    id: Uuid,
    name: String,
    dj_id: String,
    router: Router,
    // Producer is now mandatory for a Public room
    producer_id: Option<String>,
    status: RoomStatus,
    listeners: DashMap<String, ListenerState>,
}

3. Logic Flows
3.1 Atomic Room Publication (DJ Flow)

    Step 1: Init: DJ sends InitRoom(name).

        Backend creates Router.

        Backend creates WebRtcTransport for DJ.

        Backend stores Room in Setup state (Hidden from list).

        Returns: roomId, transportOptions.

    Step 2: Connect: DJ Frontend connects Transport (DTLS).

    Step 3: Produce: DJ Frontend sends Produce(rtpParameters).

        Backend creates Producer on the Router.

        Backend updates Room state: producer_id = id, status = Public.

        Broadcast: Backend sends RoomListUpdate (New Room) to all clients.

        Returns: producerId.

3.2 Listener Join (Simplified)

    CMD: Listener sends JoinRoom(roomId).

    Validation: Check if Room is Public. (It must be).

    Action:

        Create WebRtcTransport for listener.

        Create Consumer immediately (since producer_id is guaranteed).

    Response: Return transportOptions AND consumerOptions.

    Result: Audio path is established in one round-trip.

3.3 Pause/Resume (Stream Control)

    Logic: The DJ does not close the Producer.

    Action: DJ sends PauseStream / ResumeStream.

    Backend: Calls producer.pause() / producer.resume().

    Mediasoup: Automatically handles silence on the wire.

    Notification: Backend sends StreamState { active: bool } to listeners for UI updates (e.g., dimming the visualizer), but no WebRTC changes occur.

3.4 DJ Leave / Disconnect

    Event: DJ WebSocket closes or sends CloseRoom.

    Action:

        Mark Room as Closed.

        Broadcast RoomListUpdate (Remove Room).

        Broadcast RoomClosed to current listeners (Kick to lobby).

        Close Router (cleans up all Transports/Producers/Consumers).

Document 2: Frontend Technical Specification

Target Audience: Frontend Developer
Stack: SolidJS, Effect-TS, Mediasoup Client, Orval (OpenAPI)

## Frontend Architecture Overview

### Reactive State Management (SolidJS)
- **Fine-grained Reactivity**: Use SolidJS signals for primitive values, stores for complex objects
- **No Destructuring**: Maintain reactivity by accessing store properties directly
- **Lazy Creation**: Signals created on-demand for optimal performance
- **Context API**: Global state sharing without props drilling

### Effect-TS 3.0 Patterns
- **Pipe-based Composition**: Linear flow programs with `pipe(Effect.succeed(), Effect.andThen())`
- **Error Channel Operations**: Centralized error handling with recovery strategies
- **Resource Management**: Automatic cleanup with finalizers and interruption handling
- **Type Safety**: End-to-end type safety from backend to frontend

### OpenAPI Integration
- **Orval Client Generation**: Auto-generated TypeScript clients from backend OpenAPI spec
- **Effect-TS Mutator**: Custom fetch wrapper for seamless Effect integration
- **Type Validation**: Runtime validation with compile-time guarantees

### WebRTC Abstraction
- **Reactive Wrapper**: mediasoup-client wrapped with SolidJS signals
- **Event-driven Updates**: Connection state, stats, and lifecycle events as signals
- **Resource Lifecycle**: Proper cleanup and reconnection handling
- **Local Network Transport**: WebRTC optimized for LAN deployment without STUN/TURN

## Implementation Layers

### 1. Generated API Layer (`src/generated/`)
- Auto-generated from backend OpenAPI specification
- Type-safe request/response interfaces
- Effect-TS integration for error handling

### 2. WebRTC State Layer (`src/webrtc/`)
- Reactive mediasoup device management
- Transport lifecycle with signal updates
- Producer/consumer state tracking

### 3. Effect Programs Layer (`src/effects/`)
- Composable business logic flows
- Error recovery strategies
- Resource management

### 4. Component Layer (`src/components/`)
- **Clean Architecture**: Shared components for reusability across pages
- **Modern UI Design**: Glass-morphism effects with backdrop blur and gradients
- **Consistent Styling**: Unified design system with proper spacing and colors
- **Accessibility Ready**: Semantic HTML with proper ARIA labels and keyboard navigation
- **TypeScript Integration**: Full type safety with Effect-TS patterns

#### Component Structure
- **Pages**: Landing, DJRoom, ListenerRoom with clean layouts
- **Shared Components**: StreamStatusBadge, AudioVisualizer, AudioLevelMeter
- **Controls**: MicControls, VolumeControls for audio management
- **Clean State Management**: Proper loading states, error handling, and user feedback

### 5. Store Layer (`src/stores/`)
- Application state management
- Derived signals for computed state
- Cross-component communication

## Current Implementation Status

### ✅ Frontend UI Complete & Production Ready
- **Landing Page**: Minimal DaisyUI cards for room creation and joining
- **DJ Room**: Streamlined interface with device selection, waveform, and essential controls
- **Listener Room**: Clean audio playback with volume control and live visualization
- **Modern UI Framework**: Complete DaisyUI integration with monochrome theme
- **Audio Visualization**: Real-time waveform display using webaudio-oscilloscope
- **TypeScript**: Zero compilation errors with full type safety
- **Production Build**: Optimized bundle (403KB → 100KB gzipped)

### 🚧 Backend Integration
- WebRTC flows defined and implemented
- API client integration ready
- Real-time WebSocket communication pending
1. DJ Workflow (The "Publish" Wizard)

Program: PublishRoomFlow
This is a linear Effect sequence that must complete successfully to go live.

typescript
const publishRoom = (name: string, deviceId: string) => Effect.gen(function*(_) {
  // 1. Initialize Room (Server allocates Router)
  const initRes = yield* _(Api.initRoom({ name }));

  // 2. Prepare Transport (Local)
  const transport = yield* _(Media.createSendTransport(initRes.transportOptions));

  // 3. Get User Media (Mic)
  const track = yield* _(Media.getUserMedia(deviceId));

  // 4. Produce (Actual Stream Start)
  // This sends the 'Produce' command to backend.
  // Backend only marks room 'Public' after this succeeds.
  const producerId = yield* _(Media.produce({ transport, track }));

  return { roomId: initRes.id, producerId };
});

    UI State: Show "Preparing Room..." spinner during steps 1-4. Only navigate to "DJ Room View" on success.

2. Listener Workflow (Instant Play)

Program: JoinRoomFlow
Since the room is guaranteed to have a stream, we just connect and play.

typescript
const joinRoom = (roomId: string) => Effect.gen(function*(_) {
  // 1. Join & Consume in one go
  // Backend prepares everything since Producer exists
  const res = yield* _(Api.joinRoom(roomId));

  // 2. Connect Transport
  const transport = yield* _(Media.createRecvTransport(res.transportOptions));

  // 3. Consume (Zero wait time)
  const track = yield* _(Media.consume({
    transport,
    consumerOptions: res.consumerOptions
  }));

  // 4. Play
  yield* _(Audio.play(track));
});

3. Stream Control (DJ UI)

    Button: Toggle "Mute Mic" (Pause) / "Unmute" (Resume).

    Implementation:

        Local: producer.pause() (Stops sending bits).

        Server: Send PauseStream command (Notifies listeners).

        Note: Do not close the producer/transport until the room is destroyed.

## Transport Architecture

### WebRTC Optimized for Local Networks

HushFM is designed for controlled local network environments (WiFi/LAN), optimizing WebRTC connections for local peers:

- **WebRtcTransport**: Standard WebRTC transport optimized for local networks
- **No STUN/TURN Servers**: Empty ICE servers configuration for local-only connections
- **Host Candidates Only**: ICE gathers only local network addresses
- **DTLS Security**: Maintains WebRTC security without external servers
- **Simplified Deployment**: No external infrastructure dependencies

### Transport Configuration Logic

```rust
// Backend: Use WebRtcTransport optimized for local network
let transport_options = WebRtcTransportOptions::new(
    WebRtcTransportListenInfos::new(ListenInfo {
        protocol: Protocol::Udp,
        ip: local_ip,
        announced_address: None, // Use actual local IP
        port: None,
        ..Default::default()
    })
);

let transport = router.create_webrtc_transport(transport_options).await?;
```

```typescript
// Frontend: Configure WebRTC for local network (no ICE servers)
const transport = device.createSendTransport({
    id: transportOptions.id,
    iceParameters: transportOptions.iceParameters,
    iceCandidates: [], // Empty for local network optimization
    dtlsParameters: transportOptions.dtlsParameters,
});

// RTCPeerConnection with no ICE servers for local optimization
const pc = new RTCPeerConnection({ iceServers: [] });
```

### Why Not PlainTransport?

PlainTransport is for server-to-server communication and cannot be used with browsers. WebRTC with optimized local network configuration provides the best performance for WiFi environments.

4. Visualizer & Status

    Listener UI:

        StreamState.active: Green "Live" badge. Visualizer active.

        StreamState.paused: Orange "DJ Muted" badge. Visualizer flat.

        No "Waiting for Stream" state exists anymore.

5. Error Handling (Effect)

    Publish Fail: If Media.produce fails (e.g., DTLS error), the frontend must send AbortRoom to backend to clean up the Setup state room.

    Mic Fail: If getUserMedia fails, do not start the sequence. Show error on "Create Room" modal.

## Frontend Architecture

### Provider-Based State Management
The frontend uses a provider-based architecture with SolidJS Context API for:
- **WebRTCProvider**: Manages all WebRTC state (device, transports, producers, consumers)
- **SignalingProvider**: Handles WebSocket connections and real-time events
- **Proper reactive context**: All reactive primitives created within providers to avoid memory leaks

### Data Fetching Pattern
- **createResource**: For all async data fetching with built-in Suspense support
- **Effect-TS**: Business logic and complex async flows
- **Generated API Client**: All API calls use Orval-generated client with proper types

### Error Handling
- **ErrorBoundary**: Global error boundary at app root
- **Suspense**: Loading states for async operations
- **Granular boundaries**: Component-level Suspense for targeted loading states

### Key Principles
1. All state lives in providers, never at module level
2. Use generated API client exclusively (no manual API types)
3. Effect.runPromise at UI boundaries with createResource
4. Proper Suspense/ErrorBoundary hierarchy
