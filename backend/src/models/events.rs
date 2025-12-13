use serde::Serialize;
use schemars::JsonSchema;
use utoipa::ToSchema;
use super::TraceContext;
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
        Self {
            id: room.id,
            name: room.name,
            dj_name: room.dj_id, // Map dj_id to dj_name for client
            listener_count: room.listener_count,
            is_streaming: room.dj_streaming,
            created_at: room.created_at.to_rfc3339(),
            description: room.description,
            tags: room.tags,
        }
    }
}

/// Events sent from server to client
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ServerEvent {
    // Connection Events
    /// WebRTC transport is ready for use
    #[serde(rename_all = "camelCase")]
    TransportReady { 
        /// ID of the created transport
        transport_id: String,
        /// Optional trace context for request tracing
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },
    
    /// WebRTC transport connection completed
    #[serde(rename_all = "camelCase")]
    TransportConnected {
        /// ID of the connected transport
        transport_id: String,
        /// Optional trace context for request tracing
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },
    
    // Production Events
    /// Audio producer has been created and is streaming
    #[serde(rename_all = "camelCase")]
    ProducerCreated { 
        /// ID of the created producer
        producer_id: String,
        /// ID of the room where producer was created
        room_id: String,
        /// Optional trace context for request tracing
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },
    
    // Consumer Events  
    /// Audio consumer has been created for listening
    #[serde(rename_all = "camelCase")]
    ConsumerCreated {
        /// ID of the created consumer
        consumer_id: String,
        /// ID of the producer being consumed
        producer_id: String,
        /// Consumer parameters for WebRTC
        consumer_parameters: super::schemas::ConsumerParameters,
        /// Optional trace context for request tracing
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },
    
    // Stream Events
    /// Audio stream has been paused (DJ muted)
    #[serde(rename_all = "camelCase")]
    StreamPaused { 
        /// ID of the room where stream was paused
        room_id: String,
        /// Optional trace context for request tracing
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },
    
    /// Audio stream has been resumed (DJ unmuted)
    #[serde(rename_all = "camelCase")]
    StreamResumed { 
        /// ID of the room where stream was resumed
        room_id: String,
        /// Optional trace context for request tracing
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },
    
    // Room Events
    /// Room is ready for joining (listener flow)
    #[serde(rename_all = "camelCase")]
    JoinReady {
        /// Room information (clean model for clients)
        room: RoomInfo,
        /// Transport options for WebRTC connection
        transport_options: super::schemas::TransportOptions,
        /// Producer ID to consume from (guaranteed to exist)
        producer_id: String,
        /// RTP capabilities for consuming
        rtp_capabilities: super::schemas::RtpCapabilitiesWrapper,
        /// Optional trace context for request tracing
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },

    /// Successfully joined a room as a listener
    #[serde(rename_all = "camelCase")]
    RoomJoined {
        /// Room information (clean model for clients)
        room: RoomInfo,
        /// Transport options for WebRTC connection
        transport_options: super::schemas::TransportOptions,
        /// Producer ID to consume from (if available)
        producer_id: Option<String>,
        /// RTP capabilities for consuming
        rtp_capabilities: super::schemas::RtpCapabilitiesWrapper,
        /// Optional trace context for request tracing
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },
    
    /// Room has been closed by DJ
    #[serde(rename_all = "camelCase")]
    RoomClosed { 
        /// ID of the closed room
        room_id: String,
        /// Reason for closing
        reason: String,
        /// Optional trace context for request tracing
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },
    
    /// Listener count has been updated
    #[serde(rename_all = "camelCase")]
    ListenerCountUpdated {
        /// ID of the room
        room_id: String,
        /// New listener count
        count: u32,
        /// Optional trace context for request tracing
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },
    
    // Error Events
    /// A command failed to execute
    #[serde(rename_all = "camelCase")]
    CommandFailed { 
        /// The command that failed
        command: String,
        /// Error description
        error: String,
        /// Optional trace context for request tracing
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },
    
    /// Authentication error
    #[serde(rename_all = "camelCase")]
    AuthenticationError {
        /// Error message
        message: String,
        /// Optional trace context for request tracing
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },
    
    /// Router RTP capabilities for device initialization
    #[serde(rename_all = "camelCase")]
    RouterCapabilities {
        /// ID of the room these capabilities are for
        room_id: String,
        /// Router RTP capabilities (native MediaSoup type)
        rtp_capabilities: super::schemas::RtpCapabilitiesWrapper,
        /// Optional trace context for request tracing
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },

    /// Room not found error
    #[serde(rename_all = "camelCase")]
    RoomNotFound {
        /// ID of the room that wasn't found
        room_id: String,
        /// Optional trace context for request tracing
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },
}

