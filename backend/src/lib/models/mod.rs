pub mod commands;
pub mod events;
pub mod schemas;

// Re-export main types
pub use commands::{LobbyCommand, DjCommand, ListenerCommand};
pub use events::{DjEvent, ListenerEvent, LobbyEvent};
pub use schemas::Room;

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

