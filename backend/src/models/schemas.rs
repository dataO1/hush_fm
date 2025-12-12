use serde::{Deserialize, Serialize};
use schemars::JsonSchema;
use utoipa::ToSchema;
use super::events::RoomInfo;
use uuid::Uuid;
use std::collections::HashMap;

/// DTLS fingerprint for API responses (clean schema for OpenAPI)
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, ToSchema)]
pub struct DtlsFingerprintSchema {
    /// Hash algorithm name (e.g., "sha-256")
    pub algorithm: String,
    /// Fingerprint value as colon-separated hex string
    pub value: String,
}

/// DTLS parameters for API responses (clean schema for OpenAPI)
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, ToSchema)]
pub struct DtlsParametersSchema {
    /// DTLS role as string: "auto", "client", or "server"
    pub role: String,
    /// DTLS fingerprints array
    pub fingerprints: Vec<DtlsFingerprintSchema>,
}

/// ICE parameters for API responses
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct IceParametersSchema {
    /// ICE username fragment
    pub username_fragment: String,
    /// ICE password
    pub password: String,
    /// ICE lite flag
    pub ice_lite: Option<bool>,
}

/// ICE candidate for API responses
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, ToSchema)]
pub struct IceCandidateSchema {
    /// Foundation
    pub foundation: String,
    /// Component ID
    pub component: u32,
    /// Transport protocol
    pub protocol: String,
    /// Priority
    pub priority: u64,
    /// IP address
    pub ip: String,
    /// Port number
    pub port: u16,
    /// Candidate type
    #[serde(rename = "type")]
    pub candidate_type: String,
}

/// Trace context for distributed tracing (W3C Trace Context)
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TraceContext {
    /// W3C traceparent header value
    pub traceparent: String,
    
    /// Optional W3C tracestate header value
    pub tracestate: Option<String>,
    
    /// Additional trace metadata
    pub metadata: Option<HashMap<String, String>>,
}

/// WebRTC transport options for client connection
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TransportOptions {
    /// Transport ID
    pub id: String,
    
    /// ICE parameters for WebRTC
    pub ice_parameters: IceParametersSchema,
    
    /// ICE candidates (empty for local network optimization)
    pub ice_candidates: Vec<IceCandidateSchema>,
    
    /// DTLS parameters for secure connection
    pub dtls_parameters: DtlsParametersSchema,
    
    /// SCTP parameters (if applicable)
    pub sctp_parameters: Option<serde_json::Value>,
}

/// RTP capabilities for media consumption
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, ToSchema)]
pub struct RtpCapabilities {
    /// Supported codecs
    pub codecs: Vec<serde_json::Value>,
    
    /// Header extensions
    #[serde(rename = "headerExtensions")]
    pub header_extensions: Vec<serde_json::Value>,
    
    /// FEC mechanisms (optional as MediaSoup doesn't always include this)
    #[serde(rename = "fecMechanisms", default)]
    pub fec_mechanisms: Vec<serde_json::Value>,
}

/// Room info response (without consumer creation)
#[derive(Debug, Clone, Serialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoomInfoResponse {
    /// Room information (clean client model)
    pub room: RoomInfo,
    
    /// Router RTP capabilities for device initialization
    pub rtp_capabilities: RtpCapabilities,
    
    /// Producer ID (if streaming)
    pub producer_id: Option<String>,
}

/// Join room request with listener RTP capabilities
#[derive(Debug, Clone, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct JoinRoomRequest {
    /// Listener's device RTP capabilities
    pub rtp_capabilities: RtpCapabilities,
}

/// Consumer parameters for audio consumption
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConsumerParameters {
    /// Consumer ID
    pub id: String,
    
    /// Producer ID being consumed
    pub producer_id: String,
    
    /// Media kind (always "audio" for HushFM)
    pub kind: String,
    
    /// RTP parameters for consumption
    pub rtp_parameters: serde_json::Value,
    
    /// Consumer type
    pub r#type: String,
    
    /// Whether consumer is paused initially
    pub producer_paused: bool,
}

/// Connection state information
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionState {
    /// Transport is being created
    Connecting,
    
    /// Transport is ready for use
    Connected,
    
    /// Transport connection completed
    Completed,
    
    /// Transport failed to connect
    Failed,
    
    /// Transport disconnected
    Disconnected,
    
    /// Transport closed
    Closed,
}

/// Room creation request
#[derive(Debug, Clone, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateRoomRequest {
    /// Room name
    pub name: String,
    
    /// Optional room description
    pub description: Option<String>,
    
    /// Optional room tags
    pub tags: Option<Vec<String>>,
    
    /// DJ's display name
    pub dj_name: String,
}

/// Room creation response
#[derive(Debug, Clone, Serialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateRoomResponse {
    /// Created room information (clean client model)
    pub room: RoomInfo,
    
    /// DJ authentication token
    pub dj_token: String,
    
    /// WebRTC transport options for DJ
    pub transport_options: TransportOptions,
    
    /// Router RTP capabilities for device initialization
    pub rtp_capabilities: RtpCapabilities,
    
    /// WebSocket URL for room communication
    pub ws_url: String,
}

/// Join room response
#[derive(Debug, Clone, Serialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct JoinRoomResponse {
    /// Room information (clean client model)
    pub room: RoomInfo,
    
    /// WebRTC transport options for listener
    pub transport_options: TransportOptions,
    
    /// Producer ID to consume from (if streaming)
    pub producer_id: Option<String>,
    
    /// Consumer parameters (if producer is available)
    pub consumer_parameters: Option<ConsumerParameters>,
}

/// Error response
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ErrorResponse {
    /// Error code
    pub code: String,
    
    /// Human-readable error message
    pub message: String,
    
    /// Additional error details
    pub details: Option<serde_json::Value>,
    
    /// Trace ID for debugging
    pub trace_id: Option<String>,
}

/// Unified Room model (used everywhere - API, internal logic, etc.)
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Room {
    /// Unique room identifier
    #[serde(with = "super::uuid_string")]
    #[schemars(with = "String")]
    pub id: Uuid,
    
    /// Human-readable room name
    pub name: String,
    
    /// DJ's display name or ID
    #[serde(rename = "djName")]
    pub dj_id: String,
    
    /// Current number of listeners
    pub listener_count: u32,
    
    /// Whether the DJ is currently streaming audio
    #[serde(rename = "isStreaming")]
    pub dj_streaming: bool,
    
    /// When the room was created (ISO8601 format)
    #[serde(with = "iso8601_datetime")]
    #[schemars(with = "String")]
    #[schema(value_type = String, example = "2023-11-07T12:00:00Z")]
    pub created_at: chrono::DateTime<chrono::Utc>,
    
    /// Optional room description
    pub description: Option<String>,
    
    /// Room tags for categorization
    pub tags: Vec<String>,
    
    /// Internal field for tracking activity (not serialized to API)
    #[serde(skip)]
    pub last_activity: chrono::DateTime<chrono::Utc>,
}

/// Custom serialization for ISO8601 datetime
pub mod iso8601_datetime {
    use chrono::{DateTime, Utc};
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<S>(dt: &DateTime<Utc>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        dt.to_rfc3339().serialize(serializer)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<DateTime<Utc>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        s.parse::<DateTime<Utc>>().map_err(serde::de::Error::custom)
    }
}