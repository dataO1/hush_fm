use utoipa::OpenApi;

use crate::lib::models::{Room, events::RoomInfo, schemas::{ConsumerParameters, TransportOptions, RtpCapabilitiesWrapper, IceCandidateSchema}};

#[derive(OpenApi)]
#[openapi(
    paths(
        crate::api::api::rooms::list_rooms,
    ),
    components(
        schemas(Room, RoomInfo, 
                ConsumerParameters, TransportOptions, RtpCapabilitiesWrapper, IceCandidateSchema)
    ),
    tags(
        (name = "rooms", description = "Room management API")
    ),
    info(
        title = "HushFM API",
        version = "0.1.0",
        description = "Live audio streaming platform API",
        license(name = "MIT", identifier = "MIT")
    ),
)]
pub struct ApiDoc;