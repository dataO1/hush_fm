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

// TLS support
use axum_server::tls_rustls::RustlsConfig;

mod api;
mod lib;
mod telemetry;

use api::api::rooms::rooms_router;
use api::api::openapi::ApiDoc;
use lib::domain::Lobby;
use lib::utils::network::get_local_ip;
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

    // Initialize tracing with OpenTelemetry
    let log_level = std::env::var("RUST_LOG")
        .unwrap_or_else(|_| "info".to_string());
    
    telemetry::init_tracing_with_level(&log_level)?;

    // Initialize application state
    let lobby = Lobby::new().await?;

    // Get local IP address for CORS configuration
    let local_ip = get_local_ip()?;
    tracing::info!("🌐 Detected local IP: {}", local_ip);

    // Setup CORS for development (allow HTTPS origins for credentials)
    let mut allowed_origins = vec![
        "https://localhost:5173".parse::<HeaderValue>()?,
    ];
    
    // Add the local IP origin if it's not localhost
    if !local_ip.is_loopback() {
        let local_origin = format!("https://{}:5173", local_ip);
        allowed_origins.push(local_origin.parse::<HeaderValue>()?);
        tracing::info!("🌐 Added local IP HTTPS origin: {}", local_origin);
    }
    
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

    // Load TLS configuration
    let cert_file = "../tls/server.crt";
    let key_file = "../tls/server.key";
    
    let tls_config = RustlsConfig::from_pem_file(cert_file, key_file).await
        .map_err(|e| anyhow::anyhow!("Failed to load TLS configuration: {}", e))?;
    
    // Start HTTPS server
    let addr = SocketAddr::from(([0, 0, 0, 0], 3443));
    tracing::info!("🔒 HushFM Backend starting on https://{}", addr);
    
    // Setup graceful shutdown with TLS
    axum_server::bind_rustls(addr, tls_config)
        .serve(app.into_make_service())
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
