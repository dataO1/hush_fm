use mediasoup::{prelude::DtlsParameters, types::data_structures::{DtlsFingerprint, DtlsRole}};
use serde::Deserialize;
use schemars::JsonSchema;
use super::TraceContext;
use anyhow::{bail, Result};

/// DTLS parameters in JSON format (matches MediaSoup client output)
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DtlsParametersJson {
    /// DTLS role as string: "auto", "client", or "server"
    pub role: String,
    /// DTLS fingerprints array
    pub fingerprints: Vec<DtlsFingerprintJson>,
}

/// DTLS fingerprint in JSON format (matches MediaSoup client output)
#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub struct DtlsFingerprintJson {
    /// Hash algorithm name (e.g., "sha-256")
    pub algorithm: String,
    /// Fingerprint value as colon-separated hex string
    pub value: String,
}

/// Convert JSON DTLS parameters to native MediaSoup types
impl TryFrom<DtlsParametersJson> for DtlsParameters {
    type Error = anyhow::Error;

    fn try_from(json: DtlsParametersJson) -> Result<Self> {
        // Parse role string to DtlsRole enum
        let role = match json.role.as_str() {
            "auto" => DtlsRole::Auto,
            "client" => DtlsRole::Client,
            "server" => DtlsRole::Server,
            _ => bail!("Invalid DTLS role: {}", json.role),
        };

        // Convert fingerprints
        let fingerprints = json.fingerprints.into_iter()
            .map(DtlsFingerprint::try_from)
            .collect::<Result<Vec<_>>>()?;

        Ok(DtlsParameters { role, fingerprints })
    }
}

/// Convert JSON DTLS fingerprint to native MediaSoup type
impl TryFrom<DtlsFingerprintJson> for DtlsFingerprint {
    type Error = anyhow::Error;

    fn try_from(json: DtlsFingerprintJson) -> Result<Self> {
        // Parse hex string to bytes
        let value_bytes: Result<Vec<u8>, _> = json.value
            .split(':')
            .map(|hex| u8::from_str_radix(hex, 16))
            .collect();

        let value_bytes = value_bytes
            .map_err(|e| anyhow::anyhow!("Invalid hex string in fingerprint: {}", e))?;

        // Match algorithm and create appropriate variant
        match json.algorithm.as_str() {
            "sha-1" => {
                if value_bytes.len() != 20 {
                    bail!("SHA-1 fingerprint must be 20 bytes, got {}", value_bytes.len());
                }
                let mut array = [0u8; 20];
                array.copy_from_slice(&value_bytes);
                Ok(DtlsFingerprint::Sha1 { value: array })
            },
            "sha-224" => {
                if value_bytes.len() != 28 {
                    bail!("SHA-224 fingerprint must be 28 bytes, got {}", value_bytes.len());
                }
                let mut array = [0u8; 28];
                array.copy_from_slice(&value_bytes);
                Ok(DtlsFingerprint::Sha224 { value: array })
            },
            "sha-256" => {
                if value_bytes.len() != 32 {
                    bail!("SHA-256 fingerprint must be 32 bytes, got {}", value_bytes.len());
                }
                let mut array = [0u8; 32];
                array.copy_from_slice(&value_bytes);
                Ok(DtlsFingerprint::Sha256 { value: array })
            },
            "sha-384" => {
                if value_bytes.len() != 48 {
                    bail!("SHA-384 fingerprint must be 48 bytes, got {}", value_bytes.len());
                }
                let mut array = [0u8; 48];
                array.copy_from_slice(&value_bytes);
                Ok(DtlsFingerprint::Sha384 { value: array })
            },
            "sha-512" => {
                if value_bytes.len() != 64 {
                    bail!("SHA-512 fingerprint must be 64 bytes, got {}", value_bytes.len());
                }
                let mut array = [0u8; 64];
                array.copy_from_slice(&value_bytes);
                Ok(DtlsFingerprint::Sha512 { value: array })
            },
            _ => bail!("Unsupported fingerprint algorithm: {}", json.algorithm),
        }
    }
}

/// Commands sent from client to server
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ClientCommand {
    // DJ Commands - Room Management
    #[serde(rename_all = "camelCase")]
    ConnectDjTransport {
        /// DTLS parameters for WebRTC transport connection
        #[serde(rename = "dtlsParameters")]
        dtls_parameters: DtlsParametersJson,
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
    RequestJoin {
        /// ID of the room to join
        room_id: String,
        /// RTP capabilities for media consumption
        rtp_capabilities: serde_json::Value,
        /// Optional trace context for request tracing
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },

    #[serde(rename_all = "camelCase")]
    ConnectListenerTransport {
        /// DTLS parameters for WebRTC transport connection
        #[serde(rename = "dtlsParameters")]
        dtls_parameters: DtlsParametersJson,
        /// Optional trace context for request tracing
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },

    /// Get router RTP capabilities for device initialization
    #[serde(rename_all = "camelCase")]
    GetRouterCapabilities {
        /// ID of the room to get capabilities for
        room_id: String,
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

    /// Request consumer creation for a specific producer
    #[serde(rename_all = "camelCase")]
    RequestConsumer {
        /// ID of the producer to consume from
        producer_id: String,
        /// Optional trace context for request tracing
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },

    #[serde(rename_all = "camelCase")]
    ResumeConsumer {
        consumer_id: String,
        /// Optional trace context for request tracing
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },
}

impl ClientCommand {
    /// Extract trace context from any command
    pub fn trace_context(&self) -> Option<&TraceContext> {
        match self {
            Self::ConnectDjTransport { trace_context, .. } => trace_context.as_ref(),
            Self::Produce { trace_context, .. } => trace_context.as_ref(),
            Self::PauseStream { trace_context } => trace_context.as_ref(),
            Self::ResumeStream { trace_context } => trace_context.as_ref(),
            Self::CloseRoom { trace_context } => trace_context.as_ref(),
            Self::RequestJoin { trace_context, .. } => trace_context.as_ref(),
            Self::ConnectListenerTransport { trace_context, .. } => trace_context.as_ref(),
            Self::GetRouterCapabilities { trace_context, .. } => trace_context.as_ref(),
            Self::LeaveRoom { trace_context } => trace_context.as_ref(),
            Self::RequestConsumer { trace_context, .. } => trace_context.as_ref(),
            Self::ResumeConsumer { trace_context, .. } => trace_context.as_ref(),
        }
    }

    /// Get the command type as a string for logging
    pub fn command_type(&self) -> &'static str {
        match self {
            Self::ConnectDjTransport { .. } => "connectDjTransport",
            Self::Produce { .. } => "produce",
            Self::PauseStream { .. } => "pauseStream",
            Self::ResumeStream { .. } => "resumeStream",
            Self::CloseRoom { .. } => "closeRoom",
            Self::RequestJoin { .. } => "requestJoin",
            Self::ConnectListenerTransport { .. } => "connectListenerTransport",
            Self::GetRouterCapabilities { .. } => "getRouterCapabilities",
            Self::LeaveRoom { .. } => "leaveRoom",
            Self::RequestConsumer { .. } => "requestConsumer",
            Self::ResumeConsumer {  .. } => "resumeConsumer",
        }
    }
}
