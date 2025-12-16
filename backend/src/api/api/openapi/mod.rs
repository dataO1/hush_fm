use utoipa::OpenApi;

use crate::lib::models::{Room, events::RoomInfo, schemas::{RoomInfoResponse, ConsumerParameters, TransportOptions, RtpCapabilitiesWrapper, IceCandidateSchema}};

#[derive(OpenApi)]
#[openapi(
    paths(
        crate::api::api::rooms::list_rooms,
        crate::api::api::rooms::get_room_info,
    ),
    components(
        schemas(Room, RoomInfo, RoomInfoResponse, 
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