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
use std::time::Duration;
use tokio::time::{interval, MissedTickBehavior};

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
    Path((room_id, session_id)): Path<(String, String)>,
    State(lobby): State<Lobby>,
) -> Response {
    ws.on_upgrade(move |socket| handle_listener_socket(socket, room_id, session_id, lobby))
}

/// Server heartbeat cadence. Short enough that WS_PONG_TIMEOUT detects a
/// vanished (half-open) client in ~30-40s rather than the ~15min the OS TCP
/// retransmit tail would otherwise take.
const WS_PING_INTERVAL: Duration = Duration::from_secs(10);

/// If no pong (nor any inbound frame) arrives within this window, the peer is
/// treated as gone and the loop breaks. A phone that locks / leaves range /
/// crashes sends no Close frame, so absence-of-pong is the only timely signal;
/// breaking the loop is what arms the listener disconnect-cleanup (reap) timer.
/// A briefly-backgrounded phone that trips this simply reconnects (the frontend
/// re-join machinery handles it), so the only cost of an aggressive value is a
/// transient reconnect, not lost audio.
const WS_PONG_TIMEOUT: Duration = Duration::from_secs(30);

/// Backpressure bound on outbound WS sends. `sender.send(...).await` blocks
/// while the OS send buffer is full; a client that stopped reading (locked
/// phone, dead radio) would otherwise wedge the whole task for the ~15min TCP
/// retransmit tail — during which the loop can neither ping nor detect the
/// missing pongs. If a send doesn't complete within this bound the peer is
/// treated as dead and the loop breaks (arming the listener reaper / the DJ
/// disconnect handling, respectively).
const WS_SEND_TIMEOUT: Duration = Duration::from_secs(10);

/// Send a frame with the backpressure bound applied. Returns false when the
/// connection should be considered dead (send error OR timeout). On timeout
/// the in-flight send future is dropped, which can leave the sink mid-frame —
/// callers MUST break the loop and stop using the sink afterwards.
async fn send_ws(
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    msg: Message,
) -> bool {
    match tokio::time::timeout(WS_SEND_TIMEOUT, sender.send(msg)).await {
        Ok(Ok(())) => true,
        Ok(Err(_)) => false,
        Err(_) => {
            tracing::debug!("WebSocket send timed out (client not reading) - treating connection as dead");
            false
        }
    }
}

