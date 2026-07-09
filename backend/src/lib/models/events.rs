use serde::Serialize;
use schemars::JsonSchema;
use utoipa::ToSchema;
use uuid::Uuid;

/// Room information for client events (clean model without internal state)
#[derive(Debug, Clone, Serialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoomInfo {
    /// Unique room identifier
    #[serde(with = "super::uuid_string")]
    #[schemars(with = "String")]
    pub id: Uuid,
    /// Human-readable room name
    pub name: String,
    /// DJ's display name
    pub dj_name: String,
    /// DJ's session ID for reconnection matching
    pub dj_id: String,
    /// Current number of listeners
    pub listener_count: u32,
    /// Whether DJ is currently streaming
    pub is_streaming: bool,
    /// Room creation timestamp (ISO8601)
    pub created_at: String,
    /// Optional room description
    pub description: Option<String>,
    /// Room tags for categorization
    pub tags: Vec<String>,
}

impl From<super::Room> for RoomInfo {
    fn from(room: super::Room) -> Self {
        // Get DJ name and ID from DJ struct
        let (dj_name, dj_id) = room.dj.as_ref()
            .map(|dj| (dj.display_name.clone(), dj.dj_id.clone()))
            .unwrap_or_else(|| ("Unknown DJ".to_string(), "".to_string()));
            
        Self {
            id: room.id,
            name: room.name,
            dj_name,
            dj_id,
            listener_count: room.listener_count,
            is_streaming: room.dj_streaming,
            created_at: room.created_at.to_rfc3339(),
            description: room.description,
            tags: room.tags,
        }
    }
}

/// Events sent from server to DJ clients
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DjEvent {
    /// Room has been announced and created (Step 1 of DJ flow)
    /// Returns all connection details for DJ to start the 18-step flow
    RoomAnnounced {
        /// Created room information
        room: RoomInfo,
        /// WebSocket URL for DJ room connection
        #[serde(rename = "wsUrl")]
        ws_url: String,
    },

    /// Room has been initialized for DJ (Step 3 of DJ flow)
    RoomInitialized {
        /// ID of the initialized room
        #[serde(rename = "roomId")]
        room_id: String,
        /// RTP capabilities for device initialization
        #[serde(rename = "rtpCapabilities")]
        rtp_capabilities: super::schemas::RtpCapabilitiesWrapper,
    },

    /// DJ transport is ready (Step 7 of DJ flow)
    DjTransportReady {
        /// Transport options for WebRTC connection
        #[serde(rename = "transportOptions")]
        transport_options: super::schemas::TransportOptions,
    },

    /// WebRTC transport connection completed
    TransportConnected {
        /// ID of the connected transport
        #[serde(rename = "transportId")]
        transport_id: String,
    },
    
    /// Audio producer has been created and is streaming
    ProducerCreated { 
        /// ID of the created producer
        #[serde(rename = "producerId")]
        producer_id: String,
        /// ID of the room where producer was created
        #[serde(rename = "roomId")]
        room_id: String,
    },
    
    /// Audio stream has been paused (DJ muted)
    StreamPaused { 
        /// ID of the room where stream was paused
        #[serde(rename = "roomId")]
        room_id: String,
    },
    
    /// Audio stream has been resumed (DJ unmuted)
    StreamResumed { 
        /// ID of the room where stream was resumed
        #[serde(rename = "roomId")]
        room_id: String,
    },

    /// Room has been closed by DJ
    RoomClosed {
        /// ID of the closed room
        #[serde(rename = "roomId")]
        room_id: String,
        /// Reason for closing
        reason: String,
    },

    /// Listener count has been updated - delivered to the DJ so they can see
    /// how many people are currently hearing them. Mirrors the listener-side
    /// ListenerEvent::ListenerCountUpdated shape; emitted at the same
    /// count-change points (join/leave/reap).
    ListenerCountUpdated {
        /// ID of the room
        #[serde(rename = "roomId")]
        room_id: String,
        /// New listener count
        count: u32,
    },

    /// A command failed to execute
    CommandFailed {
        /// The command that failed
        command: String,
        /// Error description
        error: String,
    },

    /// Room not found error
    RoomNotFound {
        /// ID of the room that wasn't found
        #[serde(rename = "roomId")]
        room_id: String,
    },
}

