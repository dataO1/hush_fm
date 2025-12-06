use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use serde_json;
use uuid::Uuid;

use crate::{
    models::{BroadcastMessage, DJMessage, ServerMessage},
    state::AppState,
};

/// WebSocket handler for room-specific connections (DJ control)
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Path(room_id): Path<Uuid>,
    State(state): State<AppState>,
) -> Response {
    ws.on_upgrade(move |socket| handle_room_socket(socket, room_id, state))
}

/// WebSocket handler for lobby (room list updates)
pub async fn lobby_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> Response {
    ws.on_upgrade(move |socket| handle_lobby_socket(socket, state))
}

async fn handle_room_socket(socket: WebSocket, room_id: Uuid, state: AppState) {
    let (mut sender, mut receiver) = socket.split();

    // Spawn task to handle incoming messages
    let state_clone = state.clone();
    let send_task = tokio::spawn(async move {
        while let Some(msg) = receiver.next().await {
            if let Ok(msg) = msg {
                if let Message::Text(text) = msg {
                    if let Ok(dj_msg) = serde_json::from_str::<DJMessage>(&text) {
                        handle_dj_message(dj_msg, room_id, &state_clone, &mut sender).await;
                    }
                }
            } else {
                break;
            }
        }
    });

    // Wait for the sending task to finish
    send_task.await.ok();
}

async fn handle_lobby_socket(socket: WebSocket, state: AppState) {
    let (mut sender, _receiver) = socket.split();
    let mut rx = state.broadcast_tx.subscribe();

    // Send initial room list
    let rooms = state.get_rooms();
    if let Ok(msg) = serde_json::to_string(&BroadcastMessage::RoomAdded { 
        room: rooms.first().cloned().unwrap_or(crate::models::Room {
            id: Uuid::new_v4(),
            name: "Example".to_string(),
            dj_id: "example".to_string(),
            dj_streaming: false,
            listener_count: 0,
        })
    }) {
        sender.send(Message::Text(msg)).await.ok();
    }

    // Handle broadcast messages
    while let Ok(broadcast_msg) = rx.recv().await {
        if let Ok(msg) = serde_json::to_string(&broadcast_msg) {
            if sender.send(Message::Text(msg)).await.is_err() {
                break;
            }
        }
    }
}

async fn handle_dj_message(
    msg: DJMessage,
    room_id: Uuid,
    state: &AppState,
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
) {
    match msg {
        DJMessage::ConnectTransport { dtls_parameters } => {
            // TODO: Connect WebRTC transport
            tracing::info!("DJ connecting transport for room {}", room_id);
        }
        DJMessage::Produce { rtp_parameters } => {
            // TODO: Create producer
            let producer_id = format!("producer_{}", room_id);
            
            // Update room to streaming
            if let Some(mut room) = state.rooms.get_mut(&room_id) {
                room.dj_streaming = true;
                state.update_room(room.clone());
            }

            let response = ServerMessage::ProducerCreated { producer_id };
            if let Ok(msg) = serde_json::to_string(&response) {
                sender.send(Message::Text(msg)).await.ok();
            }
        }
        DJMessage::StopProducing => {
            // Update room to not streaming
            if let Some(mut room) = state.rooms.get_mut(&room_id) {
                room.dj_streaming = false;
                state.update_room(room.clone());
            }
        }
        DJMessage::DeleteRoom => {
            state.remove_room(room_id);
            let response = ServerMessage::RoomDeleted;
            if let Ok(msg) = serde_json::to_string(&response) {
                sender.send(Message::Text(msg)).await.ok();
            }
        }
    }
}