use utoipa::OpenApi;

use crate::models::{Room, CreateRoomRequest, CreateRoomResponse, JoinRoomResponse, events::RoomInfo, schemas::{RoomInfoResponse, JoinRoomRequest, ConsumerParameters, TransportOptions, RtpCapabilitiesWrapper, IceCandidateSchema}};

#[derive(OpenApi)]
#[openapi(
    paths(
        crate::api::rooms::create_room,
        crate::api::rooms::list_rooms,
        crate::api::rooms::get_room_info,
        crate::api::rooms::join_room,
    ),
    components(
        schemas(Room, RoomInfo, CreateRoomRequest, CreateRoomResponse, JoinRoomResponse, RoomInfoResponse, JoinRoomRequest, 
                ConsumerParameters, TransportOptions, RtpCapabilitiesWrapper, IceCandidateSchema)
    ),
    tags(
        (name = "rooms", description = "Room management API")
    ),
    info(
        title = "HushFM API",
        version = "0.1.0",
        description = "Live audio streaming platform API"
    ),
)]
pub struct ApiDoc;