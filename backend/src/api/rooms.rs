use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use serde_json::json;
use uuid::Uuid;

use crate::{
    models::{CreateRoomRequest, CreateRoomResponse, JoinRoomResponse, Room, TransportOptions, RtpCapabilities, ConsumerParameters, events::RoomInfo},
    state::AppState,
    webrtc::{ConsumerManager, consumer::ConsumerState},
};

pub fn rooms_router() -> Router<AppState> {
    Router::new()
        .route("/rooms", post(create_room))
        .route("/rooms", get(list_rooms))
        .route("/rooms/:room_id/join", post(join_room))
}

/// Create a new room
#[utoipa::path(
    post,
    path = "/api/rooms",
    request_body = CreateRoomRequest,
    responses(
        (status = 201, description = "Room created successfully", body = CreateRoomResponse),
        (status = 500, description = "Internal server error")
    ),
    tag = "rooms"
)]
#[tracing::instrument(skip(state, request), fields(room_name = %request.name, dj_name = %request.dj_name))]
pub async fn create_room(
    State(state): State<AppState>,
    Json(request): Json<CreateRoomRequest>,
) -> Result<(StatusCode, Json<CreateRoomResponse>), StatusCode> {
    let room_id = Uuid::new_v4();
    let dj_id = format!("dj_{}", room_id);
    
    // Create mediasoup router
    let router = state.mediasoup.create_router().await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Create WebRTC transport for DJ
    let transport_manager = state.mediasoup.get_transport_manager();
    let (dj_transport, transport_options) = transport_manager
        .create_dj_transport(&router, room_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Create room entry
    let mut room = Room::new(room_id, request.name.clone(), dj_id.clone());
    room.description = request.description.clone();
    room.tags = request.tags.clone().unwrap_or_default();

    // Add to state using enhanced method and store WebRTC resources
    let room_clone = room.clone();
    let room_state = state.create_room_enhanced(room).await;
    
    // Get router RTP capabilities before storing
    let router_rtp_capabilities = serde_json::to_value(router.rtp_capabilities())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    // Store router and transport in room state
    {
        let mut room_state_guard = room_state.write().await;
        room_state_guard.set_router(std::sync::Arc::new(router));
        room_state_guard.set_dj_transport(dj_transport);
    }

    let response = CreateRoomResponse {
        room: room_clone.into(), // Convert Room to RoomInfo
        dj_token: dj_id, // Simplified token for now
        transport_options: convert_transport_options(transport_options),
        rtp_capabilities: convert_rtp_capabilities(router_rtp_capabilities),
        ws_url: format!("ws://localhost:3000/ws/room/{}", room_id),
    };

    Ok((StatusCode::CREATED, Json(response)))
}

/// List all rooms
#[utoipa::path(
    get,
    path = "/api/rooms",
    responses(
        (status = 200, description = "List of rooms", body = Vec<RoomInfo>),
    ),
    tag = "rooms"
)]
#[tracing::instrument(skip(state))]
pub async fn list_rooms(State(state): State<AppState>) -> Json<Vec<RoomInfo>> {
    let rooms = state.get_rooms().await;
    
    tracing::info!(
        total_public_rooms = rooms.len(),
        "Fetched public rooms for API response"
    );
    
    for room in &rooms {
        tracing::debug!(
            room_id = %room.id,
            room_name = %room.name,
            dj_streaming = room.dj_streaming,
            listener_count = room.listener_count,
            "Public room details"
        );
    }
    
    let room_infos: Vec<RoomInfo> = rooms.into_iter().map(|room| room.into()).collect();
    Json(room_infos)
}

