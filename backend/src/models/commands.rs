use serde::{Deserialize, Serialize};
use schemars::JsonSchema;
use super::TraceContext;

/// Commands sent from client to server
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ClientCommand {
    // DJ Commands - Room Management
    #[serde(rename_all = "camelCase")]
    ConnectTransport { 
        /// DTLS parameters for WebRTC transport connection
        dtls_parameters: serde_json::Value,
        /// Optional trace context for request tracing
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },
    
    #[serde(rename_all = "camelCase")]
    Produce { 
        /// RTP parameters for media production
        rtp_parameters: serde_json::Value,
        /// Optional trace context for request tracing
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },
    
    /// Pause the audio stream (mute microphone)
    #[serde(rename_all = "camelCase")]
    PauseStream {
        /// Optional trace context for request tracing
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },
    
    /// Resume the audio stream (unmute microphone)
    #[serde(rename_all = "camelCase")]
    ResumeStream {
        /// Optional trace context for request tracing
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },
    
    /// Close the room and stop broadcasting
    #[serde(rename_all = "camelCase")]
    CloseRoom {
        /// Optional trace context for request tracing
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },
    
    // Listener Commands - Audio Consumption
    #[serde(rename_all = "camelCase")]
    JoinRoom { 
        /// ID of the room to join
        room_id: String,
        /// Optional trace context for request tracing
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },
    
    #[serde(rename_all = "camelCase")]
    ConnectListenerTransport {
        /// DTLS parameters for WebRTC transport connection
        dtls_parameters: serde_json::Value,
        /// Optional trace context for request tracing
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },
    
    #[serde(rename_all = "camelCase")]
    ConsumeAudio {
        /// Producer ID to consume from
        producer_id: String,
        /// Optional trace context for request tracing
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },
    
    /// Leave the current room
    #[serde(rename_all = "camelCase")]
    LeaveRoom {
        /// Optional trace context for request tracing
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },
}

impl ClientCommand {
    /// Extract trace context from any command
    pub fn trace_context(&self) -> Option<&TraceContext> {
        match self {
            Self::ConnectTransport { trace_context, .. } => trace_context.as_ref(),
            Self::Produce { trace_context, .. } => trace_context.as_ref(),
            Self::PauseStream { trace_context } => trace_context.as_ref(),
            Self::ResumeStream { trace_context } => trace_context.as_ref(),
            Self::CloseRoom { trace_context } => trace_context.as_ref(),
            Self::JoinRoom { trace_context, .. } => trace_context.as_ref(),
            Self::ConnectListenerTransport { trace_context, .. } => trace_context.as_ref(),
            Self::ConsumeAudio { trace_context, .. } => trace_context.as_ref(),
            Self::LeaveRoom { trace_context } => trace_context.as_ref(),
        }
    }
    
    /// Get the command type as a string for logging
    pub fn command_type(&self) -> &'static str {
        match self {
            Self::ConnectTransport { .. } => "connectTransport",
            Self::Produce { .. } => "produce",
            Self::PauseStream { .. } => "pauseStream",
            Self::ResumeStream { .. } => "resumeStream",
            Self::CloseRoom { .. } => "closeRoom",
            Self::JoinRoom { .. } => "joinRoom",
            Self::ConnectListenerTransport { .. } => "connectListenerTransport",
            Self::ConsumeAudio { .. } => "consumeAudio",
            Self::LeaveRoom { .. } => "leaveRoom",
        }
    }
}