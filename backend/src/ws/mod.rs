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
use mediasoup::prelude::{DtlsParameters, Transport};

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

/// WebSocket handler for listener connections
pub async fn listener_handler(
    ws: WebSocketUpgrade,
    Path(room_id): Path<Uuid>,
    State(state): State<AppState>,
) -> Response {
    ws.on_upgrade(move |socket| handle_listener_socket(socket, room_id, state))
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
                    tracing::debug!("Raw message content: {}", &text);
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

async fn handle_listener_socket(socket: WebSocket, room_id: Uuid, state: AppState) {
    let (mut sender, mut receiver) = socket.split();
    let connection_id = Uuid::new_v4();
    
    tracing::info!(
        room_id = %room_id,
        connection_id = %connection_id,
        "New listener WebSocket connection established"
    );

    // Increment listener count when connection is established
    if let Some(room_state) = state.get_room_state(&room_id) {
        let mut room_state_guard = room_state.write().await;
        room_state_guard.room.listener_count += 1;
        
        tracing::info!(
            room_id = %room_id,
            connection_id = %connection_id,
            new_listener_count = room_state_guard.room.listener_count,
            "Listener count incremented"
        );
        
        // Broadcast listener count update
        let lobby_event = crate::models::events::LobbyEvent::RoomUpdated {
            room: room_state_guard.room.clone().into(),
            trace_context: None,
        };
        state.broadcast_tx.send(lobby_event).ok();
    }

    // Spawn task to handle incoming messages
    let state_clone = state.clone();
    let send_task = tokio::spawn(async move {
        while let Some(msg) = receiver.next().await {
            if let Ok(msg) = msg {
                if let Message::Text(text) = msg {
                    let message_span = tracing::debug_span!(
                        "listener_websocket_message_received",
                        room_id = %room_id,
                        connection_id = %connection_id,
                        message_length = text.len(),
                        command_type = tracing::field::Empty
                    );
                    let _enter = message_span.enter();

                    tracing::debug!("Raw listener WebSocket message received");
                    tracing::debug!("Raw message content: {}", &text);
                    match serde_json::from_str::<ClientCommand>(&text) {
                        Ok(client_cmd) => {
                            message_span.record("command_type", client_cmd.command_type());
                            tracing::info!("Successfully parsed listener WebSocket command: {}", client_cmd.command_type());
                            handle_listener_command(client_cmd, room_id, connection_id, &state_clone, &mut sender).await;
                        }
                        Err(e) => {
                            tracing::error!(
                                raw_message = %text,
                                parse_error = %e,
                                "Failed to parse ClientCommand from listener WebSocket message"
                            );
                        }
                    }
                }
            } else {
                tracing::debug!(
                    room_id = %room_id,
                    connection_id = %connection_id,
                    "Listener WebSocket connection closed by client"
                );
                break;
            }
        }
    });

    // Wait for the sending task to finish
    send_task.await.ok();
    
    // Connection closed - perform cleanup
    tracing::info!(
        room_id = %room_id,
        connection_id = %connection_id,
        "Listener WebSocket connection closed, performing cleanup"
    );
    
    // Automatic cleanup on disconnect
    if let Err(e) = handle_listener_leave(room_id, &state).await {
        tracing::error!(
            room_id = %room_id,
            connection_id = %connection_id,
            error = %e,
            "Failed to clean up listener resources on disconnect"
        );
    }
    
    tracing::info!(
        room_id = %room_id,
        connection_id = %connection_id,
        "Listener cleanup completed"
    );
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
        ClientCommand::ConnectDjTransport { dtls_parameters, .. } => {
            // Convert JSON DTLS parameters to native MediaSoup types
            let native_dtls_parameters = match DtlsParameters::try_from(dtls_parameters) {
                Ok(params) => params,
                Err(e) => {
                    tracing::error!("Failed to convert DTLS parameters: {}", e);
                    return;
                }
            };
            
            // Connect DJ's WebRTC transport
            match handle_connect_transport(room_id, native_dtls_parameters, state).await {
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
        // Handle listener commands (these should be on a different handler)
        ClientCommand::RequestJoin { .. } |
        ClientCommand::ConnectListenerTransport { .. } |
        ClientCommand::GetRouterCapabilities { .. } |
        ClientCommand::LeaveRoom { .. } |
        ClientCommand::RequestConsumer { .. } => {
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

#[tracing::instrument(skip(cmd, state, sender), fields(room_id = %room_id, connection_id = %connection_id, command_type = cmd.command_type()))]
async fn handle_listener_command(
    cmd: ClientCommand,
    room_id: Uuid,
    connection_id: Uuid,
    state: &AppState,
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
) {
    // Extract trace context from the message and set up parent span
    let _parent_context = extract_trace_context_from_command(&cmd);

    match cmd {
        ClientCommand::GetRouterCapabilities { room_id: requested_room_id, .. } => {
            // Validate that the requested room ID matches the WebSocket path
            if requested_room_id != room_id.to_string() {
                tracing::warn!("Room ID mismatch: requested {} but connected to {}", requested_room_id, room_id);
                let mut response = ServerEvent::CommandFailed {
                    command: "getRouterCapabilities".to_string(),
                    error: "Room ID mismatch".to_string(),
                    trace_context: None,
                };
                inject_trace_context_into_event(&mut response, &tracing::Span::current());

                if let Ok(msg) = serde_json::to_string(&response) {
                    sender.send(Message::Text(msg)).await.ok();
                }
                return;
            }

            // Handle router capabilities request
            match handle_get_router_capabilities(room_id, state).await {
                Ok(rtp_capabilities) => {
                    let mut response = ServerEvent::RouterCapabilities {
                        room_id: room_id.to_string(),
                        rtp_capabilities,
                        trace_context: None,
                    };
                    inject_trace_context_into_event(&mut response, &tracing::Span::current());

                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to get router capabilities for room {}: {}", room_id, e);
                    let mut response = ServerEvent::CommandFailed {
                        command: "getRouterCapabilities".to_string(),
                        error: format!("Failed to get router capabilities: {}", e),
                        trace_context: None,
                    };
                    inject_trace_context_into_event(&mut response, &tracing::Span::current());

                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
            }
        }
        ClientCommand::RequestJoin { room_id: requested_room_id, rtp_capabilities, .. } => {
            // Validate that the requested room ID matches the WebSocket path
            if requested_room_id != room_id.to_string() {
                tracing::warn!("Room ID mismatch: requested {} but connected to {}", requested_room_id, room_id);
                let mut response = ServerEvent::CommandFailed {
                    command: "requestJoin".to_string(),
                    error: "Room ID mismatch".to_string(),
                    trace_context: None,
                };
                inject_trace_context_into_event(&mut response, &tracing::Span::current());
                
                if let Ok(msg) = serde_json::to_string(&response) {
                    sender.send(Message::Text(msg)).await.ok();
                }
                return;
            }

            // Handle join request with producer validation and Jaeger spans
            let listener_id = connection_id.to_string(); // Use consistent connection_id as listener_id
            match handle_request_join(room_id, rtp_capabilities, listener_id, state).await {
                Ok((room_info, transport_options, producer_id, rtp_capabilities)) => {
                    let mut response = ServerEvent::JoinReady {
                        room: room_info,
                        transport_options,
                        producer_id,
                        rtp_capabilities,
                        trace_context: None,
                    };
                    inject_trace_context_into_event(&mut response, &tracing::Span::current());

                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to process join request for room {}: {}", room_id, e);
                    let mut response = ServerEvent::CommandFailed {
                        command: "requestJoin".to_string(),
                        error: format!("Join request failed: {}", e),
                        trace_context: None,
                    };
                    inject_trace_context_into_event(&mut response, &tracing::Span::current());

                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
            }
        }
        ClientCommand::ConnectListenerTransport { dtls_parameters, .. } => {
            // Convert JSON DTLS parameters to native MediaSoup types
            let native_dtls_parameters = match DtlsParameters::try_from(dtls_parameters) {
                Ok(params) => params,
                Err(e) => {
                    tracing::error!("Failed to convert DTLS parameters: {}", e);
                    return;
                }
            };
            
            // Connect listener's WebRTC transport
            let listener_id = connection_id.to_string(); // Use consistent connection_id as listener_id
            match handle_connect_listener_transport(room_id, listener_id, native_dtls_parameters, state).await {
                Ok(transport_id) => {
                    // Send TransportConnected event
                    let mut response = ServerEvent::TransportConnected {
                        transport_id,
                        trace_context: None,
                    };
                    inject_trace_context_into_event(&mut response, &tracing::Span::current());

                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                    
                    // Consumer creation is handled separately via requestConsumer command
                }
                Err(e) => {
                    tracing::error!("Failed to connect listener transport for room {}: {}", room_id, e);
                    let mut response = ServerEvent::CommandFailed {
                        command: "connectListenerTransport".to_string(),
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
        ClientCommand::LeaveRoom { .. } => {
            // Handle listener leaving the room
            match handle_listener_leave(room_id, state).await {
                Ok(_) => {
                    tracing::info!("Listener left room {}", room_id);
                    // Connection will be closed by the client
                }
                Err(e) => {
                    tracing::error!("Failed to handle listener leave for room {}: {}", room_id, e);
                    let mut response = ServerEvent::CommandFailed {
                        command: "leaveRoom".to_string(),
                        error: format!("Leave room failed: {}", e),
                        trace_context: None,
                    };
                    inject_trace_context_into_event(&mut response, &tracing::Span::current());

                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
            }
        }
        ClientCommand::RequestConsumer { producer_id, .. } => {
            // Handle listener requesting consumer creation for a specific producer
            match handle_request_consumer(room_id, connection_id, producer_id.clone(), state).await {
                Ok(consumer_params) => {
                    // Send ConsumerCreated event with consumer parameters
                    let mut response = ServerEvent::ConsumerCreated {
                        consumer_id: consumer_params.id.clone(),
                        producer_id: consumer_params.producer_id.clone(),
                        consumer_parameters: consumer_params,
                        trace_context: None,
                    };
                    inject_trace_context_into_event(&mut response, &tracing::Span::current());

                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to create consumer for producer {}: {}", producer_id, e);
                    let mut response = ServerEvent::CommandFailed {
                        command: "requestConsumer".to_string(),
                        error: format!("Consumer creation failed: {}", e),
                        trace_context: None,
                    };
                    inject_trace_context_into_event(&mut response, &tracing::Span::current());

                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
            }
        }
        // Reject DJ commands on listener handler
        ClientCommand::ConnectDjTransport { .. } |
        ClientCommand::Produce { .. } |
        ClientCommand::PauseStream { .. } |
        ClientCommand::ResumeStream { .. } |
        ClientCommand::CloseRoom { .. } => {
            tracing::warn!("Received DJ command on listener handler: {:?}", cmd.command_type());
            let mut response = ServerEvent::CommandFailed {
                command: cmd.command_type().to_string(),
                error: "DJ commands not supported on listener endpoint".to_string(),
                trace_context: None,
            };
            inject_trace_context_into_event(&mut response, &tracing::Span::current());

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
    dtls_parameters: DtlsParameters,
    state: &AppState,
) -> anyhow::Result<String> {
    tracing::debug!("DTLS parameters received: {}", serde_json::to_string_pretty(&dtls_parameters).unwrap_or_else(|_| "Invalid JSON".to_string()));
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

/// Handle get router capabilities request
#[tracing::instrument(skip(state), fields(room_id = %room_id))]
async fn handle_get_router_capabilities(
    room_id: Uuid,
    state: &AppState,
) -> anyhow::Result<crate::models::schemas::RtpCapabilitiesWrapper> {
    let room_state = state.get_room_state(&room_id)
        .ok_or_else(|| anyhow::anyhow!("Room not found"))?;

    let room_state_guard = room_state.read().await;

    // Get router RTP capabilities
    let router_rtp_capabilities = room_state_guard.router.as_ref()
        .ok_or_else(|| anyhow::anyhow!("No router found for room"))?
        .rtp_capabilities();

    tracing::info!(
        room_id = %room_id,
        "Returned router RTP capabilities for device initialization"
    );

    Ok(router_rtp_capabilities.into())
}

/// Handle join request with producer validation and Jaeger spans
#[tracing::instrument(skip(state, device_rtp_capabilities), fields(room_id = %room_id, producer_exists = tracing::field::Empty, listener_count = tracing::field::Empty))]
async fn handle_request_join(
    room_id: Uuid,
    device_rtp_capabilities: serde_json::Value,
    listener_id: String,
    state: &AppState,
) -> anyhow::Result<(crate::models::events::RoomInfo, crate::models::schemas::TransportOptions, String, crate::models::schemas::RtpCapabilitiesWrapper)> {
    let span = tracing::Span::current();

    let room_state = state.get_room_state(&room_id)
        .ok_or_else(|| anyhow::anyhow!("Room not found"))?;

    let mut room_state_guard = room_state.write().await;
    let room = room_state_guard.room.clone();

    // We'll create the ListenerState after the transport is created (in the return section)
    tracing::info!(
        listener_id = %listener_id,
        "Processing join request with device RTP capabilities"
    );

    // REQUIRED: Validate that producer exists (rooms without producers should not exist)
    let producer_id = if let Some(producer) = &room_state_guard.audio_producer {
        span.record("producer_exists", true);
        producer.id().to_string()
    } else {
        span.record("producer_exists", false);
        return Err(anyhow::anyhow!("No producer available in room - room without producer should not exist"));
    };

    // Get router RTP capabilities for device initialization
    let router_rtp_capabilities = room_state_guard.router.as_ref()
        .ok_or_else(|| anyhow::anyhow!("No router found for room"))?
        .rtp_capabilities();

    // Create template transport options for listener using the transport manager
    let transport_manager = crate::webrtc::transport::TransportManager::default();
    let router = room_state_guard.router.as_ref()
        .ok_or_else(|| anyhow::anyhow!("No router found for room"))?;
    
    let (listener_transport, transport_options_json) = transport_manager
        .create_listener_transport(router, room_id, "temp")
        .await
        .map_err(|e| anyhow::anyhow!("Failed to create listener transport: {}", e))?;

    // Convert the JSON transport options to our typed TransportOptions struct
    let transport_options: crate::models::schemas::TransportOptions = serde_json::from_value(transport_options_json)
        .map_err(|e| anyhow::anyhow!("Failed to convert transport options: {}", e))?;

    // Create and store ListenerState with transport and device capabilities
    let listener_state = crate::webrtc::consumer::ListenerState::new(
        listener_id.clone(),
        room_id,
        listener_transport,
        device_rtp_capabilities,
    );
    room_state_guard.add_listener(listener_state);

    span.record("listener_count", room.listener_count);
    
    tracing::info!(
        room_id = %room_id,
        producer_id = %producer_id,
        listener_id = %listener_id,
        listener_count = room.listener_count,
        "Join request validated - ListenerState created and stored"
    );

    Ok((
        room.into(), // Convert Room to RoomInfo
        transport_options,
        producer_id,
        router_rtp_capabilities.into(), // Convert to RtpCapabilitiesWrapper
    ))
}

/// Handle listener transport connection with DTLS parameters and consumer creation
#[tracing::instrument(skip(state, dtls_parameters), fields(room_id = %room_id, listener_id = %listener_id, transport_id = tracing::field::Empty, consumer_id = tracing::field::Empty))]
async fn handle_connect_listener_transport(
    room_id: Uuid,
    listener_id: String,
    dtls_parameters: DtlsParameters,
    state: &AppState,
) -> anyhow::Result<String> {
    let span = tracing::Span::current();
    tracing::debug!("DTLS parameters received for listener: {}", serde_json::to_string_pretty(&dtls_parameters).unwrap_or_else(|_| "Invalid JSON".to_string()));
    
    let room_state = state.get_room_state(&room_id)
        .ok_or_else(|| anyhow::anyhow!("Room not found"))?;

    let room_state_guard = room_state.read().await;
    
    // Get existing ListenerState (created during requestJoin)
    let mut listener_state = room_state_guard.get_listener(&listener_id)
        .ok_or_else(|| anyhow::anyhow!("No ListenerState found for listener_id: {}", listener_id))?;
    
    let transport_id = listener_state.transport.id().to_string();
    span.record("transport_id", &transport_id);

    // Connect the existing transport with provided DTLS parameters
    listener_state.transport.connect(mediasoup::prelude::WebRtcTransportRemoteParameters { 
        dtls_parameters 
    }).await.map_err(|e| anyhow::anyhow!("Failed to connect listener transport: {}", e))?;

    tracing::info!(
        listener_id = %listener_id,
        transport_id = %transport_id,
        room_id = %room_id,
        "Listener transport connected successfully"
    );
    
    // Transport connection is complete - consumer creation handled separately via requestConsumer
    Ok(transport_id)
}

/// Handle listener leaving the room with full cleanup
#[tracing::instrument(skip(state), fields(room_id = %room_id, listeners_cleaned = tracing::field::Empty, transports_cleaned = tracing::field::Empty, consumers_cleaned = tracing::field::Empty))]
async fn handle_listener_leave(
    room_id: Uuid,
    state: &AppState,
) -> anyhow::Result<()> {
    let span = tracing::Span::current();
    
    let room_state = state.get_room_state(&room_id)
        .ok_or_else(|| anyhow::anyhow!("Room not found"))?;

    let mut room_state_guard = room_state.write().await;
    
    // Get all listener IDs to clean up
    let listener_ids: Vec<String> = room_state_guard.listeners.iter().map(|entry| entry.key().clone()).collect();
    
    let mut transports_cleaned = 0;
    let mut consumers_cleaned = 0;
    
    // Clean up all listener resources
    for listener_id in &listener_ids {
        // Remove listener state (includes transport and consumer)
        if let Some((_listener_id, listener_state)) = room_state_guard.listeners.remove(listener_id) {
            // Close consumer if exists
            if let Some(consumer) = listener_state.consumer {
                if let Err(e) = crate::webrtc::ConsumerManager::close_consumer(&consumer).await {
                    tracing::warn!("Failed to close consumer for listener {}: {}", listener_id, e);
                } else {
                    consumers_cleaned += 1;
                    tracing::debug!("Closed consumer for listener {}", listener_id);
                }
            }
            
            // Transport will be automatically closed when dropped (it's in the listener_state.transport)
            transports_cleaned += 1;
            tracing::debug!("Cleaned up transport for listener {}", listener_id);
        }
    }
    
    // Update listener count
    let previous_count = room_state_guard.room.listener_count;
    room_state_guard.room.listener_count = room_state_guard.room.listener_count.saturating_sub(listener_ids.len() as u32);
    
    span.record("listeners_cleaned", listener_ids.len());
    span.record("transports_cleaned", transports_cleaned);
    span.record("consumers_cleaned", consumers_cleaned);
    
    tracing::info!(
        room_id = %room_id,
        listeners_cleaned = listener_ids.len(),
        transports_cleaned = transports_cleaned,
        consumers_cleaned = consumers_cleaned,
        previous_listener_count = previous_count,
        new_listener_count = room_state_guard.room.listener_count,
        "Completed listener cleanup for room"
    );
    
    // Broadcast listener count update
    if previous_count != room_state_guard.room.listener_count {
        let listener_update = crate::models::events::ServerEvent::ListenerCountUpdated {
            room_id: room_id.to_string(),
            count: room_state_guard.room.listener_count,
            trace_context: None,
        };
        
        if let Ok(msg) = serde_json::to_string(&listener_update) {
            // Broadcast to lobby
            let lobby_event = crate::models::events::LobbyEvent::RoomUpdated {
                room: room_state_guard.room.clone().into(),
                trace_context: None,
            };
            state.broadcast_tx.send(lobby_event).ok();
        }
    }
    
    Ok(())
}

/// Handle listener requesting consumer creation for a specific producer
#[tracing::instrument(skip(state), fields(room_id = %room_id, connection_id = %connection_id, producer_id = %producer_id, consumer_id = tracing::field::Empty))]
async fn handle_request_consumer(
    room_id: Uuid,
    connection_id: Uuid,
    producer_id: String,
    state: &AppState,
) -> anyhow::Result<crate::models::schemas::ConsumerParameters> {
    let span = tracing::Span::current();
    let listener_id = connection_id.to_string();
    
    let room_state = state.get_room_state(&room_id)
        .ok_or_else(|| anyhow::anyhow!("Room not found"))?;

    let mut room_state_guard = room_state.write().await;
    
    // Get the producer
    let producer = room_state_guard.audio_producer.as_ref()
        .ok_or_else(|| anyhow::anyhow!("No audio producer found in room"))?;
    
    // Validate producer ID matches
    if producer.id().to_string() != producer_id {
        return Err(anyhow::anyhow!("Producer ID mismatch: expected {}, got {}", producer.id(), producer_id));
    }
    
    // Get listener's state which includes transport and RTP capabilities
    let listener_state = room_state_guard.get_listener(&listener_id)
        .ok_or_else(|| anyhow::anyhow!("Listener state not found"))?;
    
    let listener_transport = &listener_state.transport;
    let rtp_capabilities = listener_state.device_rtp_capabilities.clone();
    
    // Create the consumer
    let (consumer, consumer_id, consumer_params) = crate::webrtc::ConsumerManager::create_audio_consumer(
        listener_transport,
        producer,
        room_id,
        &listener_id,
        rtp_capabilities,
    ).await?;
    
    span.record("consumer_id", &consumer_id);
    
    // Update ListenerState with consumer information
    room_state_guard.update_listener(&listener_id, |state| {
        state.set_consumer(consumer.clone(), consumer_id.clone(), producer.id().to_string());
    });
    
    // Convert Value to ConsumerParameters struct
    let consumer_parameters = serde_json::from_value::<crate::models::schemas::ConsumerParameters>(consumer_params)?;
    
    tracing::info!(
        room_id = %room_id,
        listener_id = %listener_id,
        consumer_id = %consumer_id,
        producer_id = %producer_id,
        "Consumer created successfully for listener"
    );
    
    Ok(consumer_parameters)
}
