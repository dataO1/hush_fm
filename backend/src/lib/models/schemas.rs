use serde::{Deserialize, Serialize};
use schemars::JsonSchema;
use utoipa::ToSchema;
use super::events::RoomInfo;
use uuid::Uuid;
use std::sync::Arc;
use mediasoup::prelude::*;
use mediasoup_types::data_structures::{DtlsRole, DtlsFingerprint};
use mediasoup_types::rtp_parameters::{RtpCodecParametersParametersValue, RtpHeaderExtensionDirection};
use dashmap::DashMap;
use arc_swap::ArcSwap;

/// ICE candidateType for API responses
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum IceCandidateTypeSchema {
    Host,
    Srflx,
    Prflx,
    Relay,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ProtocolSchema {
    Tcp,
    Udp,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, ToSchema)]
pub enum IceCandidateTcpTypeSchema {
    Passive,
}

/// ICE candidate for API responses
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, ToSchema)]
pub struct IceCandidateSchema {
    pub foundation: String,
    pub priority: u32,
    pub address: String,
    pub protocol: ProtocolSchema,
    pub port: u16,
    #[serde(rename = "type")]
    pub candidate_type: IceCandidateTypeSchema,
    pub tcp_type: Option<IceCandidateTcpTypeSchema>,
}



/// Helper function to format hex bytes with colons (RFC 4572 format)
fn format_hex_with_colons(bytes: &[u8]) -> String {
    let hex_string = hex::encode_upper(bytes);
    // Insert colons between every 2 characters
    hex_string
        .chars()
        .collect::<Vec<_>>()
        .chunks(2)
        .map(|chunk| chunk.iter().collect::<String>())
        .collect::<Vec<_>>()
        .join(":")
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
                value: format_hex_with_colons(&value),
            },
            DtlsFingerprint::Sha224 { value } => Self {
                algorithm: "sha-224".to_string(),
                value: format_hex_with_colons(&value),
            },
            DtlsFingerprint::Sha256 { value } => Self {
                algorithm: "sha-256".to_string(),
                value: format_hex_with_colons(&value),
            },
            DtlsFingerprint::Sha384 { value } => Self {
                algorithm: "sha-384".to_string(),
                value: format_hex_with_colons(&value),
            },
            DtlsFingerprint::Sha512 { value } => Self {
                algorithm: "sha-512".to_string(),
                value: format_hex_with_colons(&value),
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

impl TryInto<DtlsParameters> for DtlsParametersWrapper {
    type Error = anyhow::Error;

    fn try_into(self) -> Result<DtlsParameters, Self::Error> {
        let role = match self.role.as_str() {
            "auto" => DtlsRole::Auto,
            "client" => DtlsRole::Client,
            "server" => DtlsRole::Server,
            _ => return Err(anyhow::anyhow!("Invalid DTLS role: {}", self.role)),
        };

        let fingerprints = self.fingerprints
            .into_iter()
            .map(|fp| {
                // Helper function to convert hex string to byte array
                fn hex_to_bytes<const N: usize>(hex: &str) -> Result<[u8; N], anyhow::Error> {
                    let hex_clean = hex.replace(":", "");
                    if hex_clean.len() != N * 2 {
                        return Err(anyhow::anyhow!("Invalid hex length: expected {}, got {}", N * 2, hex_clean.len()));
                    }

                    let mut bytes = [0u8; N];
                    for i in 0..N {
                        let byte_str = &hex_clean[i*2..i*2+2];
                        bytes[i] = u8::from_str_radix(byte_str, 16)
                            .map_err(|e| anyhow::anyhow!("Invalid hex byte: {}", e))?;
                    }
                    Ok(bytes)
                }

                match fp.algorithm.as_str() {
                    "sha-1" => Ok(DtlsFingerprint::Sha1 { value: hex_to_bytes::<20>(&fp.value)? }),
                    "sha-224" => Ok(DtlsFingerprint::Sha224 { value: hex_to_bytes::<28>(&fp.value)? }),
                    "sha-256" => Ok(DtlsFingerprint::Sha256 { value: hex_to_bytes::<32>(&fp.value)? }),
                    "sha-384" => Ok(DtlsFingerprint::Sha384 { value: hex_to_bytes::<48>(&fp.value)? }),
                    "sha-512" => Ok(DtlsFingerprint::Sha512 { value: hex_to_bytes::<64>(&fp.value)? }),
                    _ => Err(anyhow::anyhow!("Invalid fingerprint algorithm: {}", fp.algorithm)),
                }
            })
            .collect::<Result<Vec<_>, _>>()?;

        Ok(DtlsParameters { role, fingerprints })
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

/// RTP codec capability wrapper with proper typing
/// 
/// Strongly typed representation of MediaSoup's RtpCodecCapability::Audio variant
/// ensuring no undefined/unknown fields in frontend.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RtpCodecCapabilityWrapper {
    /// Media kind - always "audio" for HushFM
    pub kind: String,
    /// Codec MIME type (e.g., "audio/opus", "audio/PCMU")
    pub mime_type: String,
    /// Preferred payload type (96-127 for dynamic types)
    pub preferred_payload_type: Option<u8>,
    /// Codec clock rate in Hz (e.g., 48000 for Opus)
    pub clock_rate: u32,
    /// Number of audio channels (1 for mono, 2 for stereo)
    pub channels: u8,
    /// Codec-specific parameters (e.g., Opus: stereo=1, useinbandfec=1)
    pub parameters: std::collections::BTreeMap<String, String>,
    /// RTCP feedback mechanisms
    pub rtcp_feedback: Vec<RtcpFeedbackWrapper>,
}

/// RTP header extension wrapper with proper typing
/// 
/// Strongly typed representation of MediaSoup's RtpHeaderExtension
/// for audio streaming extensions like audio level and transport-wide CC.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RtpHeaderExtensionWrapper {
    /// Media kind - always "audio" for HushFM
    pub kind: String,
    /// Extension URI (e.g., "urn:ietf:params:rtp-hdrext:ssrc-audio-level")
    pub uri: String,
    /// Preferred numeric identifier (1-14)
    pub preferred_id: u16,
    /// Encryption preference (currently unused by MediaSoup)
    pub preferred_encrypt: bool,
    /// Direction capability ("sendrecv", "sendonly", "recvonly")
    pub direction: String,
}

/// RTCP feedback mechanism wrapper
/// 
/// Represents transport and codec feedback for network adaptation
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RtcpFeedbackWrapper {
    /// Feedback type (e.g., "transport-cc", "nack")
    pub r#type: String,
    /// Optional parameter (most feedback types don't need this)
    pub parameter: Option<String>,
}

/// RTP capabilities wrapper for API serialization
///
/// Strongly typed wrapper for MediaSoup's RtpCapabilities ensuring no undefined fields.
/// This provides full type safety for frontend while maintaining MediaSoup compatibility.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RtpCapabilitiesWrapper {
    /// Supported codecs with their complete configuration
    pub codecs: Vec<RtpCodecCapabilityWrapper>,
    /// Supported RTP header extensions for audio streaming
    pub header_extensions: Vec<RtpHeaderExtensionWrapper>,
}

