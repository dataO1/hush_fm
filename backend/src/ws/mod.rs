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
use mediasoup::prelude::Transport;

use crate::{
    models::{ClientCommand, ServerEvent, LobbyEvent},
    state::AppState,
    telemetry::{extract_trace_context_from_command, inject_trace_context_into_event},
    webrtc::ProducerManager,
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
                    let message_span = tracing::debug_span!(
                        "websocket_message_received",
                        room_id = %room_id,
                        message_length = text.len(),
                        command_type = tracing::field::Empty
                    );
                    let _enter = message_span.enter();
                    
                    tracing::debug!("Raw WebSocket message received");
                    match serde_json::from_str::<ClientCommand>(&text) {
                        Ok(client_cmd) => {
                            message_span.record("command_type", client_cmd.command_type());
                            tracing::info!("Successfully parsed WebSocket command: {}", client_cmd.command_type());
                            handle_client_command(client_cmd, room_id, &state_clone, &mut sender).await;
                        }
                        Err(e) => {
                            tracing::error!(
                                raw_message = %text,
                                parse_error = %e,
                                "Failed to parse ClientCommand from WebSocket message"
                            );
                        }
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
    if let Ok(msg) = serde_json::to_string(&LobbyEvent::RoomAdded { 
        room: rooms.first().cloned().unwrap_or_else(|| crate::models::Room::example()).into(),
        trace_context: None,
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

#[tracing::instrument(skip(cmd, state, sender), fields(room_id = %room_id, command_type = cmd.command_type()))]
async fn handle_client_command(
    cmd: ClientCommand,
    room_id: Uuid,
    state: &AppState,
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
) {
    // Extract trace context from the message and set up parent span
    let _parent_context = extract_trace_context_from_command(&cmd);
    
    match cmd {
        ClientCommand::ConnectTransport { dtls_parameters, .. } => {
            // Connect DJ's WebRTC transport
            match handle_connect_transport(room_id, dtls_parameters, state).await {
                Ok(transport_id) => {
                    let mut response = ServerEvent::TransportConnected {
                        transport_id, // Use actual transport ID from mediasoup
                        trace_context: None,
                    };
                    inject_trace_context_into_event(&mut response, &tracing::Span::current());
                    
                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to connect transport for room {}: {}", room_id, e);
                    let mut response = ServerEvent::CommandFailed {
                        command: "connectTransport".to_string(),
                        error: format!("Transport connection failed: {}", e),
                        trace_context: None,
                    };
                    inject_trace_context_into_event(&mut response, &tracing::Span::current());
                    
                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
            }
        }
        ClientCommand::Produce { rtp_parameters, .. } => {
            // Create audio producer
            match handle_produce(room_id, rtp_parameters, state).await {
                Ok(producer_id) => {
                    // Update room to streaming using enhanced method
                    state.start_stream(room_id, producer_id.clone()).await;

                    let response = ServerEvent::ProducerCreated { 
                        producer_id,
                        room_id: room_id.to_string(),
                        trace_context: None,
                    };
                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to create producer for room {}: {}", room_id, e);
                    let response = ServerEvent::CommandFailed {
                        command: "produce".to_string(),
                        error: format!("Producer creation failed: {}", e),
                        trace_context: None,
                    };
                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
            }
        }
        ClientCommand::PauseStream { .. } => {
            // Stop producing and pause room
            match handle_stop_producing(room_id, state).await {
                Ok(_) => {
                    state.stop_stream(room_id).await;
                    let response = ServerEvent::StreamPaused {
                        room_id: room_id.to_string(),
                        trace_context: None,
                    };
                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to pause stream for room {}: {}", room_id, e);
                    let response = ServerEvent::CommandFailed {
                        command: "pauseStream".to_string(),
                        error: format!("Stream pause failed: {}", e),
                        trace_context: None,
                    };
                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
            }
        }
        ClientCommand::ResumeStream { .. } => {
            // Resume producing
            match handle_resume_producing(room_id, state).await {
                Ok(_) => {
                    let response = ServerEvent::StreamResumed {
                        room_id: room_id.to_string(),
                        trace_context: None,
                    };
                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to resume stream for room {}: {}", room_id, e);
                    let response = ServerEvent::CommandFailed {
                        command: "resumeStream".to_string(),
                        error: format!("Stream resume failed: {}", e),
                        trace_context: None,
                    };
                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
            }
        }
        ClientCommand::CloseRoom { .. } => {
            // Clean up room and all resources
            match handle_delete_room(room_id, state).await {
                Ok(_) => {
                    state.remove_room(room_id);
                    let response = ServerEvent::RoomClosed {
                        room_id: room_id.to_string(),
                        reason: "Closed by DJ".to_string(),
                        trace_context: None,
                    };
                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to delete room {}: {}", room_id, e);
                    let response = ServerEvent::CommandFailed {
                        command: "closeRoom".to_string(),
                        error: format!("Room deletion failed: {}", e),
                        trace_context: None,
                    };
                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
            }
        }
        // Handle listener commands (these should probably be on a different handler)
        ClientCommand::JoinRoom { .. } |
        ClientCommand::ConnectListenerTransport { .. } |
        ClientCommand::ConsumeAudio { .. } |
        ClientCommand::LeaveRoom { .. } => {
            tracing::warn!("Received listener command on DJ handler: {:?}", cmd.command_type());
            let response = ServerEvent::CommandFailed {
                command: cmd.command_type().to_string(),
                error: "Listener commands not supported on DJ endpoint".to_string(),
                trace_context: None,
            };
            if let Ok(msg) = serde_json::to_string(&response) {
                sender.send(Message::Text(msg)).await.ok();
            }
        }
    }
}

/// Handle transport connection with DTLS parameters
#[tracing::instrument(skip(state, dtls_parameters), fields(room_id = %room_id, transport_id))]
async fn handle_connect_transport(
    room_id: Uuid,
    dtls_parameters: serde_json::Value,
    state: &AppState,
) -> anyhow::Result<String> {
    let room_state = state.get_room_state(&room_id)
        .ok_or_else(|| anyhow::anyhow!("Room not found"))?;
    
    let room_state_guard = room_state.read().await;
    if let Some(dj_transport) = &room_state_guard.dj_transport {
        let transport_id = dj_transport.id().to_string();
        
        // Record transport ID in span
        tracing::Span::current().record("transport_id", &transport_id);
        
        let transport_manager = state.mediasoup.get_transport_manager();
        transport_manager.connect_transport(dj_transport, dtls_parameters).await?;
        tracing::info!("DJ transport connected for room {}, transport_id: {}", room_id, transport_id);
        
        Ok(transport_id)
    } else {
        return Err(anyhow::anyhow!("No DJ transport found for room"));
    }
}

/// Handle producer creation
#[tracing::instrument(skip(state, rtp_parameters), fields(
    room_id = %room_id,
    rtp_parameters_size = rtp_parameters.to_string().len()
))]
async fn handle_produce(
    room_id: Uuid,
    rtp_parameters: serde_json::Value,
    state: &AppState,
) -> anyhow::Result<String> {
    let span = tracing::Span::current();
    span.record("has_rtp_codecs", rtp_parameters.get("codecs").is_some());
    span.record("has_rtp_encodings", rtp_parameters.get("encodings").is_some());
    span.record("has_rtp_header_extensions", rtp_parameters.get("headerExtensions").is_some());
    
    let room_state = state.get_room_state(&room_id)
        .ok_or_else(|| {
            span.record("error", "room_not_found");
            anyhow::anyhow!("Room not found")
        })?;
    
    let mut room_state_guard = room_state.write().await;
    
    span.record("has_dj_transport", room_state_guard.dj_transport.is_some());
    span.record("room_status_before", format!("{:?}", room_state_guard.status));
    span.record("room_was_public", room_state_guard.is_public());
    
    if let Some(dj_transport) = &room_state_guard.dj_transport {
        // Create audio producer with span
        let producer_span = tracing::info_span!(
            "create_audio_producer",
            transport_id = %dj_transport.id(),
            room_id = %room_id
        );
        
        let (producer, producer_id) = producer_span.in_scope(|| async {
            ProducerManager::create_audio_producer(
                dj_transport,
                room_id,
                rtp_parameters,
            ).await
        }).await?;
        
        // Store producer in room state (atomic publication)
        room_state_guard.set_audio_producer(producer.clone());
        
        span.record("producer_id", &producer_id);
        span.record("room_is_public_now", room_state_guard.is_public());
        span.record("room_status_after", format!("{:?}", room_state_guard.status));
        span.record("room_dj_streaming", room_state_guard.room.dj_streaming);
        
        tracing::info!(
            producer_id = %producer_id,
            is_public = room_state_guard.is_public(),
            status = ?room_state_guard.status,
            "Audio producer created and room updated"
        );
        
        Ok(producer_id)
    } else {
        span.record("error", "no_dj_transport");
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

/// Handle resume producing
async fn handle_resume_producing(
    room_id: Uuid,
    state: &AppState,
) -> anyhow::Result<()> {
    let room_state = state.get_room_state(&room_id)
        .ok_or_else(|| anyhow::anyhow!("Room not found"))?;
    
    let mut room_state_guard = room_state.write().await;
    
    if let Some(producer) = &room_state_guard.audio_producer {
        ProducerManager::resume_producer(producer).await?;
        room_state_guard.resume();
        tracing::info!("Producer resumed for room {}", room_id);
    }

    Ok(())
}