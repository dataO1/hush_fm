pub mod commands;
pub mod events;
pub mod schemas;
pub mod mediasoup_schemas;

// Re-export main types
pub use commands::ClientCommand;
pub use events::{ServerEvent, LobbyEvent};
pub use schemas::{
    Room, TraceContext,
    CreateRoomRequest, CreateRoomResponse,
    TransportOptions, RtpCapabilitiesWrapper, ConsumerParameters,
    ConnectionState, ErrorResponse
};

// Utility for stable UUID serialization
pub mod uuid_string {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};
    use uuid::Uuid;

    pub fn serialize<S>(uuid: &Uuid, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        uuid.to_string().serialize(serializer)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Uuid, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        s.parse().map_err(serde::de::Error::custom)
    }
}

// Room utility methods
impl Room {
    /// Create a new Room with default values
    pub fn new(id: uuid::Uuid, name: String, dj_id: String) -> Self {
        let now = chrono::Utc::now();
        Self {
            id,
            name,
            dj_id,
            listener_count: 0,
            dj_streaming: false,
            created_at: now,
            description: None,
            tags: vec![],
            last_activity: now,
        }
    }
    
    /// Create an example room for testing purposes
    pub fn example() -> Self {
        Self::new(
            uuid::Uuid::new_v4(),
            "Example Room".to_string(),
            "DJ Example".to_string(),
        )
    }
}