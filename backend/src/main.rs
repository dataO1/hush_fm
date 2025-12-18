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
mod lib;
mod telemetry;

use api::api::rooms::rooms_router;
use api::api::openapi::ApiDoc;
use lib::domain::Lobby;
use api::ws::{ws_handler, listener_handler, lobby_handler};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Check for OpenAPI export flag
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 && args[1] == "--export-openapi" {
        let openapi = ApiDoc::openapi();
        let yaml = serde_yaml::to_string(&openapi)?;
        println!("{}", yaml);
        return Ok(());
    }

    // Read configuration from environment variables
    let backend_port = std::env::var("HUSHFM_BACKEND_PORT")
        .unwrap_or_else(|_| "3000".to_string())
        .parse::<u16>()
        .unwrap_or(3000);
    
    let host_name = std::env::var("HUSHFM_HOST_NAME")
        .unwrap_or_else(|_| "localhost".to_string());
    
    let worker_port_min = std::env::var("HUSHFM_WORKER_PORT_MIN")
        .unwrap_or_else(|_| "40000".to_string())
        .parse::<u16>()
        .unwrap_or(40000);
    
    let worker_port_max = std::env::var("HUSHFM_WORKER_PORT_MAX")
        .unwrap_or_else(|_| "49999".to_string())
        .parse::<u16>()
        .unwrap_or(49999);

    // Initialize tracing with OpenTelemetry
    let log_level = std::env::var("RUST_LOG")
        .unwrap_or_else(|_| "info".to_string());
    
    telemetry::init_tracing_with_level(&log_level)?;

    // Initialize application state with configured worker port range and hostname
    let lobby = Lobby::with_config(worker_port_min, worker_port_max, &host_name).await?;
    tracing::info!("🎵 Configured MediaSoup worker port range: {}-{}", worker_port_min, worker_port_max);

    // Setup CORS based on configuration - backend only serves nginx proxy
    let protocol = if host_name == "localhost" { "http" } else { "https" };
    let allowed_origins = vec![
        format!("{}://{}", protocol, host_name).parse::<HeaderValue>()?,
    ];
    
    let cors = CorsLayer::new()
        .allow_origin(allowed_origins)
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_credentials(true)
        .allow_headers([AUTHORIZATION, ACCEPT, CONTENT_TYPE]);

    // Build application router
    let stateless_routes = Router::new()
        .merge(SwaggerUi::new("/swagger-ui").url("/api-docs/openapi.json", ApiDoc::openapi()));

    let stateful_routes = Router::new()
        .route("/ws/room/:room_id", get(ws_handler))
        .route("/ws/listener/:room_id/:session_id", get(listener_handler))
        .route("/ws/lobby", get(lobby_handler))
        .nest("/api", rooms_router())
        .with_state(lobby);

    let app = stateless_routes.merge(stateful_routes)
        .layer(
            ServiceBuilder::new()
                .layer(TraceLayer::new_for_http())
                .layer(cors)
                .layer(DefaultBodyLimit::disable()),
        );

    // Configure server address - backend runs HTTP only (nginx handles TLS)
    let addr = SocketAddr::from(([0, 0, 0, 0], backend_port));
    
    tracing::info!("🌐 HushFM Backend starting on http://{} (hostname: {})", addr, host_name);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

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
