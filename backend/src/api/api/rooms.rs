use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::get,
    Router,
};
use mediasoup::prelude::Transport;
use mediasoup_types::data_structures::DtlsRole;
use uuid::Uuid;

use crate::{
    lib::{models::{events::RoomInfo, schemas::{RoomInfoResponse}}, domain::Lobby},
};

pub fn rooms_router() -> Router<Lobby> {
    Router::new()
        .route("/rooms", get(list_rooms))
        .route("/rooms/:room_id", get(get_room_info))
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
    State(lobby): State<Lobby>,
) -> Result<Json<RoomInfoResponse>, StatusCode> {
    let room_state = lobby.get_room(&room_id)
        .ok_or(StatusCode::NOT_FOUND)?;

    let room_state_guard = room_state.read().await;
    let room = room_state_guard.clone();
    
    // Get router RTP capabilities for device initialization
    let router_rtp_capabilities = room_state_guard.router.as_ref()
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?
        .rtp_capabilities();

    // Generate transport options from actual MediaSoup transport
    if let Some(dj_state) = &room_state_guard.dj {
        if let Some(dj_transport) = &dj_state.transport {
            // Generate transport options with real MediaSoup parameters
            let ice_params = dj_transport.ice_parameters();
            let dtls_params = dj_transport.dtls_parameters();
            let ice_candidates = dj_transport.ice_candidates();
            
            let transport_options = crate::lib::models::schemas::TransportOptions {
                id: dj_transport.id().to_string(),
                ice_parameters: crate::lib::models::schemas::IceParametersWrapper {
                    ice_lite: ice_params.ice_lite,
                    password: ice_params.password.clone(),
                    username_fragment: ice_params.username_fragment.clone(),
                },
                ice_candidates: ice_candidates.into_iter().map(|candidate| {
                    crate::lib::models::schemas::IceCandidateSchema {
                        foundation: candidate.foundation.clone(),
                        priority: candidate.priority,
                        address: candidate.address.to_string(),
                        protocol: match candidate.protocol {
                            mediasoup::prelude::Protocol::Udp => crate::lib::models::schemas::ProtocolSchema::Udp,
                            mediasoup::prelude::Protocol::Tcp => crate::lib::models::schemas::ProtocolSchema::Tcp,
                        },
                        port: candidate.port,
                        candidate_type: crate::lib::models::schemas::IceCandidateTypeSchema::Host,
                        tcp_type: candidate.tcp_type.map(|_| crate::lib::models::schemas::IceCandidateTcpTypeSchema::Passive),
                    }
                }).collect(),
                dtls_parameters: crate::lib::models::schemas::DtlsParametersWrapper {
                    role: match dtls_params.role {
                        DtlsRole::Auto => "auto".to_string(),
                        DtlsRole::Client => "client".to_string(),
                        DtlsRole::Server => "server".to_string(),
                    },
                    fingerprints: dtls_params.fingerprints.into_iter()
                        .map(|fp| fp.into())
                        .collect(),
                },
                sctp_parameters: None,
            };
            
            let response = RoomInfoResponse {
                room: room.into(),
                rtp_capabilities: router_rtp_capabilities.into(),
                producer_id: Some(dj_transport.id().to_string()),
                transport_options,
            };
            
            return Ok(Json(response));
        }
    }
    
    // No DJ or transport ready
    Err(StatusCode::NOT_FOUND)
}



