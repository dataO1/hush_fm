# DJ Room Creation Flow - Chronological Operations

Complete chronological flow of operations and events for DJ room creation, from UI interaction to backend WebRTC handshake completion.

## Phase 1: UI Initialization & Room Connection

### 1.1 Component Mount & WebSocket Setup
```
UI: DJRoom.tsx onMount()
└── connectToRoom(roomId) → SignalingProvider
    ├── WebSocket connection to `/rooms/${roomId}/dj`
    ├── WebSocket.onopen → setStatus('ready')
    └── setIsReadyToStream(true)
```

### 1.2 Device Selection
```
UI: DeviceSelector component
├── User selects microphone device
├── setSelectedDeviceId(deviceId)
└── setDeviceSelected(true) → enables "Go Live" button
```

## Phase 2: Stream Initiation - WebRTC Setup Begins

### 2.1 Go Live Button Click
```
UI: DJRoom.tsx startStreaming()
├── setStatus('connecting')
├── setError(null)
├── getRoomWebSocket() → validates existing connection
└── publishRoomFlow(roomId, deviceId, roomWebSocket)
```

### 2.2 PublishRoomFlow - WebRTC Initialization Sequence
```
Effects: webrtc-flows.ts publishRoomFlow()
├── Validate deviceId parameter
├── getRoomInfo(roomId) → REST API call
│   └── Backend returns: { rtpCapabilities, transportOptions }
├── WebRTCService.setDjWebSocket(roomWebSocket)
├── WebRTCService.initializeDevice(rtpCapabilities)
│   ├── Creates new mediasoup Device
│   ├── device.load(rtpCapabilities)
│   └── Sets device state to loaded
├── WebRTCService.setRoomId(roomId)
└── WebRTCService.createSendTransport(transportOptions)
```

## Phase 3: MediaSoup Transport Creation & Event Setup

### 3.1 Send Transport Creation
```
WebRTCService: createSendTransport()
├── device.createSendTransport({
│   ├── id: transportOptions.id
│   ├── iceParameters: transportOptions.iceParameters
│   ├── iceCandidates: transportOptions.iceCandidates
│   ├── dtlsParameters: transportOptions.dtlsParameters
│   ├── iceServers: [] (empty for local network)
│   └── iceTransportPolicy: 'all'
│   })
├── transport stored in service state
└── setupTransportEvents(transport, 'send')
```

### 3.2 Transport Event Handlers Setup
```
WebRTCService: setupTransportEvents()
├── transport.on('connectionstatechange', state => {
│   └── Handle 'failed' state cleanup
│   })
├── transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
│   ├── Create ClientCommand: 'connectDjTransport'
│   ├── Send via WebSocket to backend
│   ├── Wait for backend response
│   └── Call callback() on success / errback() on failure
│   })
└── transport.on('produce', async (parameters, callback, errback) => {
    ├── Create ClientCommand: 'createProducer'
    ├── Send RTP parameters to backend
    └── Wait for backend producer ID in callback
    })
```

## Phase 4: Audio Capture & Producer Creation

### 4.1 Get User Media
```
WebRTCService: getUserMedia(deviceId)
├── navigator.mediaDevices.getUserMedia({
│   ├── audio: {
│   │   ├── deviceId: { exact: deviceId }
│   │   ├── channelCount: { ideal: 2, min: 1 }
│   │   ├── echoCancellation: false
│   │   ├── noiseSuppression: false
│   │   └── autoGainControl: false
│   │   }
│   └── video: false
│   })
├── Apply audio processing hack (AudioContext + oscillator)
└── Return MediaStreamTrack
```

### 4.2 Transport.produce() Call - **CRITICAL HANDSHAKE TRIGGER**
```
WebRTCService: produce(track)
├── transport.produce({
│   ├── track: MediaStreamTrack
│   ├── codecOptions: { opusStereo: false, opusDtx: false }
│   └── encodings: [{ maxBitrate: 128000 }]
│   }) → **THIS TRIGGERS DTLS/ICE HANDSHAKE**
│
├── MEDIASOUP INTERNAL SEQUENCE:
│   ├── MediaSoup starts WebRTC negotiation
│   ├── Fires 'connect' event with DTLS parameters
│   ├── Frontend sends 'connectDjTransport' to backend
│   ├── Backend connects transport with DTLS params
│   ├── ICE/DTLS handshake begins
│   ├── MediaSoup fires 'produce' event with RTP parameters
│   ├── Frontend sends 'createProducer' to backend
│   └── Backend creates producer and returns ID
│
└── Return producer ID on success
```