async fn handle_room_socket(socket: WebSocket, room_id: Uuid, lobby: Lobby) {
    let (mut sender, mut receiver) = socket.split();

    // Register this socket as the DJ's live control connection: bump the DJ
    // connection epoch (invalidates any disconnect-grace timer / stale exit
    // path from an older socket) and learn whether a previous disconnect
    // paused the stream so we can resume it now. Owned Arc from get_room; the
    // room write guard is dropped before any further awaits.
    let (connection_epoch, resume_after_reconnect) = match lobby.get_room(&room_id) {
        Some(room_state) => {
            let mut room_guard = room_state.write().await;
            room_guard.handle_dj_connection().unwrap_or((0, false))
        }
        // Room unknown (e.g. bad URL): keep legacy behavior — the command
        // handlers below answer RoomNotFound; nothing to clean up on exit.
        None => (0, false),
    };

    if resume_after_reconnect {
        tracing::info!(
            room_id = %room_id,
            "DJ reconnected within disconnect grace - resuming stream"
        );
        if let Err(e) = handle_resume_producing(room_id, &lobby).await {
            tracing::warn!(
                room_id = %room_id,
                error = %e,
                "Failed to auto-resume stream after DJ reconnection"
            );
        }
    }

    // Heartbeat: ping every WS_PING_INTERVAL; if no pong arrives for
    // WS_PONG_TIMEOUT the peer is treated as gone (see the tick arm below).
    let mut heartbeat_interval = interval(WS_PING_INTERVAL);
    heartbeat_interval.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let mut last_pong = std::time::Instant::now();

    let lobby_clone = lobby.clone();
    
    tracing::debug!(room_id = %room_id, "DJ WebSocket connection established with heartbeat");

    loop {
        tokio::select! {
            // Send heartbeat ping every 25 seconds
            _ = heartbeat_interval.tick() => {
                // Pong deadline: a half-open client sends no Close/error, so the
                // absence of pongs is the only timely liveness signal.
                if last_pong.elapsed() > WS_PONG_TIMEOUT {
                    tracing::debug!(room_id = %room_id, "DJ WebSocket: no pong within WS_PONG_TIMEOUT, treating connection as dead");
                    break;
                }
                if !send_ws(&mut sender, Message::Ping(vec![].into())).await {
                    tracing::debug!(room_id = %room_id, "DJ WebSocket heartbeat failed, connection dropped");
                    break;
                }
                tracing::trace!(room_id = %room_id, "DJ WebSocket heartbeat ping sent");
            }
            
            // Handle incoming messages
            msg = receiver.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        last_pong = std::time::Instant::now(); // any inbound frame proves liveness
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
                    Some(Ok(Message::Close(_))) | None => {
                        tracing::debug!(room_id = %room_id, "DJ WebSocket connection closed gracefully");
                        break;
                    }
                    Some(Ok(Message::Pong(_))) => {
                        last_pong = std::time::Instant::now();
                        tracing::trace!(room_id = %room_id, "DJ WebSocket pong received");
                    }
                    Some(Err(e)) => {
                        tracing::error!(room_id = %room_id, error = %e, "DJ WebSocket error");
                        break;
                    }
                    _ => {
                        // Ignore other message types
                    }
                }
            }
        }
    }
    
    tracing::debug!(room_id = %room_id, "DJ WebSocket handler exiting");

    // X7 (pause-then-close): the loop broke. If the room still exists this was
    // a DISCONNECT — an explicit DjCommand::CloseRoom removes the room from the
    // lobby before the socket closes, so get_room returns None for that path
    // (and for a grace-expiry close racing an old half-open socket). Pause the
    // stream, notify listeners, and arm the configurable disconnect-grace
    // timer; handle_dj_disconnect's epoch guard makes this a no-op if a newer
    // DJ socket has already taken over.
    if let Some(room_state) = lobby.get_room(&room_id) {
        let grace = crate::lib::config::Config::global().dj_disconnect_timeout();
        let pause_result = {
            let mut room_guard = room_state.write().await;
            room_guard
                .handle_dj_disconnect(lobby.clone(), connection_epoch, grace)
                .await
            // write guard dropped here, before the lobby broadcast below
        };
        match pause_result {
            Ok(true) => {
                // Stream was paused by the disconnect: broadcast the room
                // update so lobby clients see it flip to "paused".
                lobby.update_room(&room_id).await;
                tracing::info!(
                    room_id = %room_id,
                    grace_seconds = grace.as_secs(),
                    "DJ disconnected - stream paused, disconnect-grace timer armed"
                );
            }
            Ok(false) => {
                tracing::debug!(
                    room_id = %room_id,
                    "DJ socket closed without an active stream to pause (stale socket, setup room, or already paused)"
                );
            }
            Err(e) => {
                tracing::error!(
                    room_id = %room_id,
                    error = %e,
                    "Failed to handle DJ disconnect cleanup"
                );
            }
        }
    }
}

