use mediasoup::{prelude::DtlsParameters, types::data_structures::{DtlsFingerprint, DtlsRole}};
use serde::Deserialize;
use schemars::JsonSchema;
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
        // NOTE: Frontend should use "client", backend should use "server"
        // "auto" is discouraged as it can cause connection issues
        let role = match json.role.as_str() {
            "client" => DtlsRole::Client,
            "server" => DtlsRole::Server,
            "auto" => {
                tracing::warn!("DTLS role 'auto' is discouraged - use explicit 'client' or 'server'");
                DtlsRole::Auto
            },
            _ => bail!("Invalid DTLS role: {}. Use 'client' or 'server'", json.role),
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

/// Commands sent from lobby clients to server
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum LobbyCommand {
    /// Announce room creation in lobby (Step 1 of DJ flow)
    /// Creates room in unfinished state with worker and router, returns DJ WebSocket URL
    #[serde(rename_all = "camelCase")]
    AnnounceRoom {
        /// Name of the room to create
        name: String,
        /// DJ name for the room
        #[serde(rename = "djName")]
        dj_name: String,
        /// DJ session ID for identification and reconnection
        #[serde(rename = "sessionId")]
        session_id: String,
        /// Optional room description
        description: Option<String>,
        /// Optional room tags
        tags: Option<Vec<String>>,
    },

    /// Request to join a room for listening (Step 1 of listener flow)
    /// Creates unique listener WebSocket URL and returns it via lobby response
    #[serde(rename_all = "camelCase")]
    RequestJoin {
        /// Stable session ID from browser fingerprint (used for both DJ and listener)
        #[serde(rename = "sessionId")]
        session_id: String,
        /// ID of the room to join
        #[serde(rename = "roomId")]
        room_id: String,
    },
}

/// Commands sent from DJ clients to server
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DjCommand {
    /// Initialize room on DJ WebSocket connection (Step 2 of DJ flow)
    #[serde(rename_all = "camelCase")]
    InitRoom {
        /// ID of the room to initialize
        room_id: String,
    },

    /// Request WebRTC transport creation for DJ (Step 5 of DJ flow)
    #[serde(rename_all = "camelCase")]
    RequestDjTransport,

    /// Connect DJ transport with DTLS parameters
    #[serde(rename_all = "camelCase")]
    ConnectDjTransport {
        /// Transport ID for connection validation (follows MediaSoup standard pattern)
        #[serde(rename = "transportId")]
        transport_id: Option<String>,
        /// DTLS parameters for WebRTC transport connection
        #[serde(rename = "dtlsParameters")]
        dtls_parameters: DtlsParametersJson,
    },

    /// Create audio producer for streaming
    #[serde(rename_all = "camelCase")]
    Produce {
        /// RTP parameters for media production
        rtp_parameters: serde_json::Value,
    },

    /// Pause the audio stream (mute microphone)
    #[serde(rename_all = "camelCase")]
    PauseStream,

    /// Resume the audio stream (unmute microphone)
    #[serde(rename_all = "camelCase")]
    ResumeStream,

    /// Close the room and stop broadcasting
    #[serde(rename_all = "camelCase")]
    CloseRoom,
}

/// Commands sent from listener clients to server
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ListenerCommand {
    /// Initialize listener transport receiver (Step 2 of listener flow)
    /// Sent after connecting to unique listener WebSocket URL
    #[serde(rename_all = "camelCase")]
    InitListener,

    /// Connect listener transport with DTLS parameters
    #[serde(rename_all = "camelCase")]
    ConnectListenerTransport {
        /// Transport ID for connection validation (follows MediaSoup standard pattern)
        #[serde(rename = "transportId")]
        transport_id: Option<String>,
        /// DTLS parameters for WebRTC transport connection
        #[serde(rename = "dtlsParameters")]
        dtls_parameters: DtlsParametersJson,
    },

    /// Get router RTP capabilities for device initialization
    #[serde(rename_all = "camelCase")]
    GetRouterCapabilities {
        /// ID of the room to get capabilities for
        room_id: String,
    },

    /// Leave the current room
    #[serde(rename_all = "camelCase")]
    LeaveRoom,

    /// Request consumer creation for the room's current producer
    #[serde(rename_all = "camelCase")]
    RequestConsumer {
        /// Device RTP capabilities for consumer creation (Step 4 of listener flow)
        rtp_capabilities: serde_json::Value,
    },

    /// Resume consumer for audio playback
    #[serde(rename_all = "camelCase")]
    ResumeConsumer {
        /// ID of the consumer to resume
        consumer_id: String,
    },

    /// Application-level heartbeat ping (no payload)
    /// The server replies immediately with ListenerEvent::Pong.
    #[serde(rename_all = "camelCase")]
    Ping,
}

impl LobbyCommand {
    /// Get the command type as a string for logging
    pub fn command_type(&self) -> &'static str {
        match self {
            Self::AnnounceRoom { .. } => "announceRoom",
            Self::RequestJoin { .. } => "requestJoin",
        }
    }
}

impl DjCommand {
    /// Get the command type as a string for logging
    pub fn command_type(&self) -> &'static str {
        match self {
            Self::InitRoom { .. } => "initRoom",
            Self::RequestDjTransport => "requestDjTransport",
            Self::ConnectDjTransport { .. } => "connectDjTransport",
            Self::Produce { .. } => "produce",
            Self::PauseStream => "pauseStream",
            Self::ResumeStream => "resumeStream",
            Self::CloseRoom => "closeRoom",
        }
    }
}

impl ListenerCommand {
    /// Get the command type as a string for logging
    pub fn command_type(&self) -> &'static str {
        match self {
            Self::InitListener => "initListener",
            Self::ConnectListenerTransport { .. } => "connectListenerTransport",
            Self::GetRouterCapabilities { .. } => "getRouterCapabilities",
            Self::LeaveRoom => "leaveRoom",
            Self::RequestConsumer { .. } => "requestConsumer",
            Self::ResumeConsumer { .. } => "resumeConsumer",
            Self::Ping => "ping",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_listener_ping_deserializes() {
        let json = r#"{"type":"ping"}"#;
        let cmd: ListenerCommand = serde_json::from_str(json)
            .expect("Should deserialize Ping from {\"type\":\"ping\"}");
        assert_eq!(cmd.command_type(), "ping");
        assert!(matches!(cmd, ListenerCommand::Ping));
    }

    #[test]
    fn test_listener_init_listener_deserializes() {
        let json = r#"{"type":"initListener"}"#;
        let cmd: ListenerCommand = serde_json::from_str(json)
            .expect("Should deserialize InitListener");
        assert!(matches!(cmd, ListenerCommand::InitListener));
    }
}