/// Join a room as listener
#[utoipa::path(
    post,
    path = "/api/rooms/{room_id}/join",
    params(
        ("room_id" = Uuid, Path, description = "Room ID")
    ),
    responses(
        (status = 200, description = "Joined room successfully", body = JoinRoomResponse),
        (status = 404, description = "Room not found")
    ),
    tag = "rooms"
)]
#[tracing::instrument(skip(state), fields(room_id = %room_id))]
pub async fn join_room(
    Path(room_id): Path<Uuid>,
    State(state): State<AppState>,
) -> Result<Json<JoinRoomResponse>, StatusCode> {
    let room_state = state.get_room_state(&room_id)
        .ok_or(StatusCode::NOT_FOUND)?;
    
    let listener_id = format!("listener_{}", Uuid::new_v4());
    
    // Create consumer transport and consumer for this listener
    let (transport_options, producer_id, room, consumer_parameters) = {
        let room_state_guard = room_state.read().await;
        let room = room_state_guard.room.clone();
        
        if let Some(router) = &room_state_guard.router {
            let transport_manager = state.mediasoup.get_transport_manager();
            let (listener_transport, transport_options) = transport_manager
                .create_listener_transport(router, room_id, &listener_id)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            // Store the listener transport in room state
            room_state_guard.add_listener_transport(listener_id.clone(), listener_transport.clone());
                
            let (producer_id, consumer_parameters) = if room.dj_streaming {
                if let Some(producer) = &room_state_guard.audio_producer {
                    // Get client RTP capabilities for creating consumer
                    let client_capabilities = json!(ConsumerManager::get_consumer_audio_capabilities());
                    
                    // Create consumer on the backend
                    match ConsumerManager::create_audio_consumer(
                        &listener_transport,
                        producer,
                        room_id,
                        &listener_id,
                        client_capabilities.clone()
                    ).await {
                        Ok((consumer, consumer_id, consumer_params)) => {
                            // Store consumer in room state
                            let consumer_state = ConsumerState::new(
                                consumer,
                                consumer_id.clone(),
                                room_id,
                                listener_id.clone(),
                                producer.id().to_string()
                            );
                            room_state_guard.add_consumer(listener_id.clone(), consumer_state);
                            
                            // Convert to our schema type
                            let consumer_parameters = ConsumerParameters {
                                id: consumer_id,
                                producer_id: producer.id().to_string(),
                                kind: "audio".to_string(),
                                rtp_parameters: consumer_params,
                                r#type: "simple".to_string(),
                                producer_paused: false,
                            };
                            
                            (Some(producer.id().to_string()), Some(consumer_parameters))
                        },
                        Err(e) => {
                            tracing::error!("Failed to create consumer: {}", e);
                            (Some(producer.id().to_string()), None)
                        }
                    }
                } else {
                    (None, None)
                }
            } else {
                (None, None)
            };
            
            (transport_options, producer_id, room, consumer_parameters)
        } else {
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };
    
    // Get RTP capabilities for client
    let rtp_capabilities = json!(ConsumerManager::get_consumer_audio_capabilities());

    let response = JoinRoomResponse {
        room: room.into(), // Convert Room to RoomInfo
        transport_options: convert_transport_options(transport_options),
        producer_id,
        rtp_capabilities: convert_rtp_capabilities(rtp_capabilities),
        consumer_parameters,
    };

    Ok(Json(response))
}

/// Convert WebRTC transport options to our unified type
fn convert_transport_options(options: serde_json::Value) -> TransportOptions {
    // For now, we'll extract the basic fields and use the raw value for complex ones
    TransportOptions {
        id: options.get("id").and_then(|v| v.as_str()).unwrap_or("unknown").to_string(),
        ice_parameters: options.get("iceParameters").cloned().unwrap_or_default(),
        ice_candidates: vec![], // Empty for local network optimization
        dtls_parameters: options.get("dtlsParameters").cloned().unwrap_or_default(),
        sctp_parameters: options.get("sctpParameters").cloned(),
    }
}

/// Convert RTP capabilities to our unified type
fn convert_rtp_capabilities(capabilities: serde_json::Value) -> RtpCapabilities {
    RtpCapabilities {
        codecs: capabilities.get("codecs").and_then(|v| v.as_array()).cloned().unwrap_or_default(),
        header_extensions: capabilities.get("headerExtensions").and_then(|v| v.as_array()).cloned().unwrap_or_default(),
        fec_mechanisms: capabilities.get("fecMechanisms").and_then(|v| v.as_array()).cloned().unwrap_or_default(),
    }
}