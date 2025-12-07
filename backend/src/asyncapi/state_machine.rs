/// Generate Mermaid state diagram for HushFM WebSocket state machine
pub fn generate_state_diagram() -> String {
    r#"
```mermaid
stateDiagram-v2
    [*] --> Disconnected
    
    %% Lobby Flow
    Disconnected --> LobbyConnected: Connect to /ws/lobby
    LobbyConnected --> LobbyConnected: Receive room updates
    LobbyConnected --> Disconnected: Disconnect
    
    %% DJ Flow (Room Creation)
    Disconnected --> RoomConnected: Connect to /ws/room/{roomId}
    RoomConnected --> TransportPending: Send ConnectTransport
    TransportPending --> TransportReady: Receive TransportConnected
    TransportReady --> Producing: Send Produce
    Producing --> Streaming: Receive ProducerCreated
    
    %% DJ Stream Control
    Streaming --> StreamPaused: Send PauseStream
    StreamPaused --> Streaming: Send ResumeStream
    Streaming --> RoomClosing: Send CloseRoom
    StreamPaused --> RoomClosing: Send CloseRoom
    
    %% Listener Flow
    LobbyConnected --> ListenerConnecting: Send JoinRoom
    ListenerConnecting --> ListenerTransportPending: Receive RoomJoined
    ListenerTransportPending --> ListenerTransportReady: Send ConnectListenerTransport
    ListenerTransportReady --> Consuming: Send ConsumeAudio
    Consuming --> Listening: Receive ConsumerCreated
    
    %% Listener State Changes
    Listening --> Listening: Receive StreamPaused/StreamResumed
    Listening --> ListenerDisconnecting: Send LeaveRoom
    Listening --> Disconnected: Receive RoomClosed
    
    %% Error States
    TransportPending --> ErrorState: Transport connection failed
    Producing --> ErrorState: Producer creation failed
    ListenerTransportPending --> ErrorState: Transport connection failed
    Consuming --> ErrorState: Consumer creation failed
    
    %% Cleanup
    RoomClosing --> Disconnected: Room cleanup complete
    ListenerDisconnecting --> LobbyConnected: Return to lobby
    ErrorState --> Disconnected: Error cleanup
    
    %% State Descriptions
    Disconnected: No WebSocket connection
    LobbyConnected: Connected to lobby\nReceiving room list updates
    RoomConnected: Connected to room\nReady for commands
    TransportPending: Waiting for WebRTC\ntransport setup
    TransportReady: WebRTC transport ready\nCan produce media
    Producing: Creating media producer
    Streaming: Actively streaming audio\nRoom is public
    StreamPaused: Stream paused by DJ\nRoom still public
    RoomClosing: Cleaning up room resources
    
    ListenerConnecting: Joining room as listener
    ListenerTransportPending: Setting up listener transport
    ListenerTransportReady: Ready to consume audio
    Consuming: Setting up audio consumer
    Listening: Receiving audio stream
    ListenerDisconnecting: Leaving room
    
    ErrorState: Connection or operation failed
```

## State Transition Rules

### DJ States
- **Initial**: Must connect to lobby first to see rooms or create new room
- **Room Creation**: DJ connects directly to room WebSocket after REST API call
- **Transport Setup**: Must complete before producing audio
- **Atomic Publishing**: Room only becomes public after ProducerCreated event
- **Stream Control**: Can pause/resume without reconnecting WebRTC
- **Room Cleanup**: CloseRoom triggers immediate cleanup and lobby broadcast

### Listener States  
- **Discovery**: Browse rooms via lobby WebSocket
- **Join Flow**: JoinRoom → Transport → Consumer in sequence
- **Guaranteed Stream**: Can only join rooms that are already streaming
- **Real-time Updates**: Receive stream pause/resume notifications
- **Graceful Exit**: LeaveRoom or automatic on RoomClosed

### Error Handling
- **Transport Failures**: Return to previous state for retry
- **Producer Failures**: DJ must restart room creation
- **Consumer Failures**: Listener must rejoin room
- **Network Disconnection**: Automatic cleanup on server side

### State Invariants
- Public rooms always have active audio producer
- Listeners can only consume from streaming rooms
- DJ controls are only available in Streaming/StreamPaused states
- Lobby always reflects current room state accurately"#.to_string()
}

