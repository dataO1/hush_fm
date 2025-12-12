use serde::{Deserialize, Serialize};
use schemars::JsonSchema;
use utoipa::ToSchema;
use serde_with::{serde_as, Schema};
use super::events::RoomInfo;
use super::mediasoup_schemas::{MediaSoupRtpParameters, MediaSoupRtpCapabilities, MediaSoupDtlsParameters, MediaSoupIceParameters};
use uuid::Uuid;
use std::collections::HashMap;
use mediasoup::prelude::*;
use mediasoup_types::data_structures::{DtlsRole, DtlsFingerprint};


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

/// DTLS fingerprint wrapper with proper serialization
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, ToSchema)]
pub struct DtlsFingerprintWrapper {
    /// Hash algorithm name (e.g., "sha-256")
    pub algorithm: String,
    /// Fingerprint value as colon-separated hex string
    pub value: String,
}

impl From<DtlsFingerprint> for DtlsFingerprintWrapper {
    fn from(fp: DtlsFingerprint) -> Self {
        match fp {
            DtlsFingerprint::Sha1 { value } => Self {
                algorithm: "sha-1".to_string(),
                value: hex::encode(value),
            },
            DtlsFingerprint::Sha224 { value } => Self {
                algorithm: "sha-224".to_string(),
                value: hex::encode(value),
            },
            DtlsFingerprint::Sha256 { value } => Self {
                algorithm: "sha-256".to_string(),
                value: hex::encode(value),
            },
            DtlsFingerprint::Sha384 { value } => Self {
                algorithm: "sha-384".to_string(),
                value: hex::encode(value),
            },
            DtlsFingerprint::Sha512 { value } => Self {
                algorithm: "sha-512".to_string(),
                value: hex::encode(value),
            },
        }
    }
}

/// DTLS parameters wrapper with proper serialization
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, ToSchema)]
pub struct DtlsParametersWrapper {
    /// DTLS role as string: "auto", "client", or "server"
    pub role: String,
    /// DTLS fingerprints array
    pub fingerprints: Vec<DtlsFingerprintWrapper>,
}

impl From<DtlsParameters> for DtlsParametersWrapper {
    fn from(dtls: DtlsParameters) -> Self {
        Self {
            role: match dtls.role {
                DtlsRole::Auto => "auto".to_string(),
                DtlsRole::Client => "client".to_string(),
                DtlsRole::Server => "server".to_string(),
            },
            fingerprints: dtls.fingerprints.iter().map(|fp| fp.clone().into()).collect(),
        }
    }
}

/// ICE parameters wrapper with proper serialization
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct IceParametersWrapper {
    /// ICE username fragment
    pub username_fragment: String,
    /// ICE password
    pub password: String,
    /// ICE lite flag
    pub ice_lite: Option<bool>,
}

impl From<IceParameters> for IceParametersWrapper {
    fn from(ice: IceParameters) -> Self {
        Self {
            username_fragment: ice.username_fragment,
            password: ice.password,
            ice_lite: ice.ice_lite,
        }
    }
}

/// WebRTC transport options for client connection
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TransportOptions {
    /// Transport ID uniquely identifying this WebRTC transport
    pub id: String,
    
    /// ICE parameters for WebRTC connectivity establishment
    pub ice_parameters: IceParametersWrapper,
    
    /// ICE candidates (empty for local network optimization)
    pub ice_candidates: Vec<IceCandidateSchema>,
    
    /// DTLS parameters for secure connection establishment
    pub dtls_parameters: DtlsParametersWrapper,
    
    /// SCTP parameters for data channel support (if applicable)
    pub sctp_parameters: Option<serde_json::Value>,
}

/// RTP capabilities wrapper for API serialization
/// 
/// Wraps MediaSoup's RtpCapabilities with proper JsonSchema support for OpenAPI generation.
/// This ensures the frontend gets properly typed schemas while maintaining compatibility
/// with MediaSoup's native types.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, ToSchema)]
pub struct RtpCapabilitiesWrapper {
    /// Supported codecs with their capabilities
    pub codecs: Vec<serde_json::Value>,
    /// Supported RTP header extensions
    #[serde(rename = "headerExtensions")]
    pub header_extensions: Vec<serde_json::Value>,
    /// Forward Error Correction mechanisms (optional)
    #[serde(rename = "fecMechanisms", default)]
    pub fec_mechanisms: Vec<serde_json::Value>,
}