async fn handle_lobby_socket(socket: WebSocket, lobby: Lobby) {
    let (mut sender, mut receiver) = socket.split();

    // Heartbeat: ping every WS_PING_INTERVAL; if no pong arrives for
    // WS_PONG_TIMEOUT the peer is treated as gone (see the tick arm below).
    let mut heartbeat_interval = interval(WS_PING_INTERVAL);
    heartbeat_interval.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let mut last_pong = std::time::Instant::now();

    tracing::debug!("Lobby WebSocket connection established with heartbeat");

    // Send initial room list (bounded: a client that connects but never reads
    // must not wedge this task before the loop's heartbeat can catch it)
    let rooms = lobby.get_public_rooms().await;
    if !rooms.is_empty() {
        if let Ok(msg) = serde_json::to_string(&LobbyEvent::RoomAdded {
            room: rooms.first().unwrap().clone().into(),
        }) {
            if !send_ws(&mut sender, Message::Text(msg)).await {
                tracing::debug!("Lobby WebSocket initial room-list send failed, connection dropped");
                return;
            }
        }
    }

    // Handle incoming commands and broadcast messages concurrently
    let lobby_clone = lobby.clone();
    let mut rx = lobby.subscribe_lobby_events();

    loop {
        tokio::select! {
            // Send heartbeat ping every 25 seconds
            _ = heartbeat_interval.tick() => {
                // Pong deadline (see WS_PONG_TIMEOUT): break on a vanished peer.
                if last_pong.elapsed() > WS_PONG_TIMEOUT {
                    tracing::debug!("Lobby WebSocket: no pong within WS_PONG_TIMEOUT, treating connection as dead");
                    break;
                }
                if !send_ws(&mut sender, Message::Ping(vec![].into())).await {
                    tracing::debug!("Lobby WebSocket heartbeat failed, connection dropped");
                    break;
                }
                tracing::trace!("Lobby WebSocket heartbeat ping sent");
            }
            
            // Handle incoming commands
            msg = receiver.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        last_pong = std::time::Instant::now(); // any inbound frame proves liveness
                        if let Ok(lobby_cmd) = serde_json::from_str::<LobbyCommand>(&text) {
                            tracing::debug!("Received lobby command: {:?}", lobby_cmd.command_type());
                            if let Err(e) = handle_lobby_command(lobby_cmd, &lobby_clone, &mut sender).await {
                                tracing::error!("Failed to handle lobby command: {}", e);
                            }
                        }
                    },
                    Some(Ok(Message::Close(_))) => {
                        tracing::debug!("Lobby WebSocket connection closed gracefully");
                        break;
                    }
                    Some(Ok(Message::Pong(_))) => {
                        last_pong = std::time::Instant::now();
                        tracing::trace!("Lobby WebSocket pong received");
                    }
                    Some(Err(e)) => {
                        tracing::error!(error = %e, "Lobby WebSocket error");
                        break;
                    }
                    None => break,
                    _ => {},
                }
            },
            // Handle broadcast messages
            broadcast_msg = rx.recv() => {
                match broadcast_msg {
                    Ok(broadcast_msg) => {
                        if let Ok(msg) = serde_json::to_string(&broadcast_msg) {
                            // Bounded send: a lobby client that stopped reading
                            // must not wedge this task on a full send buffer.
                            if !send_ws(&mut sender, Message::Text(msg)).await {
                                break;
                            }
                        }
                    },
                    Err(_) => break,
                }
            }
        }
    }
    
    tracing::debug!("Lobby WebSocket handler exiting");
}