/// Generate state transition validation rules
pub fn generate_transition_rules() -> String {
    r#"
## Valid State Transitions

### From Disconnected
- → LobbyConnected (connect to lobby)
- → RoomConnected (connect to room as DJ)

### From LobbyConnected  
- → ListenerConnecting (join room)
- → Disconnected (disconnect)
- → RoomConnected (create room as DJ)

### From RoomConnected (DJ)
- → TransportPending (start WebRTC setup)
- → Disconnected (disconnect)

### From TransportPending
- → TransportReady (transport connected)
- → ErrorState (transport failed)
- → Disconnected (disconnect)

### From TransportReady
- → Producing (start audio production)
- → Disconnected (disconnect)

### From Producing
- → Streaming (producer created successfully)
- → ErrorState (producer failed)
- → Disconnected (disconnect)

### From Streaming
- → StreamPaused (pause stream)
- → RoomClosing (close room)
- → Disconnected (disconnect)

### From StreamPaused
- → Streaming (resume stream)
- → RoomClosing (close room)
- → Disconnected (disconnect)

### From ListenerConnecting
- → ListenerTransportPending (room joined)
- → LobbyConnected (join failed, return to lobby)
- → Disconnected (disconnect)

### From ListenerTransportPending
- → ListenerTransportReady (transport setup)
- → ErrorState (transport failed)
- → Disconnected (disconnect)

### From ListenerTransportReady
- → Consuming (start audio consumption)
- → Disconnected (disconnect)

### From Consuming
- → Listening (consumer created)
- → ErrorState (consumer failed)
- → Disconnected (disconnect)

### From Listening
- → ListenerDisconnecting (leave room)
- → LobbyConnected (room closed by DJ)
- → Disconnected (disconnect)

### From ErrorState
- → Disconnected (cleanup and reset)

### From RoomClosing
- → Disconnected (cleanup complete)

### From ListenerDisconnecting
- → LobbyConnected (return to lobby)
- → Disconnected (disconnect)
"#.to_string()
}

/// Get the list of commands valid for each state
pub fn get_valid_commands_for_state(state: &str) -> Vec<&'static str> {
    match state {
        "Disconnected" => vec![], // No commands valid, must connect first
        "LobbyConnected" => vec!["JoinRoom"], // Can join existing rooms
        "RoomConnected" => vec!["ConnectTransport"], // DJ must set up transport
        "TransportPending" => vec![], // Waiting for transport response
        "TransportReady" => vec!["Produce"], // Can start producing
        "Producing" => vec![], // Waiting for producer response  
        "Streaming" => vec!["PauseStream", "CloseRoom"], // Stream control
        "StreamPaused" => vec!["ResumeStream", "CloseRoom"], // Resume or close
        "ListenerConnecting" => vec![], // Waiting for join response
        "ListenerTransportPending" => vec!["ConnectListenerTransport"], // Set up transport
        "ListenerTransportReady" => vec!["ConsumeAudio"], // Start consuming
        "Consuming" => vec![], // Waiting for consumer response
        "Listening" => vec!["LeaveRoom"], // Can leave room
        "RoomClosing" => vec![], // Cleanup in progress
        "ListenerDisconnecting" => vec![], // Leaving in progress
        "ErrorState" => vec![], // Must disconnect and reset
        _ => vec![], // Unknown state
    }
}

/// Check if a command is valid in the current state
pub fn is_command_valid(state: &str, command: &str) -> bool {
    get_valid_commands_for_state(state).contains(&command)
}

/// Get the expected next state after a successful command
pub fn get_next_state_for_command(current_state: &str, command: &str) -> Option<&'static str> {
    match (current_state, command) {
        ("RoomConnected", "ConnectTransport") => Some("TransportPending"),
        ("TransportReady", "Produce") => Some("Producing"),
        ("Streaming", "PauseStream") => Some("StreamPaused"),
        ("StreamPaused", "ResumeStream") => Some("Streaming"),
        ("Streaming", "CloseRoom") => Some("RoomClosing"),
        ("StreamPaused", "CloseRoom") => Some("RoomClosing"),
        ("LobbyConnected", "JoinRoom") => Some("ListenerConnecting"),
        ("ListenerTransportPending", "ConnectListenerTransport") => Some("ListenerTransportReady"),
        ("ListenerTransportReady", "ConsumeAudio") => Some("Consuming"),
        ("Listening", "LeaveRoom") => Some("ListenerDisconnecting"),
        _ => None,
    }
}

/// Get the expected next state after receiving an event
pub fn get_next_state_for_event(current_state: &str, event: &str) -> Option<&'static str> {
    match (current_state, event) {
        ("TransportPending", "TransportConnected") => Some("TransportReady"),
        ("Producing", "ProducerCreated") => Some("Streaming"),
        ("ListenerConnecting", "RoomJoined") => Some("ListenerTransportPending"),
        ("Consuming", "ConsumerCreated") => Some("Listening"),
        ("RoomClosing", "RoomClosed") => Some("Disconnected"),
        ("Listening", "RoomClosed") => Some("LobbyConnected"),
        ("ListenerDisconnecting", "LeftRoom") => Some("LobbyConnected"),
        // Error transitions
        ("TransportPending", "CommandFailed") => Some("ErrorState"),
        ("Producing", "CommandFailed") => Some("ErrorState"),
        ("Consuming", "CommandFailed") => Some("ErrorState"),
        _ => None,
    }
}