/// Events sent from server to listener clients
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ListenerEvent {
    /// Listener transport is ready (Step 2 of listener flow)
    ListenerTransportReady {
        /// Transport options for WebRTC connection
        #[serde(rename = "transportOptions")]
        transport_options: super::schemas::TransportOptions,
    },

    /// Room is ready for joining (listener flow)
    JoinReady {
        /// Room information (clean model for clients)
        room: RoomInfo,
        /// Transport options for WebRTC connection
        #[serde(rename = "transportOptions")]
        transport_options: super::schemas::TransportOptions,
        /// Producer ID to consume from (guaranteed to exist)
        #[serde(rename = "producerId")]
        producer_id: String,
        /// RTP capabilities for consuming
        #[serde(rename = "rtpCapabilities")]
        rtp_capabilities: super::schemas::RtpCapabilitiesWrapper,
    },

    /// WebRTC transport connection completed
    TransportConnected {
        /// ID of the connected transport
        #[serde(rename = "transportId")]
        transport_id: String,
    },
    
    /// Audio consumer has been created for listening
    ConsumerCreated {
        /// ID of the created consumer
        #[serde(rename = "consumerId")]
        consumer_id: String,
        /// ID of the producer being consumed
        #[serde(rename = "producerId")]
        producer_id: String,
        /// Consumer parameters for WebRTC
        #[serde(rename = "consumerParameters")]
        consumer_parameters: super::schemas::ConsumerParameters,
    },

    /// Router RTP capabilities for device initialization
    RouterCapabilities {
        /// ID of the room these capabilities are for
        #[serde(rename = "roomId")]
        room_id: String,
        /// Router RTP capabilities (native MediaSoup type)
        #[serde(rename = "rtpCapabilities")]
        rtp_capabilities: super::schemas::RtpCapabilitiesWrapper,
    },
    
    /// Listener count has been updated
    ListenerCountUpdated {
        /// ID of the room
        #[serde(rename = "roomId")]
        room_id: String,
        /// New listener count
        count: u32,
    },

    /// Audio stream has been paused (DJ muted) - broadcasted to listeners
    StreamPaused { 
        /// ID of the room where stream was paused
        #[serde(rename = "roomId")]
        room_id: String,
    },
    
    /// Audio stream has been resumed (DJ unmuted) - broadcasted to listeners
    StreamResumed {
        /// ID of the room where stream was resumed
        #[serde(rename = "roomId")]
        room_id: String,
    },

    /// The room's audio producer was REPLACED (DJ re-ran the publish flow,
    /// e.g. page reload or reconnect-then-Go-Live). Replacing drops the old
    /// producer, which mediasoup closes — killing every existing consumer
    /// server-side while listener transports stay ICE/DTLS-connected, so
    /// clients see a "healthy" session over permanent silence. Broadcasted to
    /// listeners, who MUST treat it as a forced full re-join trigger.
    ProducerChanged {
        /// ID of the room whose producer was replaced
        #[serde(rename = "roomId")]
        room_id: String,
        /// ID of the NEW producer to consume from
        #[serde(rename = "producerId")]
        producer_id: String,
    },

    /// Room has been closed by DJ - broadcasted to listeners
    RoomClosed {
        /// ID of the closed room
        #[serde(rename = "roomId")]
        room_id: String,
        /// Reason for closing
        reason: String,
    },
    
    /// A command failed to execute
    CommandFailed { 
        /// The command that failed
        command: String,
        /// Error description
        error: String,
    },

    /// Room not found error
    RoomNotFound {
        /// ID of the room that wasn't found
        #[serde(rename = "roomId")]
        room_id: String,
    },

    /// Application-level heartbeat pong (reply to ListenerCommand::Ping)
    Pong,

    /// Sent immediately before closing a WebSocket when the listener session is not found
    ListenerNotFound {
        /// ID of the room that was attempted
        #[serde(rename = "roomId")]
        room_id: String,
    },
}

/// Events broadcast to all lobby clients
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum LobbyEvent {
    /// New room has been added to the lobby
    RoomAdded { 
        /// Information about the new room (clean model for clients)
        room: RoomInfo,
    },
    
    /// Existing room information has been updated
    RoomUpdated { 
        /// Updated room information (clean model for clients)
        room: RoomInfo,
    },
    
    /// Room has been removed from the lobby
    RoomRemoved { 
        /// ID of the removed room
        #[serde(rename = "roomId")]
        room_id: String,
    },

    /// Response to requestJoin command with unique listener WebSocket URL
    JoinRoomResponse {
        /// Session ID that requested the join
        #[serde(rename = "sessionId")]
        session_id: String,
        /// ID of the room being joined
        #[serde(rename = "roomId")]
        room_id: String,
        /// Whether the join request was successful
        success: bool,
        /// Error message if join failed
        error: Option<String>,
        /// Unique WebSocket URL for listener connection (if successful)
        #[serde(rename = "listenerWebSocketUrl")]
        listener_websocket_url: Option<String>,
        /// Room information (if successful)
        room: Option<RoomInfo>,
    },
}

