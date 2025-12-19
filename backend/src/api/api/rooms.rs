use axum::{
    extract::State,
    response::Json,
    routing::get,
    Router,
};

use crate::{
    lib::{models::events::RoomInfo, domain::Lobby},
};

pub fn rooms_router() -> Router<Lobby> {
    Router::new()
        .route("/rooms", get(list_rooms))
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
#[tracing::instrument(skip(lobby))]
pub async fn list_rooms(State(lobby): State<Lobby>) -> Json<Vec<RoomInfo>> {
    let rooms = lobby.get_public_rooms().await;

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




