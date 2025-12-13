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
use tokio::signal;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

mod api;
mod models;
mod state;
mod telemetry;
mod webrtc;
mod ws;
mod openapi;

use api::rooms::rooms_router;
use openapi::ApiDoc;
use state::AppState;
use ws::{ws_handler, listener_handler};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing with OpenTelemetry
    let log_level = std::env::var("RUST_LOG")
        .unwrap_or_else(|_| "info".to_string());
    
    telemetry::init_tracing_with_level(&log_level)?;

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
        .merge(SwaggerUi::new("/swagger-ui").url("/api-docs/openapi.json", ApiDoc::openapi()));

    let stateful_routes = Router::new()
        .route("/ws/room/:room_id", get(ws_handler))
        .route("/ws/listen/:room_id", get(listener_handler))
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
    
    // Setup graceful shutdown
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    // Shutdown telemetry
    telemetry::shutdown_tracer();
    tracing::info!("🎵 HushFM Backend shutdown complete");

    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("Shutdown signal received, starting graceful shutdown");
}