async fn handle_lobby_command(
    cmd: LobbyCommand,
    lobby: &Lobby,
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
) -> anyhow::Result<()> {
    // Extract trace context from the message and set up parent span

    match cmd {
        // Step 1 of DJ flow: Announce room creation in lobby
        LobbyCommand::AnnounceRoom { name, dj_name, session_id, description, tags } => {
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

            // Check if DJ already has an existing room
            let room_state = if let Some(existing_room) = lobby.find_room_by_dj_session_id(&session_id).await {
                // Read the id AND the public/producer status, then drop the read
                // guard BEFORE any await that takes a write lock (close_room takes
                // its own write lock via the lobby). Never hold a room guard across
                // close_room() — this repo has had guard-across-await footguns.
                let (existing_room_id, existing_is_public) = {
                    let existing_room_guard = existing_room.read().await;
                    (existing_room_guard.id, existing_room_guard.is_public())
                };
                dj_flow_span.record("room.id", existing_room_id.to_string());

                if existing_is_public {
                    // GENUINE RECONNECT: the found room is public (is_public() is
                    // true for BOTH Live AND Paused — room.rs:64 — so a paused
                    // room in the DJ-disconnect grace window, with a present-but-
                    // paused producer and listeners still waiting, is treated as a
                    // reconnect here, NOT scrapped). Reuse it exactly as before:
                    // do NOT rename or scrap a room that has an audience under
                    // their feet. The client's reconnect path passes the room's
                    // existing name, so the fresh announce metadata is ignored on
                    // purpose.
                    tracing::info!(
                        room_id = %existing_room_id,
                        session_id = %session_id,
                        "Step 1: Found existing PUBLIC room for DJ session (live or paused-in-grace) - reusing existing room"
                    );
                    // NOTE (DJ reconnection): the disconnect-grace timer is NOT
                    // cancelled here on purpose. Cancellation + auto-resume happen
                    // in handle_room_socket when the DJ actually opens the room
                    // socket (handle_dj_connection bumps the epoch). Cancelling at
                    // announce time would leak the room forever if the DJ announces
                    // but never completes the room-socket connection.

                    existing_room
                } else {
                    // STALE HALF-SETUP ROOM: the found room is NOT public
                    // (Setup state — no producer, nobody listening, not in the
                    // lobby list). This is a DJ whose prior Go-Live half-finished
                    // (e.g. crashed mid-setup) and who is now re-announcing with a
                    // NEW name/description/tags. Unconditional recreate would be
                    // unsafe (it can't distinguish a harmless Setup room from a
                    // live room with listeners); keying on is_public() lets the
                    // SERVER independently protect the one-room invariant without
                    // trusting the UI. A no-producer room may also carry a
                    // stale/dead transport from the crashed session, so scrap it
                    // fully and recreate a clean slate with the freshly-typed
                    // metadata, rather than reusing it in place with the stale name.
                    tracing::info!(
                        room_id = %existing_room_id,
                        session_id = %session_id,
                        "Step 1: Found existing NON-public room for DJ session (abandoned half-setup) - scrapping and recreating with fresh metadata"
                    );

                    // Drop our local Arc to the stale room BEFORE close_room so the
                    // Room (and its Arc<Router>) actually drops once close_room()
                    // removes the lobby's map entry. mediasoup-rust closes the
                    // router (and any transports) on last-Arc-drop; holding this
                    // reference open would leak the router. The pooled workers are
                    // shared/never freed per-room, so the router is the resource to
                    // release here.
                    drop(existing_room);

                    // Full mediasoup/router cleanup + remove from map. close_room()
                    // skips the lobby broadcast because the room is not public.
                    lobby.close_room(&existing_room_id).await?;

                    // Fall through to the SAME creation path the no-existing-room
                    // branch uses, so the DJ gets a clean room carrying the
                    // name/description/tags they just typed.
                    let room_id = uuid::Uuid::new_v4();
                    dj_flow_span.record("room.id", room_id.to_string());

                    tracing::info!(
                        room_id = %room_id,
                        session_id = %session_id,
                        "Step 1: Recreating room with fresh MediaSoup worker after scrapping abandoned half-setup room"
                    );

                    let new_room = lobby.create_room(room_id, name.clone(), dj_name.clone(), session_id.clone(), description, tags).await?;

                    tracing::info!(
                        room_id = %room_id,
                        "Step 1: Room recreated successfully with fresh metadata, MediaSoup router and worker"
                    );

                    new_room
                }
            } else {
                // Create new room in setup state (not public yet)
                let room_id = uuid::Uuid::new_v4();
                dj_flow_span.record("room.id", room_id.to_string());

                tracing::info!(
                    room_id = %room_id,
                    session_id = %session_id,
                    "Step 1: No existing room found - creating new room with MediaSoup worker"
                );

                // Create room using lobby's worker pool
                let new_room = lobby.create_room(room_id, name.clone(), dj_name.clone(), session_id.clone(), description, tags).await?;

                tracing::info!(
                    room_id = %room_id,
                    "Step 1: Room created successfully with MediaSoup router and worker"
                );
                
                new_room
            };

            // Generate DJ WebSocket URL from the room state
            let room_guard = room_state.read().await;
            let actual_room_id = room_guard.id;
            let ws_url = format!("/ws/room/{}", actual_room_id);

            tracing::info!(
                room_id = %actual_room_id,
                ws_url = %ws_url,
                "Step 1: Generated DJ WebSocket URL for room connection"
            );

            // Send RoomAnnounced event with connection details
            let room_announced_event = DjEvent::RoomAnnounced {
                room: room_guard.clone().into(),
                ws_url: ws_url.clone(),
            };
            drop(room_guard);

            match serde_json::to_string(&room_announced_event) {
                Ok(msg) => {
                    match sender.send(Message::Text(msg)).await {
                        Ok(_) => {
                            dj_flow_span.record("flow.phase", "step1_completed");
                            tracing::info!(
                                room_id = %actual_room_id,
                                ws_url = %ws_url,
                                "Step 1: COMPLETED - RoomAnnounced event sent to frontend. Frontend should now connect to DJ WebSocket."
                            );
                        }
                        Err(e) => {
                            dj_flow_span.record("flow.phase", "failed");
                            tracing::error!(
                                room_id = %actual_room_id,
                                error = %e,
                                "Step 1: FAILED - Could not send RoomAnnounced event to frontend"
                            );
                        }
                    }
                }
                Err(e) => {
                    dj_flow_span.record("flow.phase", "failed");
                    tracing::error!(
                        room_id = %actual_room_id,
                        error = %e,
                        "Step 1: FAILED - Could not serialize RoomAnnounced event"
                    );
                }
            }

            tracing::info!(
                room_id = %actual_room_id,
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
                    let mut room_guard = room_state.write().await;
                    
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
                    let listener_websocket_url = format!("/ws/listener/{}/{}", room_id, session_id);

                    // Get room info for response
                    let room_info = room_guard.clone().into();
                    
                    // Broadcast room update to lobby with new listener count
                    drop(room_guard); // Release write lock before lobby call
                    lobby.update_room(&room_uuid).await;

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

async fn handle_listener_socket(socket: WebSocket, room_id_str: String, session_id: String, lobby: Lobby) {
    let (mut sender, mut receiver) = socket.split();

    // Parse room_id from path parameter
    let room_id = match Uuid::parse_str(&room_id_str) {
        Ok(id) => id,
        Err(_) => {
            tracing::error!(
                session_id = %session_id,
                room_id_str = %room_id_str,
                "Invalid room ID format in WebSocket path"
            );
            return;
        }
    };

    tracing::info!(
        session_id = %session_id,
        room_id = %room_id,
        "New listener WebSocket connection established"
    );

    // Check if room exists
    let room_state = match lobby.get_room(&room_id) {
        Some(room_state) => room_state,
        None => {
            tracing::error!(
                session_id = %session_id,
                room_id = %room_id,
                "Room not found - WebSocket connection rejected"
            );
            return;
        }
    };

    // Handle listener connection using domain logic (reconnection or fresh join).
    // Capture the connection epoch so a reap timer armed when this socket closes
    // can be invalidated by any later reconnection.
    let connection_epoch;
    let mut event_rx = {
        let (event_tx, event_rx) = tokio::sync::mpsc::unbounded_channel();

        // Use domain method to handle connection
        let room_guard = room_state.read().await;
        match room_guard.handle_listener_connection(&session_id, event_tx).await {
            Ok(epoch) => {
                connection_epoch = epoch;
                tracing::info!(
                    session_id = %session_id,
                    room_id = %room_id,
                    connection_epoch = epoch,
                    "Successfully handled listener (re)connection"
                );
            }
            Err(e) => {
                tracing::info!(
                    session_id = %session_id,
                    room_id = %room_id,
                    error = %e,
                    "Listener session not found - sending listenerNotFound frame then closing"
                );
                // Send a structured error frame so the client knows why the socket is closing.
                // We flush the Text frame first, then send Close so the frame is not lost when
                // the SplitSink is dropped.
                if let Ok(msg) = serde_json::to_string(&ListenerEvent::ListenerNotFound {
                    room_id: room_id.to_string(),
                }) {
                    sender.send(Message::Text(msg)).await.ok();
                }
                sender.send(Message::Close(None)).await.ok();
                return;
            }
        }
        
        event_rx
    };

    tracing::info!(
        session_id = %session_id,
        room_id = %room_id,
        "Listener WebSocket connection established - waiting for InitListener command"
    );

    // Heartbeat: ping every WS_PING_INTERVAL; if no pong arrives for
    // WS_PONG_TIMEOUT the peer is treated as gone (see the tick arm below).
    let mut heartbeat_interval = interval(WS_PING_INTERVAL);
    heartbeat_interval.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let mut last_pong = std::time::Instant::now();

    // Handle both incoming messages and outgoing events concurrently
    let lobby_clone = lobby.clone();

    tracing::debug!(
        session_id = %session_id,
        room_id = %room_id,
        "Listener WebSocket connection established with heartbeat"
    );

    loop {
        tokio::select! {
            // Send heartbeat ping every 25 seconds
            _ = heartbeat_interval.tick() => {
                // Pong deadline: a half-open listener (locked/crashed phone) sends
                // no Close/error; without this the loop never breaks and the
                // disconnect-cleanup (reap) timer below is never armed.
                if last_pong.elapsed() > WS_PONG_TIMEOUT {
                    tracing::debug!(
                        session_id = %session_id,
                        room_id = %room_id,
                        "Listener WebSocket: no pong within WS_PONG_TIMEOUT, treating connection as dead"
                    );
                    break;
                }
                if !send_ws(&mut sender, Message::Ping(vec![].into())).await {
                    tracing::debug!(
                        session_id = %session_id,
                        room_id = %room_id,
                        "Listener WebSocket heartbeat failed, connection dropped"
                    );
                    break;
                }
                tracing::trace!(
                    session_id = %session_id,
                    room_id = %room_id,
                    "Listener WebSocket heartbeat ping sent"
                );
            }
            
            // Handle incoming WebSocket messages
            msg = receiver.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        last_pong = std::time::Instant::now(); // any inbound frame proves liveness
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
                    }
                    Some(Ok(Message::Close(_))) => {
                        tracing::debug!(
                            session_id = %session_id,
                            room_id = %room_id,
                            "Listener WebSocket connection closed gracefully"
                        );
                        break;
                    }
                    Some(Ok(Message::Pong(_))) => {
                        last_pong = std::time::Instant::now();
                        tracing::trace!(
                            session_id = %session_id,
                            room_id = %room_id,
                            "Listener WebSocket pong received"
                        );
                    }
                    Some(Err(e)) => {
                        tracing::error!(
                            session_id = %session_id,
                            room_id = %room_id,
                            error = %e,
                            "Listener WebSocket error"
                        );
                        break;
                    }
                    None => {
                        tracing::debug!(
                            room_id = %room_id,
                            session_id = %session_id,
                            "Listener WebSocket connection closed by client"
                        );
                        break;
                    }
                    _ => {
                        // Ignore other message types
                    }
                }
            },
            // Handle outgoing events
            event = event_rx.recv() => {
                if let Some(event) = event {
                    // roomClosed is terminal: after delivering it we close the
                    // socket ourselves instead of relying on the event channel
                    // closing when the listener is removed from the room. This
                    // makes the kick-on-close immediate and unambiguous.
                    let is_terminal = matches!(event, ListenerEvent::RoomClosed { .. });
                    if let Ok(msg) = serde_json::to_string(&event) {
                        // Bounded send: a listener that stopped reading must not
                        // wedge this task (it would also block the terminal
                        // roomClosed delivery for the ~15min TCP tail).
                        if !send_ws(&mut sender, Message::Text(msg)).await {
                            tracing::debug!(
                                room_id = %room_id,
                                session_id = %session_id,
                                "Failed to send event to listener, connection likely closed"
                            );
                            break;
                        }
                    }
                    if is_terminal {
                        tracing::info!(
                            room_id = %room_id,
                            session_id = %session_id,
                            "Delivered terminal roomClosed to listener - closing socket"
                        );
                        // Flush a proper Close frame after the Text frame so the
                        // client sees a clean close instead of an abrupt drop.
                        send_ws(&mut sender, Message::Close(None)).await;
                        break;
                    }
                } else {
                    // Event channel closed
                    break;
                }
            }
        }
    }

    // Connection closed - start cleanup timer for abandoned listener detection
    tracing::info!(
        room_id = %room_id,
        session_id = %session_id,
        "Listener WebSocket connection closed, starting cleanup timer for abandoned detection"
    );
    
    // Start cleanup timer in case listener doesn't reconnect
    if let Some(room_state) = lobby.get_room(&room_id) {
        let room_guard = room_state.read().await;
        let listener_exists = room_guard.get_listener(&session_id).is_some();
        drop(room_guard);
        
        if listener_exists {
            // Use room's update method to start disconnect timer. The timer is
            // tagged with this connection's epoch; if the listener reconnects
            // (epoch bumped) before the grace elapses, the reap is skipped.
            let timeout = crate::lib::config::Config::global().stale_listener_timeout();
            let room_guard_for_update = room_state.read().await;
            room_guard_for_update.update_listener(&session_id, |listener| {
                listener.start_disconnect_cleanup_timer(room_id, session_id.clone(), lobby.clone(), timeout, connection_epoch);
            });
        }
    }
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
                    // Initialize DJ transport using proper domain method with lobby configuration
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
            // Use domain method for comprehensive room closure
            match lobby.close_room(&room_id).await {
                Ok(_) => {
                    let response = DjEvent::RoomClosed {
                        room_id: room_id.to_string(),
                        reason: "Closed by DJ".to_string(),
                    };
                    if let Ok(msg) = serde_json::to_string(&response) {
                        sender.send(Message::Text(msg)).await.ok();
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to close room {}: {}", room_id, e);
                    let response = DjEvent::CommandFailed {
                        command: "closeRoom".to_string(),
                        error: format!("Room closure failed: {}", e),
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

            // Fix (A): resolve ownership + clone the Arc<Consumer> out under the
            // guards, then DROP both the DashMap entry guard and the room
            // read-guard BEFORE the resume().await. No lock is held across the
            // await, so the reaper / a reconnect can touch this listener entry
            // concurrently without deadlocking.
            let consumer_to_resume = if let Some(room_state) = lobby.get_room(&room_id) {
                // Room uses DashMap for listeners, so we only need a room read
                // guard to reach the listeners map (keyed by session_id).
                let room_guard = room_state.read().await;
                let resolved = if let Some(listener_entry) = room_guard.listeners.get(&session_id) {
                    let listener_state = listener_entry.value();

                    // Verify this listener actually owns the requested consumer
                    if let Some(current_consumer_id) = &listener_state.consumer_id {
                        if current_consumer_id == &consumer_id {
                            if let Some(consumer) = &listener_state.consumer {
                                Some(consumer.clone())
                            } else {
                                error_msg = "Consumer object missing in listener state".to_string();
                                None
                            }
                        } else {
                            error_msg = format!("Listener owns different consumer: {:?}", current_consumer_id);
                            None
                        }
                    } else {
                        error_msg = "Listener has no active consumer".to_string();
                        None
                    }
                    // DashMap entry guard (`listener_entry`) dropped at end of this block
                } else {
                    error_msg = format!("Listener {} not found in room", session_id);
                    None
                };
                drop(room_guard); // Release room read-guard before the resume().await
                resolved
            } else {
                error_msg = "Room not found".to_string();
                None
            };

            if let Some(consumer) = consumer_to_resume {
                match consumer.resume().await {
                    Ok(_) => {
                        tracing::info!("Successfully resumed mediasoup consumer {}", consumer_id);
                        success = true;
                    }
                    Err(e) => {
                        error_msg = format!("Mediasoup error: {}", e);
                        tracing::error!("Failed to resume consumer {}: {}", consumer_id, e);
                    }
                }
            }

            // Fix (B): the client sends ResumeConsumer fire-and-forget and does
            // not need a success event. On FAILURE ONLY, signal the client so it
            // can recover (full re-join) instead of sitting silent on a paused
            // consumer. Best-effort send, matching the sibling handlers.
            if !success {
                let response = ListenerEvent::CommandFailed {
                    command: "resumeConsumer".to_string(),
                    error: format!("Failed to resume consumer {}: {}", consumer_id, error_msg),
                };
                if let Ok(msg) = serde_json::to_string(&response) {
                    sender.send(Message::Text(msg)).await.ok();
                }
            }
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
            // Use domain method for listener leaving
            if let Some(room_state) = lobby.get_room(&room_id) {
                let mut room_guard = room_state.write().await;
                match room_guard.handle_listener_leave(&session_id).await {
                    Ok(_) => {
                        tracing::info!(
                            room_id = %room_id,
                            listener_id = %session_id,
                            "Listener left room successfully"
                        );
                        
                        // Broadcast room update to lobby with new listener count
                        drop(room_guard); // Release write lock before lobby call
                        lobby.update_room(&room_id).await;
                        
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
            } else {
                let response = ListenerEvent::CommandFailed {
                    command: "leaveRoom".to_string(),
                    error: "Room not found".to_string(),
                };

                if let Ok(msg) = serde_json::to_string(&response) {
                    sender.send(Message::Text(msg)).await.ok();
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
        // Application-level heartbeat: reply with Pong immediately.
        // Does not affect the tokio::select! heartbeat ping/pong interval.
        ListenerCommand::Ping => {
            tracing::debug!(
                room_id = %room_id,
                session_id = %session_id,
                "Listener application-level ping received, sending pong"
            );
            if let Ok(msg) = serde_json::to_string(&ListenerEvent::Pong) {
                sender.send(Message::Text(msg)).await.ok();
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

    let mut room_state_guard = room_state.write().await;
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

    // Broadcast room update to lobby with new listener count
    drop(room_state_guard); // Release write lock before lobby call
    lobby.update_room(&room_id).await;

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