## Phase 5: Backend WebSocket Message Handling

### 5.1 connectDjTransport Command Processing
```
Backend: ws/mod.rs handle_client_command()
├── Parse ClientCommand::ConnectDjTransport {
│   ├── transportId: Option<String>
│   ├── dtlsParameters: DtlsParameters
│   └── _traceContext: TraceContext
│   }
├── Convert frontend DTLS params to native MediaSoup format
├── handle_connect_transport(room_id, transport_id, dtls_params, state)
│   ├── Get room state and DJ transport
│   ├── transport_manager.connect_transport(dj_transport, dtls_parameters)
│   └── **BACKEND DTLS HANDSHAKE COMPLETION**
└── Send ServerEvent::TransportConnected { transport_id }
```

### 5.2 createProducer Command Processing
```
Backend: ws/mod.rs handle_client_command()
├── Parse ClientCommand::CreateProducer {
│   ├── rtpParameters: RtpParameters
│   ├── kind: MediaKind
│   └── _traceContext: TraceContext
│   }
├── handle_create_producer(room_id, rtp_parameters, kind, state)
│   ├── Get room state and DJ transport
│   ├── ProducerManager::create_producer(transport, rtp_parameters)
│   ├── **BACKEND PRODUCER CREATION**
│   └── Room transitions to RoomStatus::Public
└── Send ServerEvent::ProducerCreated { producer_id }
```

## Phase 6: DTLS/ICE Negotiation Details

### 6.1 ICE Gathering Phase
```
MediaSoup Internal Process:
├── ICE agent starts candidate gathering
├── Local network candidates discovered (192.168.x.x)
├── Empty ICE servers = no STUN/TURN = local network only
├── ICE candidates exchanged via transport connect event
└── ICE connectivity checks begin
```

### 6.2 DTLS Handshake Phase
```
DTLS Negotiation Sequence:
├── Frontend transport.produce() triggers connect event
├── Frontend sends DTLS parameters to backend:
│   ├── role: 'auto' | 'client' | 'server'
│   ├── fingerprints: [{ algorithm: 'sha-256', value: 'XX:XX...' }]
│   └── Additional DTLS configuration
├── Backend MediaSoup transport.connect(dtlsParameters)
├── **DTLS handshake establishes secure channel**
├── SRTP keys derived from DTLS master key
└── Secure RTP communication channel ready
```

### 6.3 Connection State Progression
```
Transport Connection States:
├── 'new' → Initial state after transport creation
├── 'connecting' → ICE gathering and DTLS handshake in progress
├── 'connected' → ICE and DTLS successfully completed
├── 'disconnected' → Temporary connection loss
├── 'failed' → Connection permanently failed
└── 'closed' → Transport explicitly closed
```

## Phase 7: Producer Creation & Stream Activation

### 7.1 Backend Producer Creation
```
Backend: webrtc/producer.rs ProducerManager::create_producer()
├── Validate RTP parameters and codecs
├── transport.produce(rtp_parameters) → MediaSoup core
├── Store producer in room state
├── Set producer as active audio source
├── Room becomes publicly visible (RoomStatus::Public)
└── Return producer ID to frontend
```

### 7.2 Frontend Producer Registration
```
Frontend: WebRTCService receives ProducerCreated event
├── Store producer in service state
├── setupProducerEvents(producer)
├── notifyStateChange() → update reactive signals
├── isStreaming() → true
└── UI updates to show "LIVE" status
```

## Phase 8: Stream State Management

### 8.1 UI State Updates
```
Frontend: Provider state sync
├── WebRTCProvider.syncServiceStateToStore()
├── setIsStreaming(hasActiveProducers)
├── DJRoom.tsx createEffect() monitors isStreaming()
├── setStatus('live')
├── Show recording controls in UI
└── Hide "Go Live" button
```

### 8.2 Audio Flow Active
```
Complete Audio Pipeline:
├── Microphone → MediaStreamTrack
├── MediaStreamTrack → MediaSoup Producer
├── Producer → SRTP packets
├── SRTP → Network (192.168.x.x local)
├── Backend MediaSoup Router
├── Router → Available for consumer connections
└── Stream publicly available for listeners
```
