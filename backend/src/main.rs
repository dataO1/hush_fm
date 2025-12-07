use axum::{
    extract::DefaultBodyLimit,
    http::{
        header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE},
        HeaderValue, Method,
    },
    routing::get,
    Router,
};
use std::net::SocketAddr;
use tower::ServiceBuilder;
use tower_http::{
    cors::CorsLayer,
    trace::TraceLayer,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

mod api;
mod asyncapi;
mod models;
mod state;
mod webrtc;
mod ws;
mod openapi;

use api::rooms::rooms_router;
use api::asyncapi::asyncapi_router;
use openapi::ApiDoc;
use state::AppState;
use ws::ws_handler;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "hushfm_backend=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Initialize application state
    let app_state = AppState::new().await?;

    // Setup CORS
    let cors = CorsLayer::new()
        .allow_origin("http://localhost:5173".parse::<HeaderValue>()?)
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_credentials(true)
        .allow_headers([AUTHORIZATION, ACCEPT, CONTENT_TYPE]);

    // Build application router  
    let stateless_routes = Router::new()
        .merge(SwaggerUi::new("/swagger-ui").url("/api-docs/openapi.json", ApiDoc::openapi()))
        .merge(asyncapi_router());
        
    let stateful_routes = Router::new()
        .route("/ws/room/:room_id", get(ws_handler))
        .route("/ws/lobby", get(ws::lobby_handler))
        .nest("/api", rooms_router())
        .with_state(app_state);
        
    let app = stateless_routes.merge(stateful_routes)
        .layer(
            ServiceBuilder::new()
                .layer(TraceLayer::new_for_http())
                .layer(cors)
                .layer(DefaultBodyLimit::disable()),
        );

    // Start server
    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    tracing::info!("🎵 HushFM Backend starting on http://{}", addr);
    
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}