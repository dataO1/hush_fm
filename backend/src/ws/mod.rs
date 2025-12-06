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
    state::{AppState, RoomStatus},
    webrtc::{ProducerManager, ConsumerManager},
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
    let rooms = state.get_rooms().await;
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
            // Connect DJ's WebRTC transport
            match handle_connect_transport(room_id, dtls_parameters, state).await {
                Ok(_) => {
                    let response = ServerMessage::TransportConnected;
                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to connect transport for room {}: {}", room_id, e);
                    let response = ServerMessage::Error { 
                        message: format!("Transport connection failed: {}", e) 
                    };
                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
            }
        }
        DJMessage::Produce { rtp_parameters } => {
            // Create audio producer
            match handle_produce(room_id, rtp_parameters, state).await {
                Ok(producer_id) => {
                    // Update room to streaming using enhanced method
                    state.start_stream(room_id, producer_id.clone()).await;

                    let response = ServerMessage::ProducerCreated { producer_id };
                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to create producer for room {}: {}", room_id, e);
                    let response = ServerMessage::Error { 
                        message: format!("Producer creation failed: {}", e) 
                    };
                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
            }
        }
        DJMessage::StopProducing => {
            // Stop producing and pause room
            match handle_stop_producing(room_id, state).await {
                Ok(_) => {
                    state.stop_stream(room_id).await;
                }
                Err(e) => {
                    tracing::error!("Failed to stop producing for room {}: {}", room_id, e);
                }
            }
        }
        DJMessage::DeleteRoom => {
            // Clean up room and all resources
            match handle_delete_room(room_id, state).await {
                Ok(_) => {
                    state.remove_room(room_id);
                    let response = ServerMessage::RoomDeleted;
                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to delete room {}: {}", room_id, e);
                    let response = ServerMessage::Error { 
                        message: format!("Room deletion failed: {}", e) 
                    };
                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
            }
        }
    }
}

/// Handle transport connection with DTLS parameters
async fn handle_connect_transport(
    room_id: Uuid,
    dtls_parameters: serde_json::Value,
    state: &AppState,
) -> anyhow::Result<()> {
    let room_state = state.get_room_state(&room_id)
        .ok_or_else(|| anyhow::anyhow!("Room not found"))?;
    
    let room_state_guard = room_state.read().await;
    if let Some(dj_transport) = &room_state_guard.dj_transport {
        let transport_manager = state.mediasoup.get_transport_manager();
        transport_manager.connect_transport(dj_transport, dtls_parameters).await?;
        tracing::info!("DJ transport connected for room {}", room_id);
    } else {
        return Err(anyhow::anyhow!("No DJ transport found for room"));
    }

    Ok(())
}

/// Handle producer creation
async fn handle_produce(
    room_id: Uuid,
    rtp_parameters: serde_json::Value,
    state: &AppState,
) -> anyhow::Result<String> {
    let room_state = state.get_room_state(&room_id)
        .ok_or_else(|| anyhow::anyhow!("Room not found"))?;
    
    let mut room_state_guard = room_state.write().await;
    
    if let Some(dj_transport) = &room_state_guard.dj_transport {
        // Create audio producer
        let (producer, producer_id) = ProducerManager::create_audio_producer(
            dj_transport,
            room_id,
            rtp_parameters,
        ).await?;
        
        // Store producer in room state (atomic publication)
        room_state_guard.set_audio_producer(producer.clone());
        
        tracing::info!("Audio producer created for room {}: {}", room_id, producer_id);
        Ok(producer_id)
    } else {
        Err(anyhow::anyhow!("No DJ transport found for room"))
    }
}

/// Handle stop producing
async fn handle_stop_producing(
    room_id: Uuid,
    state: &AppState,
) -> anyhow::Result<()> {
    let room_state = state.get_room_state(&room_id)
        .ok_or_else(|| anyhow::anyhow!("Room not found"))?;
    
    let mut room_state_guard = room_state.write().await;
    
    if let Some(producer) = &room_state_guard.audio_producer {
        ProducerManager::pause_producer(producer).await?;
        room_state_guard.pause();
        tracing::info!("Producer paused for room {}", room_id);
    }

    Ok(())
}

/// Handle room deletion and cleanup
async fn handle_delete_room(
    room_id: Uuid,
    state: &AppState,
) -> anyhow::Result<()> {
    let room_state = state.get_room_state(&room_id)
        .ok_or_else(|| anyhow::anyhow!("Room not found"))?;
    
    let mut room_state_guard = room_state.write().await;
    
    // Close producer if exists
    if let Some(producer) = room_state_guard.audio_producer.take() {
        ProducerManager::close_producer(&producer).await?;
    }
    
    // Close transport if exists
    if let Some(_transport) = room_state_guard.dj_transport.take() {
        // Transport will be cleaned up when dropped
    }
    
    room_state_guard.start_closing();
    
    tracing::info!("Room {} marked for deletion", room_id);
    Ok(())
}