/// Helper function to convert MediaSoup RTP parameters to strongly typed map
fn convert_rtp_parameters(params: mediasoup::prelude::RtpCodecParametersParameters) -> std::collections::BTreeMap<String, String> {
    let mut result = std::collections::BTreeMap::new();
    
    for (key, value) in params.iter() {
        let string_value = match value {
            RtpCodecParametersParametersValue::String(s) => s.to_string(),
            RtpCodecParametersParametersValue::Number(n) => n.to_string(),
        };
        result.insert(key.to_string(), string_value);
    }
    result
}

/// Helper function to convert MediaSoup RTCP feedback to wrapper
fn convert_rtcp_feedback(feedback: mediasoup::prelude::RtcpFeedback) -> RtcpFeedbackWrapper {
    match feedback {
        mediasoup::prelude::RtcpFeedback::Nack => RtcpFeedbackWrapper {
            r#type: "nack".to_string(),
            parameter: None,
        },
        mediasoup::prelude::RtcpFeedback::NackPli => RtcpFeedbackWrapper {
            r#type: "nack".to_string(),
            parameter: Some("pli".to_string()),
        },
        mediasoup::prelude::RtcpFeedback::CcmFir => RtcpFeedbackWrapper {
            r#type: "ccm".to_string(),
            parameter: Some("fir".to_string()),
        },
        mediasoup::prelude::RtcpFeedback::GoogRemb => RtcpFeedbackWrapper {
            r#type: "goog-remb".to_string(),
            parameter: None,
        },
        mediasoup::prelude::RtcpFeedback::TransportCc => RtcpFeedbackWrapper {
            r#type: "transport-cc".to_string(),
            parameter: None,
        },
        _ => RtcpFeedbackWrapper {
            r#type: "unknown".to_string(),
            parameter: None,
        },
    }
}

