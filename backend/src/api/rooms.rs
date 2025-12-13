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
    models::{CreateRoomRequest, CreateRoomResponse, Room, events::RoomInfo, schemas::{RoomInfoResponse}},
    state::AppState,
};

pub fn rooms_router() -> Router<AppState> {
    Router::new()
        .route("/rooms", post(create_room))
        .route("/rooms", get(list_rooms))
        .route("/rooms/:room_id", get(get_room_info))
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
    
    // Get router RTP capabilities as native type
    let router_rtp_capabilities = router.rtp_capabilities();
    
    // Store router and transport in room state
    {
        let mut room_state_guard = room_state.write().await;
        room_state_guard.set_router(std::sync::Arc::new(router));
        room_state_guard.set_dj_transport(dj_transport);
    }

    let response = CreateRoomResponse {
        room: room_clone.into(), // Convert Room to RoomInfo
        dj_token: dj_id, // Simplified token for now
        transport_options: convert_transport_options_to_wrapper(transport_options),
        rtp_capabilities: router_rtp_capabilities.into(),
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

/// Get room information and router RTP capabilities (for device initialization)
#[utoipa::path(
    get,
    path = "/api/rooms/{room_id}",
    params(
        ("room_id" = Uuid, Path, description = "Room ID")
    ),
    responses(
        (status = 200, description = "Room info retrieved successfully", body = RoomInfoResponse),
        (status = 404, description = "Room not found")
    ),
    tag = "rooms"
)]
pub async fn get_room_info(
    Path(room_id): Path<Uuid>,
    State(state): State<AppState>,
) -> Result<Json<RoomInfoResponse>, StatusCode> {
    let room_state = state.get_room_state(&room_id)
        .ok_or(StatusCode::NOT_FOUND)?;

    let room_state_guard = room_state.read().await;
    let room = room_state_guard.room.clone();
    
    // Get router RTP capabilities for device initialization
    let router_rtp_capabilities = room_state_guard.router.as_ref()
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?
        .rtp_capabilities();

    // Create template transport options for listener (no actual transport created)
    let template_transport_options = serde_json::json!({
        "id": "template",
        "iceParameters": {
            "usernameFragment": "template",
            "password": "template_password",
            "iceLite": false
        },
        "iceCandidates": [], // Empty for local network
        "dtlsParameters": {
            "role": "server",
            "fingerprints": []
        },
        "sctpParameters": null
    });

    let response = RoomInfoResponse {
        room: room.into(),
        rtp_capabilities: router_rtp_capabilities.into(),
        producer_id: room_state_guard.audio_producer.as_ref().map(|p| p.id().to_string()),
        transport_options: convert_transport_options_to_wrapper(template_transport_options),
    };

    Ok(Json(response))
}

/// Convert MediaSoup transport options JSON to our wrapper types
/// 
/// This function converts the raw JSON transport options from MediaSoup
/// to our properly typed wrapper structs for API responses.
fn convert_transport_options_to_wrapper(options: serde_json::Value) -> crate::models::schemas::TransportOptions {
    use crate::models::schemas::TransportOptions;
    TransportOptions {
        id: options.get("id").and_then(|v| v.as_str()).unwrap_or("unknown").to_string(),
        ice_parameters: serde_json::from_value(options.get("iceParameters").cloned().unwrap_or_default()).unwrap(),
        ice_candidates: vec![], // Empty for local network optimization  
        dtls_parameters: serde_json::from_value(options.get("dtlsParameters").cloned().unwrap_or_default()).unwrap(),
        sctp_parameters: options.get("sctpParameters").cloned(),
    }
}


