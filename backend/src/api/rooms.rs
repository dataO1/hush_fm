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
    models::{CreateRoomRequest, CreateRoomResponse, JoinRoomResponse, Room},
    state::AppState,
    webrtc::ConsumerManager,
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
    let room = Room {
        id: room_id,
        name: request.name,
        dj_id: dj_id.clone(),
        dj_streaming: false,
        listener_count: 0,
    };

    // Add to state using enhanced method and store WebRTC resources
    let room_state = state.create_room_enhanced(room).await;
    
    // Store router and transport in room state
    {
        let mut room_state_guard = room_state.write().await;
        room_state_guard.set_router(std::sync::Arc::new(router));
        room_state_guard.set_dj_transport(dj_transport);
    }

    let response = CreateRoomResponse {
        room_id,
        dj_token: dj_id, // Simplified token for now
        transport_options,
        ws_url: format!("ws://localhost:3000/ws/room/{}", room_id),
    };

    Ok((StatusCode::CREATED, Json(response)))
}

/// List all rooms
#[utoipa::path(
    get,
    path = "/api/rooms",
    responses(
        (status = 200, description = "List of rooms", body = Vec<Room>),
    ),
    tag = "rooms"
)]
pub async fn list_rooms(State(state): State<AppState>) -> Json<Vec<Room>> {
    Json(state.get_rooms().await)
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
pub async fn join_room(
    Path(room_id): Path<Uuid>,
    State(state): State<AppState>,
) -> Result<Json<JoinRoomResponse>, StatusCode> {
    let room_state = state.get_room_state(&room_id)
        .ok_or(StatusCode::NOT_FOUND)?;
    
    let listener_id = format!("listener_{}", Uuid::new_v4());
    
    // Create consumer transport for this listener
    let (transport_options, producer_id) = {
        let room_state_guard = room_state.read().await;
        let room = room_state_guard.room.clone();
        
        if let Some(router) = &room_state_guard.router {
            let transport_manager = state.mediasoup.get_transport_manager();
            let (_, transport_options) = transport_manager
                .create_listener_transport(router, room_id, &listener_id)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                
            let producer_id = if room.dj_streaming {
                room_state_guard.audio_producer
                    .as_ref()
                    .map(|p| p.id().to_string())
            } else {
                None
            };
            
            (transport_options, producer_id)
        } else {
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };
    
    // Get RTP capabilities for client
    let rtp_capabilities = json!(ConsumerManager::get_consumer_audio_capabilities());

    let response = JoinRoomResponse {
        transport_options,
        producer_id,
        rtp_capabilities,
    };

    Ok(Json(response))
}