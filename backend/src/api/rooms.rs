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

    // TODO: Create WebRTC transport for DJ
    let transport_options = json!({
        "id": "transport_id",
        "iceParameters": {},
        "iceCandidates": [],
        "dtlsParameters": {}
    });

    // Create room entry
    let room = Room {
        id: room_id,
        name: request.name,
        dj_id: dj_id.clone(),
        dj_streaming: false,
        listener_count: 0,
    };

    // Add to state
    state.add_room(room);

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
    Json(state.get_rooms())
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
    let room = state.rooms.get(&room_id)
        .ok_or(StatusCode::NOT_FOUND)?;

    // TODO: Create consumer transport and consumer
    let transport_options = json!({
        "id": "consumer_transport_id",
        "iceParameters": {},
        "iceCandidates": [],
        "dtlsParameters": {}
    });

    let producer_id = if room.dj_streaming {
        Some("producer_id".to_string())
    } else {
        None
    };

    let response = JoinRoomResponse {
        transport_options,
        producer_id,
    };

    Ok(Json(response))
}