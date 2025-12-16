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
    lib::{models::{LobbyCommand, DjCommand, ListenerCommand, DjEvent, ListenerEvent, LobbyEvent}, domain::{Lobby, Listener}},
};

/// WebSocket handler for room-specific connections (DJ control)
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Path(room_id): Path<Uuid>,
    State(lobby): State<Lobby>,
) -> Response {
    ws.on_upgrade(move |socket| handle_room_socket(socket, room_id, lobby))
}

/// WebSocket handler for lobby (room list updates)
pub async fn lobby_handler(
    ws: WebSocketUpgrade,
    State(lobby): State<Lobby>,
) -> Response {
    ws.on_upgrade(move |socket| handle_lobby_socket(socket, lobby))
}

/// WebSocket handler for listener connections
pub async fn listener_handler(
    ws: WebSocketUpgrade,
    Path(session_id): Path<String>,
    State(lobby): State<Lobby>,
) -> Response {
    ws.on_upgrade(move |socket| handle_listener_socket(socket, session_id, lobby))
}

async fn handle_room_socket(socket: WebSocket, room_id: Uuid, lobby: Lobby) {
    let (mut sender, mut receiver) = socket.split();

    // Spawn task to handle incoming messages
    let lobby_clone = lobby.clone();
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
                    match serde_json::from_str::<DjCommand>(&text) {
                        Ok(dj_cmd) => {
                            message_span.record("command_type", dj_cmd.command_type());
                            tracing::info!("Successfully parsed DJ WebSocket command: {}", dj_cmd.command_type());
                            handle_dj_command(dj_cmd, room_id, &lobby_clone, &mut sender).await;
                        }
                        Err(e) => {
                            tracing::error!(
                                raw_message = %text,
                                parse_error = %e,
                                "Failed to parse DjCommand from WebSocket message"
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

async fn handle_lobby_socket(socket: WebSocket, lobby: Lobby) {
    let (mut sender, mut receiver) = socket.split();

    // Send initial room list
    let rooms = lobby.get_public_rooms().await;
    if !rooms.is_empty() {
        if let Ok(msg) = serde_json::to_string(&LobbyEvent::RoomAdded {
            room: rooms.first().unwrap().clone().into(),
        }) {
            sender.send(Message::Text(msg)).await.ok();
        }
    }

    // Handle incoming commands and broadcast messages concurrently
    let lobby_clone = lobby.clone();
    let mut rx = lobby.subscribe_lobby_events();

    loop {
        tokio::select! {
            // Handle incoming commands
            msg = receiver.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(lobby_cmd) = serde_json::from_str::<LobbyCommand>(&text) {
                            tracing::debug!("Received lobby command: {:?}", lobby_cmd.command_type());
                            if let Err(e) = handle_lobby_command(lobby_cmd, &lobby_clone, &mut sender).await {
                                tracing::error!("Failed to handle lobby command: {}", e);
                            }
                        }
                    },
                    Some(Ok(Message::Close(_))) => break,
                    Some(Err(_)) => break,
                    None => break,
                    _ => {},
                }
            },
            // Handle broadcast messages
            broadcast_msg = rx.recv() => {
                match broadcast_msg {
                    Ok(broadcast_msg) => {
                        if let Ok(msg) = serde_json::to_string(&broadcast_msg) {
                            if sender.send(Message::Text(msg)).await.is_err() {
                                break;
                            }
                        }
                    },
                    Err(_) => break,
                }
            }
        }
    }
}

async fn handle_lobby_command(
    cmd: LobbyCommand,
    lobby: &Lobby,
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
) -> anyhow::Result<()> {
    // Extract trace context from the message and set up parent span

    match cmd {
        // Step 1 of DJ flow: Announce room creation in lobby
        LobbyCommand::AnnounceRoom { name, dj_name, description, tags } => {
            // Create parent span for the complete DJ flow
            let dj_flow_span = tracing::info_span!(
                "dj_room_creation_flow",
                flow.type = "dj_creation",
                flow.step = 1,
                flow.phase = "initiated",
                room.name = %name,
                dj.name = %dj_name,
                room.id = tracing::field::Empty,
                room.status = "setup"
            );
            let _flow_guard = dj_flow_span.enter();

            tracing::info!(
                "Step 1: DJ flow initiated - announcing room creation in lobby"
            );

            // Create room in setup state (not public yet)
            let room_id = uuid::Uuid::new_v4();
            dj_flow_span.record("room.id", room_id.to_string());

            tracing::info!(
                room_id = %room_id,
                "Step 1: Generated room ID, creating room with MediaSoup worker"
            );

            // Create room using lobby's worker pool
            let room_state = lobby.create_room(room_id, name.clone(), dj_name.clone(), description, tags).await?;

            tracing::info!(
                room_id = %room_id,
                "Step 1: Room created successfully with MediaSoup router and worker"
            );

            // Generate DJ WebSocket URL
            let ws_url = format!("/ws/room/{}", room_id);

            tracing::info!(
                room_id = %room_id,
                ws_url = %ws_url,
                "Step 1: Generated DJ WebSocket URL for room connection"
            );

            // Send RoomAnnounced event with connection details
            let room = room_state.read().await;
            let room_announced_event = DjEvent::RoomAnnounced {
                room: room.clone().into(),
                ws_url: ws_url.clone(),
            };
            drop(room);

            match serde_json::to_string(&room_announced_event) {
                Ok(msg) => {
                    match sender.send(Message::Text(msg)).await {
                        Ok(_) => {
                            dj_flow_span.record("flow.phase", "step1_completed");
                            tracing::info!(
                                room_id = %room_id,
                                ws_url = %ws_url,
                                "Step 1: COMPLETED - RoomAnnounced event sent to frontend. Frontend should now connect to DJ WebSocket."
                            );
                        }
                        Err(e) => {
                            dj_flow_span.record("flow.phase", "failed");
                            tracing::error!(
                                room_id = %room_id,
                                error = %e,
                                "Step 1: FAILED - Could not send RoomAnnounced event to frontend"
                            );
                        }
                    }
                }
                Err(e) => {
                    dj_flow_span.record("flow.phase", "failed");
                    tracing::error!(
                        room_id = %room_id,
                        error = %e,
                        "Step 1: FAILED - Could not serialize RoomAnnounced event"
                    );
                }
            }

            tracing::info!(
                room_id = %room_id,
                room_name = %name,
                dj_name = %dj_name,
                "Room announced successfully in lobby"
            );
        }

        // Step 1 of Listener flow: Request joining a room
        LobbyCommand::RequestJoin { session_id, room_id } => {
            // Create listener flow span
            let listener_flow_span = tracing::info_span!(
                "listener_join_request",
                flow.type = "listener_join",
                flow.step = 1,
                flow.phase = "initiated",
                room.id = %room_id,
                listener.session_id = %session_id
            );
            let _listener_flow_guard = listener_flow_span.enter();

            tracing::info!(
                session_id = %session_id,
                room_id = %room_id,
                "Step 1: Listener requesting to join room via lobby"
            );

            // Parse room_id
            let room_uuid = match uuid::Uuid::parse_str(&room_id) {
                Ok(uuid) => uuid,
                Err(_) => {
                    listener_flow_span.record("flow.phase", "failed");
                    tracing::error!(
                        session_id = %session_id,
                        room_id = %room_id,
                        "Step 1: FAILED - Invalid room ID format"
                    );
                    let response = LobbyEvent::JoinRoomResponse {
                        session_id: session_id.clone(),
                        room_id: room_id.clone(),
                        success: false,
                        error: Some("Invalid room ID format".to_string()),
                        listener_websocket_url: None,
                        room: None,
                    };
                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                    return Ok(());
                }
            };

            // Check if room exists and is public
            let room_result = lobby.get_room(&room_uuid);
            match room_result {
                Some(room_state) => {
                    let room_guard = room_state.read().await;
                    
                    // Verify room is public and has a producer
                    if !room_guard.is_public() {
                        listener_flow_span.record("flow.phase", "failed");
                        tracing::error!(
                            session_id = %session_id,
                            room_id = %room_id,
                            room_status = ?room_guard.status,
                            "Step 1: FAILED - Room is not public or has no producer"
                        );
                        let response = LobbyEvent::JoinRoomResponse {
                            session_id: session_id.clone(),
                            room_id: room_id.clone(),
                            success: false,
                            error: Some("Room is not available for listeners".to_string()),
                            listener_websocket_url: None,
                            room: None,
                        };
                        if let Ok(msg) = serde_json::to_string(&response) {
                            sender.send(Message::Text(msg)).await.ok();
                        }
                        return Ok(());
                    }

                    tracing::info!(
                        session_id = %session_id,
                        room_id = %room_id,
                        room_status = ?room_guard.status,
                        "Step 1: Room validated - creating listener and unique WebSocket URL"
                    );

                    // Create event channel for this listener
                    let (event_tx, _event_rx) = tokio::sync::mpsc::unbounded_channel();

                    // Create Listener struct (will be stored in room)
                    let listener = Listener::new(
                        session_id.clone(),
                        room_uuid,
                        serde_json::json!({}), // Placeholder device capabilities, will be updated later
                        event_tx,
                    );

                    // Store listener in room
                    room_guard.add_listener(listener);

                    // Generate unique WebSocket URL for this session
                    let listener_websocket_url = format!("/ws/listener/{}", session_id);

                    // Get room info for response
                    let room_info = room_guard.clone().into();

                    listener_flow_span.record("listener.websocket_url", &listener_websocket_url);
                    listener_flow_span.record("flow.phase", "completed");

                    tracing::info!(
                        session_id = %session_id,
                        room_id = %room_id,
                        websocket_url = %listener_websocket_url,
                        "Step 1: COMPLETED - Listener created and stored in room, unique WebSocket URL generated"
                    );

                    // Send successful response
                    let response = LobbyEvent::JoinRoomResponse {
                        session_id: session_id.clone(),
                        room_id: room_id.clone(),
                        success: true,
                        error: None,
                        listener_websocket_url: Some(listener_websocket_url),
                        room: Some(room_info),
                    };

                    if let Ok(msg) = serde_json::to_string(&response) {
                        match sender.send(Message::Text(msg)).await {
                            Ok(_) => {
                                tracing::info!(
                                    session_id = %session_id,
                                    room_id = %room_id,
                                    "Step 1: JoinRoomResponse sent successfully - frontend should now connect to unique listener WebSocket"
                                );
                            }
                            Err(e) => {
                                tracing::error!(
                                    session_id = %session_id,
                                    room_id = %room_id,
                                    error = %e,
                                    "Step 1: Failed to send JoinRoomResponse"
                                );
                            }
                        }
                    }
                }
                None => {
                    listener_flow_span.record("flow.phase", "failed");
                    tracing::error!(
                        session_id = %session_id,
                        room_id = %room_id,
                        "Step 1: FAILED - Room not found"
                    );
                    let response = LobbyEvent::JoinRoomResponse {
                        session_id: session_id.clone(),
                        room_id: room_id.clone(),
                        success: false,
                        error: Some("Room not found".to_string()),
                        listener_websocket_url: None,
                        room: None,
                    };
                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
            }
        }
    }
    
    Ok(())
}

async fn handle_listener_socket(socket: WebSocket, session_id: String, lobby: Lobby) {
    let (mut sender, mut receiver) = socket.split();

    tracing::info!(
        session_id = %session_id,
        "New listener WebSocket connection established"
    );

    // Find the room that contains the listener with this session_id
    let (room_id, room_state) = match lobby.find_room_by_listener_session(&session_id).await {
        Some((room_id, room_state)) => {
            tracing::info!(
                session_id = %session_id,
                room_id = %room_id,
                "Found existing listener in room"
            );
            (room_id, room_state)
        }
        None => {
            tracing::error!(
                session_id = %session_id,
                "Listener not found in any room - WebSocket connection rejected"
            );
            return;
        }
    };

    // Update the listener's event_tx with a new channel for this WebSocket connection
    let mut event_rx = {
        let (event_tx, event_rx) = tokio::sync::mpsc::unbounded_channel();
        
        // Update the listener's event_tx to use the new channel for this WebSocket connection
        let update_success = room_state.read().await.update_listener(&session_id, |listener| {
            listener.event_tx = event_tx;
        });

        if update_success {
            tracing::info!(
                session_id = %session_id,
                room_id = %room_id,
                "Updated listener's event channel for WebSocket connection"
            );
            event_rx
        } else {
            tracing::error!(
                session_id = %session_id,
                room_id = %room_id,
                "Failed to update listener's event channel"
            );
            return;
        }
    };

    tracing::info!(
        session_id = %session_id,
        room_id = %room_id,
        "Listener WebSocket connection established - waiting for InitListener command"
    );

    // Handle both incoming messages and outgoing events concurrently
    let lobby_clone = lobby.clone();

    loop {
        tokio::select! {
            // Handle incoming WebSocket messages
            msg = receiver.next() => {
                if let Some(Ok(Message::Text(text))) = msg {
                    let message_span = tracing::debug_span!(
                        "listener_websocket_message_received",
                        room_id = %room_id,
                        session_id = %session_id,
                        message_length = text.len(),
                        command_type = tracing::field::Empty
                    );
                    let _enter = message_span.enter();

                    tracing::debug!("Raw listener WebSocket message received");
                    tracing::debug!("Raw message content: {}", &text);
                    match serde_json::from_str::<ListenerCommand>(&text) {
                        Ok(listener_cmd) => {
                            message_span.record("command_type", listener_cmd.command_type());
                            tracing::info!("Successfully parsed listener WebSocket command: {}", listener_cmd.command_type());
                            handle_listener_command(listener_cmd, room_id, session_id.clone(), &lobby_clone, &mut sender).await;
                        }
                        Err(e) => {
                            tracing::error!(
                                raw_message = %text,
                                parse_error = %e,
                                "Failed to parse ListenerCommand from listener WebSocket message"
                            );
                        }
                    }
                } else {
                    tracing::debug!(
                        room_id = %room_id,
                        session_id = %session_id,
                        "Listener WebSocket connection closed by client"
                    );
                    break;
                }
            },
            // Handle outgoing events
            event = event_rx.recv() => {
                if let Some(event) = event {
                    if let Ok(msg) = serde_json::to_string(&event) {
                        if sender.send(Message::Text(msg)).await.is_err() {
                            tracing::debug!(
                                room_id = %room_id,
                                session_id = %session_id,
                                "Failed to send event to listener, connection likely closed"
                            );
                            break;
                        }
                    }
                } else {
                    // Event channel closed
                    break;
                }
            }
        }
    }

    // Connection closed - perform cleanup
    tracing::info!(
        room_id = %room_id,
        session_id = %session_id,
        "Listener WebSocket connection closed, performing cleanup"
    );

    // Remove the specific listener by session_id using proper domain cleanup
    if let Some(room_state) = lobby.get_room(&room_id) {
        let mut room_guard = room_state.write().await;
        match room_guard.remove_listener(&session_id).await {
            Ok(()) => {
                tracing::info!(
                    session_id = %session_id,
                    room_id = %room_id,
                    "Listener removed and cleaned up successfully"
                );
            }
            Err(e) => {
                tracing::error!(
                    session_id = %session_id,
                    room_id = %room_id,
                    error = %e,
                    "Failed to remove listener during cleanup"
                );
            }
        }
    }

    tracing::info!(
        room_id = %room_id,
        session_id = %session_id,
        "Listener cleanup completed"
    );
}

#[tracing::instrument(skip(cmd, lobby, sender), fields(room_id = %room_id, command_type = cmd.command_type()))]
async fn handle_dj_command(
    cmd: DjCommand,
    room_id: Uuid,
    lobby: &Lobby,
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
) {
    // Extract trace context from the message and set up parent span

    match cmd {
        DjCommand::InitRoom { room_id: init_room_id, .. } => {
            // Step 2 of DJ flow span
            let step2_span = tracing::info_span!(
                "dj_flow_step2_init_room",
                flow.type = "dj_creation",
                flow.step = 2,
                flow.phase = "initiated",
                room.id = %room_id,
                dj.websocket = "connected"
            );
            let _step2_guard = step2_span.enter();

            tracing::info!(
                init_room_id = %init_room_id,
                "Step 2: DJ connected to WebSocket, initializing room connection"
            );

            // Verify the room ID matches
            if room_id.to_string() != init_room_id {
                step2_span.record("flow.phase", "failed");
                tracing::error!(
                    expected_room_id = %room_id,
                    received_room_id = %init_room_id,
                    "Step 2: FAILED - Room ID mismatch in InitRoom command"
                );
                let response = DjEvent::CommandFailed {
                    command: "initRoom".to_string(),
                    error: "Room ID mismatch".to_string(),
                };
                if let Ok(msg) = serde_json::to_string(&response) {
                    sender.send(Message::Text(msg)).await.ok();
                }
                return;
            }

            tracing::info!(
                room_id = %room_id,
                "Step 2: Room ID validated, retrieving router RTP capabilities"
            );

            // Get room state and send RTP capabilities
            if let Some(room_state) = lobby.get_room(&room_id) {
                let room_state_guard = room_state.read().await;
                if let Some(router) = room_state_guard.router() {
                    let router_rtp_capabilities = router.rtp_capabilities();
                    
                    tracing::debug!(
                        router_id = %router.id(),
                        codec_count = router_rtp_capabilities.codecs.len(),
                        "Step 2: Retrieved router RTP capabilities for device initialization"
                    );
                    
                    let response = DjEvent::RoomInitialized {
                        room_id: room_id.to_string(),
                        rtp_capabilities: router_rtp_capabilities.into(),
                    };
                    
                    match serde_json::to_string(&response) {
                        Ok(msg) => {
                            match sender.send(Message::Text(msg)).await {
                                Ok(_) => {
                                    step2_span.record("flow.phase", "completed");
                                    tracing::info!(
                                        room_id = %room_id,
                                        router_id = %router.id(),
                                        "Step 2: COMPLETED - RoomInitialized event sent with RTP capabilities. Frontend should now create device and call load()."
                                    );
                                }
                                Err(e) => {
                                    step2_span.record("flow.phase", "failed");
                                    tracing::error!(
                                        room_id = %room_id,
                                        error = %e,
                                        "Step 2: FAILED - Could not send RoomInitialized event"
                                    );
                                }
                            }
                        }
                        Err(e) => {
                            step2_span.record("flow.phase", "failed");
                            tracing::error!(
                                room_id = %room_id,
                                error = %e,
                                "Step 2: FAILED - Could not serialize RoomInitialized event"
                            );
                        }
                    }
                } else {
                    step2_span.record("flow.phase", "failed");
                    tracing::error!(
                        room_id = %room_id,
                        "Step 2: FAILED - No router found for room (room may be corrupted)"
                    );
                    let response = DjEvent::CommandFailed {
                        command: "initRoom".to_string(),
                        error: "Room router not available".to_string(),
                    };
                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
            } else {
                step2_span.record("flow.phase", "failed");
                tracing::error!(
                    room_id = %room_id,
                    "Step 2: FAILED - Room not found in lobby (may have been deleted)"
                );
                let response = DjEvent::RoomNotFound {
                    room_id: room_id.to_string(),
                };
                if let Ok(msg) = serde_json::to_string(&response) {
                    sender.send(Message::Text(msg)).await.ok();
                }
            }
        }
        DjCommand::RequestDjTransport { .. } => {
            // Step 5 of DJ flow span
            let step5_span = tracing::info_span!(
                "dj_flow_step5_request_transport",
                flow.type = "dj_creation",
                flow.step = 5,
                flow.phase = "initiated",
                room.id = %room_id,
                webrtc.transport_type = "sender"
            );
            let _step5_guard = step5_span.enter();

            tracing::info!(
                room_id = %room_id,
                "Step 5: Frontend requesting WebRTC transport creation for DJ (after device initialization)"
            );

            // Use room's abstract coordination method (Step 6)
            if let Some(room_state) = lobby.get_room(&room_id) {
                tracing::debug!(
                    room_id = %room_id,
                    "Step 5-6: Creating DJ sender transport using router"
                );

                let transport_result = {
                    let mut room_state_guard = room_state.write().await;
                    // Initialize DJ transport using proper domain method
                    room_state_guard.initialize_dj_transport().await
                };
                
                match transport_result {
                    Ok(transport_options) => {
                        step5_span.record("webrtc.transport_id", transport_options.id.as_str());
                        step5_span.record("flow.phase", "completed");
                        
                        tracing::info!(
                            room_id = %room_id,
                            transport_id = %transport_options.id,
                            ice_candidates_count = transport_options.ice_candidates.len(),
                            "Step 6-7: DJ sender transport created successfully"
                        );

                        let response = DjEvent::DjTransportReady {
                            transport_options,
                        };
                        
                        match serde_json::to_string(&response) {
                            Ok(msg) => {
                                match sender.send(Message::Text(msg)).await {
                                    Ok(_) => {
                                        tracing::info!(
                                            room_id = %room_id,
                                            "Step 7: COMPLETED - DjTransportReady event sent with transport params. Frontend should now create send transport and call produce()."
                                        );
                                    }
                                    Err(e) => {
                                        step5_span.record("flow.phase", "failed");
                                        tracing::error!(
                                            room_id = %room_id,
                                            error = %e,
                                            "Step 7: FAILED - Could not send DjTransportReady event"
                                        );
                                    }
                                }
                            }
                            Err(e) => {
                                step5_span.record("flow.phase", "failed");
                                tracing::error!(
                                    room_id = %room_id,
                                    error = %e,
                                    "Step 7: FAILED - Could not serialize DjTransportReady event"
                                );
                            }
                        }
                    }
                    Err(e) => {
                        step5_span.record("flow.phase", "failed");
                        tracing::error!(
                            room_id = %room_id,
                            error = %e,
                            "Step 6: FAILED - DJ transport creation failed"
                        );
                        let response = DjEvent::CommandFailed {
                            command: "requestDjTransport".to_string(),
                            error: format!("Failed to create transport: {}", e),
                        };
                        if let Ok(msg) = serde_json::to_string(&response) {
                            sender.send(Message::Text(msg)).await.ok();
                        }
                    }
                }
            } else {
                tracing::error!("Room {} not found", room_id);
                let response = DjEvent::RoomNotFound {
                    room_id: room_id.to_string(),
                };
                if let Ok(msg) = serde_json::to_string(&response) {
                    sender.send(Message::Text(msg)).await.ok();
                }
            }
        }
        DjCommand::ConnectDjTransport { transport_id, dtls_parameters, .. } => {
            // Step 11 of DJ flow span
            let step11_span = tracing::info_span!(
                "dj_flow_step11_connect_transport",
                flow.type = "dj_creation",
                flow.step = 11,
                flow.phase = "initiated",
                room.id = %room_id,
                webrtc.transport_id = transport_id.as_deref().unwrap_or("unknown"),
                webrtc.dtls_role = %dtls_parameters.role
            );
            let _step11_guard = step11_span.enter();

            tracing::info!(
                room_id = %room_id,
                client_transport_id = ?transport_id,
                dtls_role = %dtls_parameters.role,
                "Step 11: Frontend sending DTLS parameters for transport connection"
            );

            // Log transport ID for connection validation (follows MediaSoup standard pattern)
            if let Some(ref transport_id) = transport_id {
                tracing::debug!(
                    room_id = %room_id,
                    transport_id = %transport_id,
                    "Step 11: Client provided transport ID for validation"
                );
            }

            // Convert JSON DTLS parameters to native MediaSoup types
            let native_dtls_parameters = match DtlsParameters::try_from(dtls_parameters) {
                Ok(params) => {
                    tracing::debug!(
                        room_id = %room_id,
                        dtls_role = ?params.role,
                        fingerprint_count = params.fingerprints.len(),
                        "Step 11: DTLS parameters validated and converted to native types"
                    );
                    params
                }
                Err(e) => {
                    step11_span.record("flow.phase", "failed");
                    tracing::error!(
                        room_id = %room_id,
                        error = %e,
                        "Step 11: FAILED - Invalid DTLS parameters from frontend"
                    );
                    return;
                }
            };

            // Connect DJ's WebRTC transport
            tracing::info!(
                room_id = %room_id,
                "Step 12: Initiating DTLS handshake for DJ transport"
            );

            match handle_connect_transport(room_id, transport_id, native_dtls_parameters, &lobby).await {
                Ok(transport_id) => {
                    step11_span.record("webrtc.connected_transport_id", transport_id.as_str());
                    step11_span.record("flow.phase", "completed");
                    
                    tracing::info!(
                        room_id = %room_id,
                        transport_id = %transport_id,
                        "Step 12: DTLS handshake completed, DJ transport connected successfully"
                    );

                    let response = DjEvent::TransportConnected {
                        transport_id: transport_id.clone(), // Use actual transport ID from mediasoup
                    };

                    match serde_json::to_string(&response) {
                        Ok(msg) => {
                            match sender.send(Message::Text(msg)).await {
                                Ok(_) => {
                                    tracing::info!(
                                        room_id = %room_id,
                                        transport_id = %transport_id,
                                        "Step 12: COMPLETED - TransportConnected event sent. Frontend should now call produce() to create audio producer."
                                    );
                                }
                                Err(e) => {
                                    tracing::error!(
                                        room_id = %room_id,
                                        error = %e,
                                        "Step 12: Transport connected but failed to send confirmation event"
                                    );
                                }
                            }
                        }
                        Err(e) => {
                            tracing::error!(
                                room_id = %room_id,
                                error = %e,
                                "Step 12: Transport connected but failed to serialize confirmation event"
                            );
                        }
                    }
                }
                Err(e) => {
                    step11_span.record("flow.phase", "failed");
                    tracing::error!(
                        room_id = %room_id,
                        error = %e,
                        "Step 12: FAILED - DTLS handshake failed, transport connection unsuccessful"
                    );
                    let response = DjEvent::CommandFailed {
                        command: "connectTransport".to_string(),
                        error: format!("Transport connection failed: {}", e),
                    };

                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
            }
        }
        DjCommand::Produce { rtp_parameters, .. } => {
            // Step 14 of DJ flow span
            let step14_span = tracing::info_span!(
                "dj_flow_step14_produce",
                flow.type = "dj_creation",
                flow.step = 14,
                flow.phase = "initiated",
                room.id = %room_id,
                webrtc.media_kind = "audio",
                webrtc.producer_id = tracing::field::Empty
            );
            let _step14_guard = step14_span.enter();

            tracing::info!(
                room_id = %room_id,
                has_encodings = rtp_parameters.get("encodings").is_some(),
                has_codecs = rtp_parameters.get("codecs").is_some(),
                "Step 14: Frontend sending RTP parameters to create audio producer"
            );

            // Create audio producer
            match handle_produce(room_id, rtp_parameters, &lobby).await {
                Ok(producer_id) => {
                    step14_span.record("webrtc.producer_id", producer_id.as_str());
                    step14_span.record("flow.phase", "completed");

                    // Producer created and room is now live/public (via on_producer_ready)
                    tracing::info!(
                        room_id = %room_id,
                        producer_id = %producer_id,
                        "Step 15-16: Audio producer created successfully, room transitioning to LIVE status"
                    );

                    let response = DjEvent::ProducerCreated {
                        producer_id: producer_id.clone(),
                        room_id: room_id.to_string(),
                    };
                    
                    match serde_json::to_string(&response) {
                        Ok(msg) => {
                            match sender.send(Message::Text(msg)).await {
                                Ok(_) => {
                                    tracing::info!(
                                        room_id = %room_id,
                                        producer_id = %producer_id,
                                        "Step 17: COMPLETED - ProducerCreated event sent. Room is now PUBLIC and streaming. Frontend can now call producer callback."
                                    );
                                }
                                Err(e) => {
                                    tracing::error!(
                                        room_id = %room_id,
                                        producer_id = %producer_id,
                                        error = %e,
                                        "Step 17: Producer created but failed to send ProducerCreated event"
                                    );
                                }
                            }
                        }
                        Err(e) => {
                            tracing::error!(
                                room_id = %room_id,
                                producer_id = %producer_id,
                                error = %e,
                                "Step 17: Producer created but failed to serialize ProducerCreated event"
                            );
                        }
                    }
                }
                Err(e) => {
                    step14_span.record("flow.phase", "failed");
                    tracing::error!(
                        room_id = %room_id,
                        error = %e,
                        "Step 15: FAILED - Audio producer creation failed, room remains in SETUP status"
                    );
                    let response = DjEvent::CommandFailed {
                        command: "produce".to_string(),
                        error: format!("Producer creation failed: {}", e),
                    };
                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
            }
        }
        DjCommand::PauseStream => {
            // Stop producing and pause room
            match handle_stop_producing(room_id, &lobby).await {
                Ok(_) => {
                    // Producer paused and room status updated
                    tracing::info!("Stop producing for room {}", room_id);
                    let response = DjEvent::StreamPaused {
                        room_id: room_id.to_string(),
                    };
                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to pause stream for room {}: {}", room_id, e);
                    let response = DjEvent::CommandFailed {
                        command: "pauseStream".to_string(),
                        error: format!("Stream pause failed: {}", e),
                    };
                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
            }
        }
        DjCommand::ResumeStream => {
            // Resume producing
            match handle_resume_producing(room_id, &lobby).await {
                Ok(_) => {
                    let response = DjEvent::StreamResumed {
                        room_id: room_id.to_string(),
                    };
                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to resume stream for room {}: {}", room_id, e);
                    let response = DjEvent::CommandFailed {
                        command: "resumeStream".to_string(),
                        error: format!("Stream resume failed: {}", e),
                    };
                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
            }
        }
        DjCommand::CloseRoom => {
            // Clean up room and all resources
            match handle_delete_room(room_id, &lobby).await {
                Ok(_) => {
                    lobby.remove_room(&room_id).await;
                    let response = DjEvent::RoomClosed {
                        room_id: room_id.to_string(),
                        reason: "Closed by DJ".to_string(),
                    };
                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to delete room {}: {}", room_id, e);
                    let response = DjEvent::CommandFailed {
                        command: "closeRoom".to_string(),
                        error: format!("Room deletion failed: {}", e),
                    };
                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
            }
        }
    }
}

#[tracing::instrument(skip(cmd, lobby, sender), fields(room_id = %room_id, session_id = %session_id, command_type = cmd.command_type()))]
async fn handle_listener_command(
    cmd: ListenerCommand,
    room_id: Uuid,
    session_id: String,
    lobby: &Lobby,
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
) {
    // Extract trace context from the message and set up parent span

    match cmd {
        // Step 2 of listener flow: Request router RTP capabilities
        ListenerCommand::GetRouterCapabilities { room_id: requested_room_id } => {
            tracing::info!(
                session_id = %session_id,
                room_id = %room_id,
                requested_room_id = %requested_room_id,
                "Step 2: Listener requesting router RTP capabilities"
            );

            // Get the room and extract router RTP capabilities using domain method
            if let Some(room_state) = lobby.get_room(&room_id) {
                let room_guard = room_state.read().await;
                
                // Use domain method to get native MediaSoup RTP capabilities
                match room_guard.get_router_rtp_capabilities() {
                    Ok(router_rtp_capabilities) => {
                        tracing::info!(
                            session_id = %session_id,
                            room_id = %room_id,
                            codec_count = router_rtp_capabilities.codecs.len(),
                            "Step 2: COMPLETED - Router RTP capabilities retrieved successfully"
                        );

                        // Convert native MediaSoup type to API wrapper type in WebSocket layer
                        let response = ListenerEvent::RouterCapabilities {
                            room_id: room_id.to_string(),
                            rtp_capabilities: router_rtp_capabilities.into(), // Convert to RtpCapabilitiesWrapper
                        };

                        if let Ok(msg) = serde_json::to_string(&response) {
                            if let Err(e) = sender.send(Message::Text(msg)).await {
                                tracing::error!(
                                    session_id = %session_id,
                                    room_id = %room_id,
                                    error = %e,
                                    "Step 2: Failed to send RouterCapabilities event"
                                );
                            }
                        }
                    }
                    Err(e) => {
                        tracing::error!(
                            session_id = %session_id,
                            room_id = %room_id,
                            error = %e,
                            "Step 2: FAILED - Could not get router RTP capabilities from domain"
                        );
                        
                        let response = ListenerEvent::CommandFailed {
                            command: "getRouterCapabilities".to_string(),
                            error: format!("Router capabilities not available: {}", e),
                        };
                        if let Ok(msg) = serde_json::to_string(&response) {
                            sender.send(Message::Text(msg)).await.ok();
                        }
                    }
                }
            } else {
                tracing::error!(
                    session_id = %session_id,
                    room_id = %room_id,
                    "Step 2: FAILED - Room not found"
                );
                
                let response = ListenerEvent::RoomNotFound {
                    room_id: room_id.to_string(),
                };
                if let Ok(msg) = serde_json::to_string(&response) {
                    sender.send(Message::Text(msg)).await.ok();
                }
            }
        }

        // Step 4 of listener flow: Initialize listener transport
        ListenerCommand::InitListener => {
            tracing::info!(
                session_id = %session_id,
                room_id = %room_id,
                "Step 2: Listener requesting transport initialization"
            );

            // Delegate to room domain logic
            if let Some(room_state) = lobby.get_room(&room_id) {
                let mut room_guard = room_state.write().await;
                match room_guard.init_listener_transport(&session_id).await {
                    Ok(transport_options) => {
                        tracing::info!(
                            session_id = %session_id,
                            room_id = %room_id,
                            transport_id = %transport_options.id,
                            "Step 2: COMPLETED - Listener transport created successfully"
                        );

                        let response = ListenerEvent::ListenerTransportReady {
                            transport_options,
                        };

                        if let Ok(msg) = serde_json::to_string(&response) {
                            if let Err(e) = sender.send(Message::Text(msg)).await {
                                tracing::error!(
                                    session_id = %session_id,
                                    room_id = %room_id,
                                    error = %e,
                                    "Step 2: Failed to send ListenerTransportReady event"
                                );
                            }
                        }
                    }
                    Err(e) => {
                        tracing::error!(
                            session_id = %session_id,
                            room_id = %room_id,
                            error = %e,
                            "Step 2: FAILED - Listener transport creation failed"
                        );
                        let response = ListenerEvent::CommandFailed {
                            command: "initListener".to_string(),
                            error: format!("Failed to create transport: {}", e),
                        };
                        if let Ok(msg) = serde_json::to_string(&response) {
                            sender.send(Message::Text(msg)).await.ok();
                        }
                    }
                }
            } else {
                tracing::error!(
                    session_id = %session_id,
                    room_id = %room_id,
                    "Step 2: FAILED - Room not found"
                );
                let response = ListenerEvent::CommandFailed {
                    command: "initListener".to_string(),
                    error: "Room not found".to_string(),
                };
                if let Ok(msg) = serde_json::to_string(&response) {
                    sender.send(Message::Text(msg)).await.ok();
                }
            }
        }
        
        ListenerCommand::ResumeConsumer { consumer_id, .. } => {
            tracing::info!(
                room_id = %room_id,
                session_id = %session_id,
                consumer_id = %consumer_id,
                "Received request to resume consumer"
            );

            let mut success = false;
            let mut error_msg = String::new();

            if let Some(room_state) = lobby.get_room(&room_id) {
                // Room uses DashMap for listeners, so we don't need a write lock on the whole room
                // We just need to access the listeners map

                // Listeners map is keyed by session_id

                if let Some(mut listener_entry) = room_state.read().await.listeners.get_mut(&session_id) {
                    let listener_state = listener_entry.value_mut();

                    // Verify this listener actually owns the requested consumer
                    if let Some(current_consumer_id) = &listener_state.consumer_id {
                        if current_consumer_id == &consumer_id {
                            if let Some(consumer) = &listener_state.consumer {
                                 match consumer.resume().await {
                                    Ok(_) => {
                                        tracing::info!("Successfully resumed mediasoup consumer {}", consumer_id);
                                        success = true;
                                    },
                                    Err(e) => {
                                        error_msg = format!("Mediasoup error: {}", e);
                                        tracing::error!("Failed to resume consumer {}: {}", consumer_id, e);
                                    }
                                }
                            } else {
                                error_msg = "Consumer object missing in listener state".to_string();
                            }
                        } else {
                            error_msg = format!("Listener owns different consumer: {:?}", current_consumer_id);
                        }
                    } else {
                        error_msg = "Listener has no active consumer".to_string();
                    }
                } else {
                    error_msg = format!("Listener {} not found in room", session_id);
                }
            } else {
                error_msg = "Room not found".to_string();
            }

            // Send response back to client
            // if success {
            //      let response = ListenerEvent::ConsumerResumed {
            //         consumer_id: consumer_id.clone(),
            //     };
            //
            //     if let Ok(msg) = serde_json::to_string(&response) {
            //         sender.send(Message::Text(msg)).await.ok();
            //     }
            // } else {
            //      let response = ListenerEvent::CommandFailed {
            //         command: "resumeConsumer".to_string(),
            //         error: format!("Failed to resume consumer {}: {}", consumer_id, error_msg),
            //     };
            //
            //     if let Ok(msg) = serde_json::to_string(&response) {
            //         sender.send(Message::Text(msg)).await.ok();
            //     }
            // }
        }
        ListenerCommand::GetRouterCapabilities { room_id: requested_room_id, .. } => {
            // Validate that the requested room ID matches the WebSocket path
            if requested_room_id != room_id.to_string() {
                tracing::warn!("Room ID mismatch: requested {} but connected to {}", requested_room_id, room_id);
                let response = ListenerEvent::CommandFailed {
                    command: "getRouterCapabilities".to_string(),
                    error: "Room ID mismatch".to_string(),
                };

                if let Ok(msg) = serde_json::to_string(&response) {
                    sender.send(Message::Text(msg)).await.ok();
                }
                return;
            }

            // Handle router capabilities request
            match handle_get_router_capabilities(room_id, &lobby).await {
                Ok(rtp_capabilities) => {
                    let response = ListenerEvent::RouterCapabilities {
                        room_id: room_id.to_string(),
                        rtp_capabilities,
                    };

                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to get router capabilities for room {}: {}", room_id, e);
                    let response = ListenerEvent::CommandFailed {
                        command: "getRouterCapabilities".to_string(),
                        error: format!("Failed to get router capabilities: {}", e),
                    };

                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
            }
        }
        ListenerCommand::ConnectListenerTransport { transport_id, dtls_parameters, .. } => {
            // Log transport ID for connection validation (follows MediaSoup standard pattern)
            if let Some(ref transport_id) = transport_id {
                tracing::debug!(
                    room_id = %room_id,
                    transport_id = %transport_id,
                    "Listener transport connect request with client transport ID"
                );
            }

            // Convert JSON DTLS parameters to native MediaSoup types
            let native_dtls_parameters = match DtlsParameters::try_from(dtls_parameters) {
                Ok(params) => params,
                Err(e) => {
                    tracing::error!("Failed to convert DTLS parameters: {}", e);
                    return;
                }
            };

            // Connect listener's WebRTC transport
            match handle_connect_listener_transport(room_id, session_id.clone(), transport_id, native_dtls_parameters, &lobby).await {
                Ok(transport_id) => {
                    // Send TransportConnected event
                    let response = ListenerEvent::TransportConnected {
                        transport_id,
                    };

                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }

                    // Consumer creation is handled separately via requestConsumer command
                }
                Err(e) => {
                    tracing::error!("Failed to connect listener transport for room {}: {}", room_id, e);
                    let response = ListenerEvent::CommandFailed {
                        command: "connectListenerTransport".to_string(),
                        error: format!("Transport connection failed: {}", e),
                    };

                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
            }
        }
        ListenerCommand::LeaveRoom => {
            // Handle listener leaving the room using domain method
            match handle_listener_leave(room_id, &session_id, &lobby).await {
                Ok(_) => {
                    tracing::info!(
                        room_id = %room_id,
                        listener_id = %session_id,
                        "Listener left room successfully"
                    );
                    // Connection will be closed by the client
                }
                Err(e) => {
                    tracing::error!(
                        room_id = %room_id,
                        listener_id = %session_id,
                        error = %e,
                        "Failed to handle listener leave"
                    );
                    let response = ListenerEvent::CommandFailed {
                        command: "leaveRoom".to_string(),
                        error: format!("Leave room failed: {}", e),
                    };

                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
            }
        }
        ListenerCommand::RequestConsumer { rtp_capabilities, .. } => {
            // Handle listener requesting consumer creation for room's current producer
            match handle_request_consumer(room_id, &session_id, rtp_capabilities.clone(), &lobby).await {
                Ok(consumer_params) => {
                    // Send ConsumerCreated event with consumer parameters
                    let response = ListenerEvent::ConsumerCreated {
                        consumer_id: consumer_params.id.clone(),
                        producer_id: consumer_params.producer_id.clone(),
                        consumer_parameters: consumer_params,
                    };

                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to create consumer: {}", e);
                    let response = ListenerEvent::CommandFailed {
                        command: "requestConsumer".to_string(),
                        error: format!("Consumer creation failed: {}", e),
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
#[tracing::instrument(skip(lobby, dtls_parameters), fields(room_id = %room_id, client_transport_id = tracing::field::Empty, actual_transport_id = tracing::field::Empty))]
async fn handle_connect_transport(
    room_id: Uuid,
    client_transport_id: Option<String>,
    dtls_parameters: DtlsParameters,
    lobby: &Lobby,
) -> anyhow::Result<String> {
    tracing::debug!("DTLS parameters received: {}", serde_json::to_string_pretty(&dtls_parameters).unwrap_or_else(|_| "Invalid JSON".to_string()));
    
    // Record client transport ID in span for debugging
    if let Some(ref client_id) = client_transport_id {
        tracing::Span::current().record("client_transport_id", client_id);
    }
    
    let room_state = lobby.get_room(&room_id)
        .ok_or_else(|| anyhow::anyhow!("Room not found"))?;

    let room_state_guard = room_state.read().await;
    if let Some(dj) = &room_state_guard.dj {
        if let Some(dj_transport) = &dj.transport {
            let actual_transport_id = dj_transport.id().to_string();

        // Record actual transport ID in span for debugging
        tracing::Span::current().record("actual_transport_id", &actual_transport_id);

        // CRITICAL: Validate that client transport ID matches actual transport ID
        if let Some(ref client_id) = client_transport_id {
            if client_id != &actual_transport_id {
                tracing::error!(
                    client_transport_id = %client_id,
                    actual_transport_id = %actual_transport_id,
                    "Transport ID mismatch! Client trying to connect wrong transport"
                );
                return Err(anyhow::anyhow!(
                    "Transport ID mismatch: client sent '{}' but room has '{}'", 
                    client_id, actual_transport_id
                ));
            } else {
                tracing::info!(
                    transport_id = %actual_transport_id,
                    "✅ Transport ID validation successful"
                );
            }
        } else {
            tracing::warn!(
                actual_transport_id = %actual_transport_id,
                "Client did not provide transport ID - allowing connection but this should be fixed"
            );
        }

            // Log detailed DTLS parameters before connecting
            tracing::info!(
                room_id = %room_id,
                transport_id = %actual_transport_id,
                dtls_role = ?dtls_parameters.role,
                fingerprint_count = dtls_parameters.fingerprints.len(),
                "🔄 Attempting MediaSoup transport.connect() with DTLS parameters"
            );

            // Connect DJ transport directly without transport manager
            match dj_transport.connect(mediasoup::webrtc_transport::WebRtcTransportRemoteParameters {
                dtls_parameters,
            }).await {
                Ok(_) => {
                    tracing::info!(
                        room_id = %room_id,
                        transport_id = %actual_transport_id,
                        "✅ MediaSoup transport.connect() succeeded - DTLS handshake completed"
                    );
                },
                Err(e) => {
                    tracing::error!(
                        room_id = %room_id,
                        transport_id = %actual_transport_id,
                        error = %e,
                        error_debug = ?e,
                        "❌ MediaSoup transport.connect() FAILED - DTLS handshake failed"
                    );
                    return Err(anyhow::anyhow!("MediaSoup transport connect failed: {}", e));
                }
            }

            tracing::info!("DJ transport connected for room {}, transport_id: {}", room_id, actual_transport_id);

            Ok(actual_transport_id)
        } else {
            return Err(anyhow::anyhow!("No DJ transport found for room"));
        }
    } else {
        return Err(anyhow::anyhow!("No DJ found for room"));
    }
}

/// Handle producer creation
#[tracing::instrument(skip(lobby, rtp_parameters), fields(
    room_id = %room_id,
    rtp_parameters_size = rtp_parameters.to_string().len()
))]
async fn handle_produce(
    room_id: Uuid,
    rtp_parameters: serde_json::Value,
    lobby: &Lobby,
) -> anyhow::Result<String> {
    let span = tracing::Span::current();
    span.record("has_rtp_codecs", rtp_parameters.get("codecs").is_some());
    span.record("has_rtp_encodings", rtp_parameters.get("encodings").is_some());
    span.record("has_rtp_header_extensions", rtp_parameters.get("headerExtensions").is_some());

    let room_state = lobby.get_room(&room_id)
        .ok_or_else(|| {
            span.record("error", "room_not_found");
            anyhow::anyhow!("Room not found")
        })?;

    let mut room_state_guard = room_state.write().await;

    span.record("has_dj_transport", room_state_guard.dj.as_ref().and_then(|dj| dj.transport.as_ref()).is_some());
    span.record("room_status_before", format!("{:?}", room_state_guard.status));
    span.record("room_was_public", room_state_guard.is_public());

    if let Some(dj) = &room_state_guard.dj {
        if let Some(dj_transport) = &dj.transport {
        // Create audio producer with span
        let producer_span = tracing::info_span!(
            "create_audio_producer",
            transport_id = %dj_transport.id(),
            room_id = %room_id
        );

        let producer_id = producer_span.in_scope(|| async {
            // Parse RTP parameters into MediaSoup format
            let rtp_params: mediasoup::prelude::RtpParameters = serde_json::from_value(rtp_parameters)?;
            
            // Use Room's abstract coordination method to create producer
            let result = room_state_guard.create_producer(rtp_params).await;
            
            result
        }).await?;

        // Producer is already stored and room marked as live by create_producer

        span.record("producer_id", &producer_id);
        span.record("room_is_public_now", room_state_guard.is_public());
        span.record("room_status_after", format!("{:?}", room_state_guard.status));
        room_state_guard.sync_streaming_state();
        span.record("room_is_streaming", room_state_guard.is_streaming());

        tracing::info!(
            producer_id = %producer_id,
            is_public = room_state_guard.is_public(),
            status = ?room_state_guard.status,
            "Audio producer created and room updated"
        );

        // Step 16: Broadcast room as available for listeners (room is now public)
        let is_now_public = room_state_guard.is_public();
        drop(room_state_guard); // Release lock before broadcast
        
        if is_now_public {
            lobby.update_room(&room_id).await;
            tracing::info!(
                room_id = %room_id,
                "Room published to lobby - listeners can now join"
            );
        }

        Ok(producer_id)
        } else {
            span.record("error", "no_dj_transport");
            Err(anyhow::anyhow!("No DJ transport found for room"))
        }
    } else {
        span.record("error", "no_dj");
        Err(anyhow::anyhow!("No DJ found for room"))
    }
}

/// Handle stop producing
async fn handle_stop_producing(
    room_id: Uuid,
    lobby: &Lobby,
) -> anyhow::Result<()> {
    let room_state = lobby.get_room(&room_id)
        .ok_or_else(|| anyhow::anyhow!("Room not found"))?;

    let mut room_state_guard = room_state.write().await;

    if let Some(dj) = &room_state_guard.dj {
        if let Some(producer) = &dj.producer {
            producer.pause().await?;
            room_state_guard.pause();
            room_state_guard.sync_streaming_state(); // Sync dj_streaming with producer state
            tracing::info!("Producer paused for room {}", room_id);

            // Broadcast pause event to all listeners in this room
        let pause_event = ListenerEvent::StreamPaused {
            room_id: room_id.to_string(),
        };
            room_state_guard.broadcast_to_listeners(pause_event);

            // Also broadcast room update to lobby
            let room = room_state_guard.clone();
            drop(room_state_guard); // Release lock before broadcasting
            // Broadcast room status change to lobby
            lobby.update_room(&room_id).await;
        }
    }

    Ok(())
}

/// Handle room deletion and cleanup
async fn handle_delete_room(
    room_id: Uuid,
    lobby: &Lobby,
) -> anyhow::Result<()> {
    let room_state = lobby.get_room(&room_id)
        .ok_or_else(|| anyhow::anyhow!("Room not found"))?;

    let mut room_state_guard = room_state.write().await;

    // Close producer and transport if exists
    if let Some(mut dj) = room_state_guard.dj.take() {
        if let Some(_producer) = dj.producer.take() {
            // Producer will be dropped automatically when going out of scope
        }
        if let Some(_transport) = dj.transport.take() {
            // Transport will be cleaned up when dropped
        }
    }

    room_state_guard.start_closing();

    tracing::info!("Room {} marked for deletion", room_id);
    Ok(())
}

/// Handle resume producing
async fn handle_resume_producing(
    room_id: Uuid,
    lobby: &Lobby,
) -> anyhow::Result<()> {
    let room_state = lobby.get_room(&room_id)
        .ok_or_else(|| anyhow::anyhow!("Room not found"))?;

    let mut room_state_guard = room_state.write().await;

    if let Some(dj) = &room_state_guard.dj {
        if let Some(producer) = &dj.producer {
            producer.resume().await?;
            room_state_guard.resume();
            room_state_guard.sync_streaming_state(); // Sync dj_streaming with producer state
            tracing::info!("Producer resumed for room {}", room_id);

            // Broadcast resume event to all listeners in this room
            let resume_event = ListenerEvent::StreamResumed {
                room_id: room_id.to_string(),
            };
            room_state_guard.broadcast_to_listeners(resume_event);

            // Also broadcast room update to lobby
            let room = room_state_guard.clone();
            drop(room_state_guard); // Release lock before broadcasting
            // Broadcast room status change to lobby
            lobby.update_room(&room_id).await;
        }
    }

    Ok(())
}

/// Handle get router capabilities request
#[tracing::instrument(skip(lobby), fields(room_id = %room_id))]
async fn handle_get_router_capabilities(
    room_id: Uuid,
    lobby: &Lobby,
) -> anyhow::Result<crate::lib::models::schemas::RtpCapabilitiesWrapper> {
    let room_state = lobby.get_room(&room_id)
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
#[tracing::instrument(skip(lobby, device_rtp_capabilities, event_tx), fields(room_id = %room_id, producer_exists = tracing::field::Empty, listener_count = tracing::field::Empty))]
async fn handle_request_join(
    room_id: Uuid,
    device_rtp_capabilities: serde_json::Value,
    listener_id: String,
    lobby: &Lobby,
    event_tx: tokio::sync::mpsc::UnboundedSender<ListenerEvent>,
) -> anyhow::Result<(crate::lib::models::events::RoomInfo, crate::lib::models::schemas::TransportOptions, String, crate::lib::models::schemas::RtpCapabilitiesWrapper)> {
    let span = tracing::Span::current();

    let room_state = lobby.get_room(&room_id)
        .ok_or_else(|| anyhow::anyhow!("Room not found"))?;

    let room_state_guard = room_state.write().await;
    let room = room_state_guard.clone();

    // We'll create the ListenerState after the transport is created (in the return section)
    tracing::info!(
        listener_id = %listener_id,
        "Processing join request with device RTP capabilities"
    );

    // REQUIRED: Validate that producer exists (rooms without producers should not exist)
    let producer_id = if let Some(dj) = &room_state_guard.dj {
        if let Some(producer) = &dj.producer {
            span.record("producer_exists", true);
            producer.id().to_string()
        } else {
            span.record("producer_exists", false);
            return Err(anyhow::anyhow!("No producer available in room - room without producer should not exist"));
        }
    } else {
        span.record("producer_exists", false);
        return Err(anyhow::anyhow!("No DJ available in room - room without DJ should not exist"));
    };

    // Use room's abstract coordination method for listener initialization (Step 2)
    let (listener, transport_options) = room_state_guard.add_listener_to_room(
        listener_id.clone(),
        device_rtp_capabilities,
        event_tx,
    ).await?;
    
    // Add the listener to the room's listener collection
    room_state_guard.add_listener(listener);

    // Get router RTP capabilities for device initialization
    let router_rtp_capabilities = room_state_guard.router.as_ref()
        .ok_or_else(|| anyhow::anyhow!("No router found for room"))?
        .rtp_capabilities();

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
#[tracing::instrument(skip(lobby, dtls_parameters), fields(room_id = %room_id, listener_id = %listener_id, client_transport_id = tracing::field::Empty, actual_transport_id = tracing::field::Empty))]
async fn handle_connect_listener_transport(
    room_id: Uuid,
    listener_id: String,
    client_transport_id: Option<String>,
    dtls_parameters: DtlsParameters,
    lobby: &Lobby,
) -> anyhow::Result<String> {
    let span = tracing::Span::current();
    tracing::debug!("DTLS parameters received for listener: {}", serde_json::to_string_pretty(&dtls_parameters).unwrap_or_else(|_| "Invalid JSON".to_string()));

    // Record client transport ID in span for debugging
    if let Some(ref client_id) = client_transport_id {
        span.record("client_transport_id", client_id);
    }

    let room_state = lobby.get_room(&room_id)
        .ok_or_else(|| anyhow::anyhow!("Room not found"))?;

    let room_state_guard = room_state.read().await;

    // Get existing ListenerState (created during requestJoin)
    let listener_state = room_state_guard.get_listener(&listener_id)
        .ok_or_else(|| anyhow::anyhow!("No ListenerState found for listener_id: {}", listener_id))?;

    let actual_transport_id = listener_state.transport.as_ref()
        .ok_or_else(|| anyhow::anyhow!("No transport found for listener"))?
        .id().to_string();
    span.record("actual_transport_id", &actual_transport_id);

    // CRITICAL: Validate that client transport ID matches actual transport ID
    if let Some(ref client_id) = client_transport_id {
        if client_id != &actual_transport_id {
            tracing::error!(
                client_transport_id = %client_id,
                actual_transport_id = %actual_transport_id,
                listener_id = %listener_id,
                "Listener transport ID mismatch! Client trying to connect wrong transport"
            );
            return Err(anyhow::anyhow!(
                "Listener transport ID mismatch: client sent '{}' but listener has '{}'", 
                client_id, actual_transport_id
            ));
        } else {
            tracing::info!(
                transport_id = %actual_transport_id,
                listener_id = %listener_id,
                "✅ Listener transport ID validation successful"
            );
        }
    } else {
        tracing::warn!(
            actual_transport_id = %actual_transport_id,
            listener_id = %listener_id,
            "Client did not provide listener transport ID - allowing connection but this should be fixed"
        );
    }

    // Connect the existing transport with provided DTLS parameters
    if let Some(transport) = &listener_state.transport {
        transport.connect(mediasoup::prelude::WebRtcTransportRemoteParameters {
            dtls_parameters
        }).await.map_err(|e| anyhow::anyhow!("Failed to connect listener transport: {}", e))?;
    } else {
        return Err(anyhow::anyhow!("No transport found for listener"));
    }

    tracing::info!(
        listener_id = %listener_id,
        transport_id = %actual_transport_id,
        room_id = %room_id,
        "Listener transport connected successfully"
    );

    // Transport connection is complete - consumer creation handled separately via requestConsumer
    Ok(actual_transport_id)
}

/// Handle specific listener leaving the room with proper domain cleanup
#[tracing::instrument(skip(lobby), fields(room_id = %room_id, listener_id = %listener_id))]
async fn handle_listener_leave(
    room_id: Uuid,
    listener_id: &str,
    lobby: &Lobby,
) -> anyhow::Result<()> {
    let room_state = lobby.get_room(&room_id)
        .ok_or_else(|| anyhow::anyhow!("Room not found"))?;

    let mut room_state_guard = room_state.write().await;

    // Use domain method to properly remove listener with MediaSoup cleanup
    room_state_guard.remove_listener(listener_id).await?;

    tracing::info!(
        room_id = %room_id,
        listener_id = %listener_id,
        new_listener_count = room_state_guard.listener_count,
        "Listener leave handled successfully using domain method"
    );

    Ok(())
}

/// Handle listener requesting consumer creation for room's current producer
#[tracing::instrument(skip(lobby, device_rtp_capabilities), fields(room_id = %room_id, session_id = %session_id, producer_id = tracing::field::Empty, consumer_id = tracing::field::Empty))]
async fn handle_request_consumer(
    room_id: Uuid,
    session_id: &str,
    device_rtp_capabilities: serde_json::Value,
    lobby: &Lobby,
) -> anyhow::Result<crate::lib::models::schemas::ConsumerParameters> {
    let span = tracing::Span::current();
    let listener_id = session_id;

    let room_state = lobby.get_room(&room_id)
        .ok_or_else(|| anyhow::anyhow!("Room not found"))?;

    let room_state_guard = room_state.write().await;

    // Get the producer (discover from room state)
    let producer = room_state_guard.dj.as_ref()
        .and_then(|dj| dj.producer.as_ref())
        .ok_or_else(|| anyhow::anyhow!("No audio producer found in room"))?;

    let producer_id = producer.id().to_string();
    span.record("producer_id", &producer_id);

    // Update listener's device RTP capabilities (Step 4 of reference flow)
    let update_success = room_state_guard.update_listener(&listener_id, |listener| {
        listener.device_rtp_capabilities = device_rtp_capabilities.clone();
    });

    if !update_success {
        return Err(anyhow::anyhow!("Listener state not found for ID: {}", listener_id));
    }

    tracing::info!(
        room_id = %room_id,
        listener_id = %listener_id,
        "Updated listener device RTP capabilities"
    );

    // Use Room's abstract coordination method to create consumer
    let consumer_params = room_state_guard.create_consumer_for_listener(&listener_id).await?;
    span.record("consumer_id", &consumer_params.id);

    // consumer_params is already a ConsumerParameters struct
    let consumer_parameters = consumer_params;

    tracing::info!(
        room_id = %room_id,
        listener_id = %listener_id,
        consumer_id = %consumer_parameters.id,
        producer_id = %consumer_parameters.producer_id,
        "Consumer created successfully for listener"
    );

    Ok(consumer_parameters)
}
