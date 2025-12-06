use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct Room {
    pub id: Uuid,
    pub name: String,
    pub dj_id: String,
    pub dj_streaming: bool,
    pub listener_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct CreateRoomRequest {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct CreateRoomResponse {
    pub room_id: Uuid,
    pub dj_token: String,
    pub transport_options: serde_json::Value,
    pub ws_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct JoinRoomResponse {
    pub transport_options: serde_json::Value,
    pub producer_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum DJMessage {
    ConnectTransport { dtls_parameters: serde_json::Value },
    Produce { rtp_parameters: serde_json::Value },
    StopProducing,
    DeleteRoom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ServerMessage {
    ProducerCreated { producer_id: String },
    RoomDeleted,
    ListenerJoined { count: u32 },
    ListenerLeft { count: u32 },
    Error { message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum BroadcastMessage {
    RoomAdded { room: Room },
    RoomUpdated { room: Room },
    RoomRemoved { room_id: Uuid },
}