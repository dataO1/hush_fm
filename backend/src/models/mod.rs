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
    pub rtp_capabilities: serde_json::Value,
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
pub enum ListenerMessage {
    JoinRoom { room_id: String },
    ConnectTransport { dtls_parameters: serde_json::Value },
    GetConsumer { producer_id: String },
    LeaveRoom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ServerMessage {
    TransportConnected,
    ProducerCreated { producer_id: String },
    ConsumerCreated { 
        consumer_id: String, 
        producer_id: String,
        consumer_parameters: serde_json::Value 
    },
    RoomDeleted,
    ListenerJoined { count: u32 },
    ListenerLeft { count: u32 },
    StreamStarted { producer_id: String },
    StreamStopped,
    Error { message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum BroadcastMessage {
    RoomAdded { room: Room },
    RoomUpdated { room: Room },
    RoomRemoved { room_id: Uuid },
}