impl From<mediasoup::prelude::RtpCapabilities> for RtpCapabilitiesWrapper {
    fn from(caps: mediasoup::prelude::RtpCapabilities) -> Self {
        Self {
            codecs: caps.codecs.into_iter().filter_map(|codec| {
                // Only convert audio codecs for HushFM
                match codec {
                    mediasoup::prelude::RtpCodecCapability::Audio {
                        mime_type,
                        preferred_payload_type,
                        clock_rate,
                        channels,
                        parameters,
                        rtcp_feedback,
                    } => Some(RtpCodecCapabilityWrapper {
                        kind: "audio".to_string(),
                        mime_type: format!("audio/{}", mime_type.as_str().to_lowercase()),
                        preferred_payload_type,
                        clock_rate: clock_rate.get(),
                        channels: channels.get(),
                        parameters: convert_rtp_parameters(parameters),
                        rtcp_feedback: rtcp_feedback.into_iter().map(convert_rtcp_feedback).collect(),
                    }),
                    _ => None, // Skip video codecs
                }
            }).collect(),
            header_extensions: caps.header_extensions.into_iter().map(|ext| {
                RtpHeaderExtensionWrapper {
                    kind: match ext.kind {
                        mediasoup::prelude::MediaKind::Audio => "audio".to_string(),
                        mediasoup::prelude::MediaKind::Video => "video".to_string(),
                    },
                    uri: ext.uri.as_str().to_string(),
                    preferred_id: ext.preferred_id,
                    preferred_encrypt: ext.preferred_encrypt,
                    direction: match ext.direction {
                        RtpHeaderExtensionDirection::SendRecv => "sendrecv".to_string(),
                        RtpHeaderExtensionDirection::SendOnly => "sendonly".to_string(),
                        RtpHeaderExtensionDirection::RecvOnly => "recvonly".to_string(),
                        RtpHeaderExtensionDirection::Inactive => "inactive".to_string(),
                    },
                }
            }).collect(),
        }
    }
}

impl From<mediasoup::prelude::RtpCapabilitiesFinalized> for RtpCapabilitiesWrapper {
    fn from(caps: mediasoup::prelude::RtpCapabilitiesFinalized) -> Self {
        Self {
            codecs: caps.codecs.into_iter().filter_map(|codec| {
                // Convert finalized codecs - they don't have the enum structure so we need different handling
                // For now, use a simplified approach with serialize/deserialize
                if let Ok(codec_value) = serde_json::to_value(&codec) {
                    if let Some(mime_type) = codec_value.get("mimeType").and_then(|v| v.as_str()) {
                        if mime_type.starts_with("audio/") {
                            return Some(RtpCodecCapabilityWrapper {
                                kind: "audio".to_string(),
                                mime_type: mime_type.to_string(),
                                preferred_payload_type: codec_value.get("preferredPayloadType").and_then(|v| v.as_u64()).map(|v| v as u8),
                                clock_rate: codec_value.get("clockRate").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                                channels: codec_value.get("channels").and_then(|v| v.as_u64()).unwrap_or(1) as u8,
                                parameters: codec_value.get("parameters").and_then(|v| v.as_object())
                                    .map(|obj| obj.iter().map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string())).collect())
                                    .unwrap_or_default(),
                                rtcp_feedback: codec_value.get("rtcpFeedback").and_then(|v| v.as_array())
                                    .map(|arr| arr.iter().filter_map(|fb| {
                                        fb.get("type").and_then(|t| t.as_str()).map(|t| RtcpFeedbackWrapper {
                                            r#type: t.to_string(),
                                            parameter: fb.get("parameter").and_then(|p| p.as_str()).map(|s| s.to_string()),
                                        })
                                    }).collect())
                                    .unwrap_or_default(),
                            });
                        }
                    }
                }
                None
            }).collect(),
            header_extensions: caps.header_extensions.into_iter().map(|ext| {
                RtpHeaderExtensionWrapper {
                    kind: match ext.kind {
                        mediasoup::prelude::MediaKind::Audio => "audio".to_string(),
                        mediasoup::prelude::MediaKind::Video => "video".to_string(),
                    },
                    uri: ext.uri.as_str().to_string(),
                    preferred_id: ext.preferred_id,
                    preferred_encrypt: ext.preferred_encrypt,
                    direction: match ext.direction {
                        RtpHeaderExtensionDirection::SendRecv => "sendrecv".to_string(),
                        RtpHeaderExtensionDirection::SendOnly => "sendonly".to_string(),
                        RtpHeaderExtensionDirection::RecvOnly => "recvonly".to_string(),
                        RtpHeaderExtensionDirection::Inactive => "inactive".to_string(),
                    },
                }
            }).collect(),
        }
    }
}