/// Events broadcast to all lobby clients
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum LobbyEvent {
    /// New room has been added to the lobby
    #[serde(rename_all = "camelCase")]
    RoomAdded { 
        /// Information about the new room (clean model for clients)
        room: RoomInfo,
        /// Optional trace context for request tracing
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },
    
    /// Existing room information has been updated
    #[serde(rename_all = "camelCase")]
    RoomUpdated { 
        /// Updated room information (clean model for clients)
        room: RoomInfo,
        /// Optional trace context for request tracing
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },
    
    /// Room has been removed from the lobby
    #[serde(rename_all = "camelCase")]
    RoomRemoved { 
        /// ID of the removed room
        room_id: String,
        /// Optional trace context for request tracing
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },
}

impl ServerEvent {
    /// Extract trace context from any event
    pub fn trace_context(&self) -> Option<&TraceContext> {
        match self {
            Self::TransportReady { trace_context, .. } => trace_context.as_ref(),
            Self::TransportConnected { trace_context, .. } => trace_context.as_ref(),
            Self::ProducerCreated { trace_context, .. } => trace_context.as_ref(),
            Self::ConsumerCreated { trace_context, .. } => trace_context.as_ref(),
            Self::StreamPaused { trace_context, .. } => trace_context.as_ref(),
            Self::StreamResumed { trace_context, .. } => trace_context.as_ref(),
            Self::JoinReady { trace_context, .. } => trace_context.as_ref(),
            Self::RoomJoined { trace_context, .. } => trace_context.as_ref(),
            Self::RoomClosed { trace_context, .. } => trace_context.as_ref(),
            Self::ListenerCountUpdated { trace_context, .. } => trace_context.as_ref(),
            Self::CommandFailed { trace_context, .. } => trace_context.as_ref(),
            Self::AuthenticationError { trace_context, .. } => trace_context.as_ref(),
            Self::RouterCapabilities { trace_context, .. } => trace_context.as_ref(),
            Self::RoomNotFound { trace_context, .. } => trace_context.as_ref(),
        }
    }
    
    /// Set trace context on any event (mutably)
    pub fn set_trace_context(&mut self, trace_context: Option<TraceContext>) {
        match self {
            Self::TransportReady { trace_context: ref mut tc, .. } => *tc = trace_context,
            Self::TransportConnected { trace_context: ref mut tc, .. } => *tc = trace_context,
            Self::ProducerCreated { trace_context: ref mut tc, .. } => *tc = trace_context,
            Self::ConsumerCreated { trace_context: ref mut tc, .. } => *tc = trace_context,
            Self::StreamPaused { trace_context: ref mut tc, .. } => *tc = trace_context,
            Self::StreamResumed { trace_context: ref mut tc, .. } => *tc = trace_context,
            Self::JoinReady { trace_context: ref mut tc, .. } => *tc = trace_context,
            Self::RoomJoined { trace_context: ref mut tc, .. } => *tc = trace_context,
            Self::RoomClosed { trace_context: ref mut tc, .. } => *tc = trace_context,
            Self::ListenerCountUpdated { trace_context: ref mut tc, .. } => *tc = trace_context,
            Self::CommandFailed { trace_context: ref mut tc, .. } => *tc = trace_context,
            Self::AuthenticationError { trace_context: ref mut tc, .. } => *tc = trace_context,
            Self::RouterCapabilities { trace_context: ref mut tc, .. } => *tc = trace_context,
            Self::RoomNotFound { trace_context: ref mut tc, .. } => *tc = trace_context,
        }
    }
    
    /// Get the event type as a string for logging
    pub fn event_type(&self) -> &'static str {
        match self {
            Self::TransportReady { .. } => "transportReady",
            Self::TransportConnected { .. } => "transportConnected", 
            Self::ProducerCreated { .. } => "producerCreated",
            Self::ConsumerCreated { .. } => "consumerCreated",
            Self::StreamPaused { .. } => "streamPaused",
            Self::StreamResumed { .. } => "streamResumed",
            Self::JoinReady { .. } => "joinReady",
            Self::RoomJoined { .. } => "roomJoined",
            Self::RoomClosed { .. } => "roomClosed",
            Self::ListenerCountUpdated { .. } => "listenerCountUpdated",
            Self::CommandFailed { .. } => "commandFailed",
            Self::AuthenticationError { .. } => "authenticationError",
            Self::RouterCapabilities { .. } => "routerCapabilities",
            Self::RoomNotFound { .. } => "roomNotFound",
        }
    }
}