impl From<mediasoup::prelude::RtpCapabilities> for RtpCapabilitiesWrapper {
    fn from(caps: mediasoup::prelude::RtpCapabilities) -> Self {
        Self {
            codecs: serde_json::to_value(&caps.codecs).unwrap_or_default().as_array().cloned().unwrap_or_default(),
            header_extensions: serde_json::to_value(&caps.header_extensions).unwrap_or_default().as_array().cloned().unwrap_or_default(),
            fec_mechanisms: vec![], // MediaSoup doesn't always include FEC mechanisms
        }
    }
}

impl From<mediasoup::prelude::RtpCapabilitiesFinalized> for RtpCapabilitiesWrapper {
    fn from(caps: mediasoup::prelude::RtpCapabilitiesFinalized) -> Self {
        Self {
            codecs: serde_json::to_value(&caps.codecs).unwrap_or_default().as_array().cloned().unwrap_or_default(),
            header_extensions: serde_json::to_value(&caps.header_extensions).unwrap_or_default().as_array().cloned().unwrap_or_default(),
            fec_mechanisms: vec![], // MediaSoup doesn't always include FEC mechanisms
        }
    }
}

/// Convert from our wrapper back to MediaSoup type (for use with MediaSoup APIs)
impl TryFrom<RtpCapabilitiesWrapper> for mediasoup::prelude::RtpCapabilities {
    type Error = serde_json::Error;
    
    fn try_from(wrapper: RtpCapabilitiesWrapper) -> Result<Self, Self::Error> {
        // Create a JSON object matching MediaSoup's expected format
        let json_value = serde_json::json!({
            "codecs": wrapper.codecs,
            "headerExtensions": wrapper.header_extensions,
            "fecMechanisms": wrapper.fec_mechanisms
        });
        
        serde_json::from_value(json_value)
    }
}

/// Room info response (without consumer creation)
#[derive(Debug, Clone, Serialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoomInfoResponse {
    /// Room information (clean client model)
    pub room: RoomInfo,
    
    /// Router RTP capabilities for device initialization
    pub rtp_capabilities: RtpCapabilitiesWrapper,
    
    /// Producer ID (if streaming)
    pub producer_id: Option<String>,
}

/// Join room request with listener RTP capabilities
#[derive(Debug, Clone, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct JoinRoomRequest {
    /// Listener's device RTP capabilities
    pub rtp_capabilities: RtpCapabilitiesWrapper,
}

/// RTP parameters wrapper for proper API serialization
/// 
/// Wraps MediaSoup's RtpParameters to provide JsonSchema support while maintaining
/// perfect compatibility with MediaSoup client expectations.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RtpParametersWrapper {
    /// Media identifier (optional)
    pub mid: Option<String>,
    /// RTP codecs configuration
    pub codecs: Vec<serde_json::Value>,
    /// RTP header extensions
    pub header_extensions: Vec<serde_json::Value>,
    /// RTP encoding parameters
    pub encodings: Vec<serde_json::Value>,
    /// RTCP configuration
    pub rtcp: Option<serde_json::Value>,
}

impl From<RtpParameters> for RtpParametersWrapper {
    fn from(rtp: RtpParameters) -> Self {
        let rtp_value = serde_json::to_value(&rtp).unwrap_or_default();
        
        Self {
            mid: rtp_value.get("mid").and_then(|v| v.as_str()).map(|s| s.to_string()),
            codecs: rtp_value.get("codecs").and_then(|v| v.as_array()).cloned().unwrap_or_default(),
            header_extensions: rtp_value.get("headerExtensions").and_then(|v| v.as_array()).cloned().unwrap_or_default(),
            encodings: rtp_value.get("encodings").and_then(|v| v.as_array()).cloned().unwrap_or_default(),
            rtcp: rtp_value.get("rtcp").cloned(),
        }
    }
}

/// Consumer parameters for audio consumption
/// 
/// Contains all necessary information for a client to create a MediaSoup consumer
/// and receive audio from a producer.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConsumerParameters {
    /// Consumer ID uniquely identifying this consumer
    pub id: String,
    
    /// Producer ID that this consumer is consuming from
    pub producer_id: String,
    
    /// Media kind - always "audio" for HushFM audio streaming
    pub kind: String,
    
    /// RTP parameters for media consumption
    pub rtp_parameters: RtpParametersWrapper,
    
    /// Consumer type - "simple" for standard consumption  
    pub r#type: String,
    
    /// Whether the producer is initially paused
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
    pub rtp_capabilities: RtpCapabilitiesWrapper,
    
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