/// Convert from our wrapper back to MediaSoup type (for use with MediaSoup APIs)
/// Note: This is simplified for now since we primarily send capabilities backend → frontend
impl TryFrom<RtpCapabilitiesWrapper> for mediasoup::prelude::RtpCapabilities {
    type Error = anyhow::Error;

    fn try_from(_wrapper: RtpCapabilitiesWrapper) -> Result<Self, Self::Error> {
        // For now, this is a simplified conversion since we mainly send capabilities one way
        // In the future, we could implement full reverse conversion if needed
        Err(anyhow::anyhow!("Conversion from wrapper back to MediaSoup type not yet implemented - capabilities are generated by backend"))
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

    /// WebRTC transport options for listener (to get DTLS parameters)
    pub transport_options: TransportOptions,
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


/// Room status for internal state management
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash, Default)]
pub enum RoomStatus {
    /// Room is being set up (not visible to public)
    #[default]
    Setup,
    /// Room is live with active producer (visible to public)
    Live,
    /// Room is paused but connection maintained
    Paused,
    /// Room is being torn down
    Closing,
    /// Room is completely closed and cleaned up
    Closed,
}

/// Unified Room model (used everywhere - API, internal logic, etc.)
/// Contains both API fields (serialized) and WebRTC infrastructure (skipped)
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Room {
    /// Unique room identifier
    #[serde(with = "super::uuid_string")]
    #[schemars(with = "String")]
    pub id: Uuid,

    /// Human-readable room name
    pub name: String,


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

    // WebRTC Infrastructure (not serialized to API)
    /// MediaSoup router for this room (created in Step 1)
    #[serde(skip)]
    #[schemars(skip)]
    pub router: Option<Arc<Router>>,

    /// DJ state containing transport, producer, and streaming status
    #[serde(skip)]
    #[schemars(skip)]
    pub dj: Option<crate::lib::domain::DJ>,

    /// Listeners connected to this room (listener_id -> ListenerState)
    #[serde(skip)]
    #[schemars(skip)]
    pub listeners: Arc<DashMap<String, crate::lib::domain::Listener>>,

    /// Current room status
    #[serde(skip)]
    #[schemars(skip)]
    pub status: RoomStatus,

    /// Last activity timestamp for cleanup
    #[serde(skip)]
    #[schemars(skip)]
    pub last_activity_atomic: Arc<ArcSwap<chrono::DateTime<chrono::Utc>>>,
    
    // Configuration (not serialized to API)
    /// WebRTC port range configuration
    #[serde(skip)]
    #[serde(default = "default_port_range")]
    #[schemars(skip)]
    pub port_range: std::ops::RangeInclusive<u16>,
    
    /// Announced IP address configuration
    #[serde(skip)]
    #[serde(default = "default_announced_ip")]
    #[schemars(skip)]  
    pub announced_ip: String,
}

/// Default port range for Room configuration
fn default_port_range() -> std::ops::RangeInclusive<u16> {
    10000..=59999
}

/// Default announced IP for Room configuration  
fn default_announced_ip() -> String {
    "localhost".to_string()
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