impl DjEvent {
    /// Get the event type as a string for logging
    pub fn event_type(&self) -> &'static str {
        match self {
            Self::RoomAnnounced { .. } => "roomAnnounced",
            Self::RoomInitialized { .. } => "roomInitialized",
            Self::DjTransportReady { .. } => "djTransportReady",
            Self::TransportConnected { .. } => "transportConnected",
            Self::ProducerCreated { .. } => "producerCreated",
            Self::StreamPaused { .. } => "streamPaused",
            Self::StreamResumed { .. } => "streamResumed",
            Self::RoomClosed { .. } => "roomClosed",
            Self::ListenerCountUpdated { .. } => "listenerCountUpdated",
            Self::CommandFailed { .. } => "commandFailed",
            Self::RoomNotFound { .. } => "roomNotFound",
        }
    }
}

impl ListenerEvent {
    /// Get the event type as a string for logging
    pub fn event_type(&self) -> &'static str {
        match self {
            Self::ListenerTransportReady { .. } => "listenerTransportReady",
            Self::JoinReady { .. } => "joinReady",
            Self::TransportConnected { .. } => "transportConnected",
            Self::ConsumerCreated { .. } => "consumerCreated",
            Self::RouterCapabilities { .. } => "routerCapabilities",
            Self::ListenerCountUpdated { .. } => "listenerCountUpdated",
            Self::StreamPaused { .. } => "streamPaused",
            Self::StreamResumed { .. } => "streamResumed",
            Self::ProducerChanged { .. } => "producerChanged",
            Self::RoomClosed { .. } => "roomClosed",
            Self::CommandFailed { .. } => "commandFailed",
            Self::RoomNotFound { .. } => "roomNotFound",
            Self::Pong => "pong",
            Self::ListenerNotFound { .. } => "listenerNotFound",
        }
    }
}

impl LobbyEvent {
    /// Get the event type as a string for logging
    pub fn event_type(&self) -> &'static str {
        match self {
            Self::RoomAdded { .. } => "roomAdded",
            Self::RoomUpdated { .. } => "roomUpdated",
            Self::RoomRemoved { .. } => "roomRemoved",
            Self::JoinRoomResponse { .. } => "joinRoomResponse",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_listener_pong_serializes() {
        let event = ListenerEvent::Pong;
        let json = serde_json::to_string(&event).expect("Should serialize Pong");
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["type"], "pong");
    }

    #[test]
    fn test_listener_not_found_serializes() {
        let event = ListenerEvent::ListenerNotFound {
            room_id: "room-abc".to_string(),
        };
        let json = serde_json::to_string(&event).expect("Should serialize ListenerNotFound");
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["type"], "listenerNotFound");
        assert_eq!(value["roomId"], "room-abc");
    }

    #[test]
    fn test_producer_changed_serializes_camel_case() {
        let event = ListenerEvent::ProducerChanged {
            room_id: "room-abc".to_string(),
            producer_id: "producer-xyz".to_string(),
        };
        let json = serde_json::to_string(&event).expect("Should serialize ProducerChanged");
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["type"], "producerChanged");
        assert_eq!(value["roomId"], "room-abc");
        assert_eq!(value["producerId"], "producer-xyz");
        // Must NOT contain snake_case keys (frontend schema decodes camelCase)
        assert!(!json.contains("room_id"), "JSON should not contain room_id (snake_case)");
        assert!(!json.contains("producer_id"), "JSON should not contain producer_id (snake_case)");
    }

    #[test]
    fn test_dj_listener_count_updated_serializes_camel_case() {
        let event = DjEvent::ListenerCountUpdated {
            room_id: "room-abc".to_string(),
            count: 7,
        };
        let json = serde_json::to_string(&event).expect("Should serialize ListenerCountUpdated");
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["type"], "listenerCountUpdated");
        assert_eq!(value["roomId"], "room-abc");
        assert_eq!(value["count"], 7);
        // Must NOT contain snake_case keys (frontend schema decodes camelCase)
        assert!(!json.contains("room_id"), "JSON should not contain room_id (snake_case)");
    }

    #[test]
    fn test_dj_listener_count_updated_event_type() {
        let event = DjEvent::ListenerCountUpdated {
            room_id: "room-abc".to_string(),
            count: 1,
        };
        assert_eq!(event.event_type(), "listenerCountUpdated");
    }

    #[test]
    fn test_listener_not_found_has_camel_case_room_id() {
        let event = ListenerEvent::ListenerNotFound {
            room_id: "test-room".to_string(),
        };
        let json = serde_json::to_string(&event).unwrap();
        // Must NOT contain snake_case "room_id" key
        assert!(!json.contains("room_id"), "JSON should not contain room_id (snake_case)");
        assert!(json.contains("roomId"), "JSON must contain roomId (camelCase)");
    }
}

