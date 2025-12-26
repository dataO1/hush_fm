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
use tower_http::cors::CorsLayer;
use tokio::signal;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;


mod api;
mod lib;

use api::api::rooms::rooms_router;
use api::api::openapi::ApiDoc;
use lib::domain::Lobby;
use lib::config::Config;
use lib::audio;
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

    // Initialize simple console logging
    tracing_subscriber::fmt::init();

    // Initialize configuration singleton
    let config = Config::init()?;

    // Initialize application state with configuration
    let lobby = Lobby::new().await?;

    // Start audio bot with default room (optional - server continues if audio fails)
    let _audio_bot = match audio::start_audio_bot_room(&lobby).await {
        Ok(bot) => {
            tracing::info!("🎵 Audio bot started successfully - room ID: {}", bot.room_id());
            Some(bot)
        }
        Err(e) => {
            tracing::warn!("⚠️ Audio bot failed to start: {} - Server will continue without local audio", e);
            None  // Server continues without audio bot
        }
    };

    // Setup CORS based on configuration
    let is_local_dev = config.host_name() == "localhost" || config.host_name() == "127.0.0.1";
    let protocol = if is_local_dev { "http" } else { "https" };
    let mut allowed_origins = vec![
        // Production origin (nginx proxy)
        format!("{}://{}", protocol, config.host_name()).parse::<HeaderValue>()?,
    ];
    
    // For local development, also allow frontend origin
    if is_local_dev {
        let frontend_origin = format!("{}://{}:{}", protocol, config.host_name(), config.frontend_port());
        tracing::info!("🔗 Adding frontend origin to CORS: {}", frontend_origin);
        allowed_origins.push(frontend_origin.parse::<HeaderValue>()?);
        
        // Also allow localhost variant if hostname is 127.0.0.1 and vice versa
        let alt_hostname = if config.host_name() == "127.0.0.1" { "localhost" } else { "127.0.0.1" };
        let alt_frontend_origin = format!("{}://{}:{}", protocol, alt_hostname, config.frontend_port());
        tracing::info!("🔗 Adding alternative frontend origin to CORS: {}", alt_frontend_origin);
        allowed_origins.push(alt_frontend_origin.parse::<HeaderValue>()?);
    }
    
    tracing::info!("🌐 CORS allowed origins: {:?}", allowed_origins);
    
    let cors = CorsLayer::new()
        .allow_origin(allowed_origins)
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_credentials(true)
        .allow_headers([AUTHORIZATION, ACCEPT, CONTENT_TYPE])
        .max_age(std::time::Duration::from_secs(86400)); // 24 hours

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
                .layer(cors)
                .layer(DefaultBodyLimit::disable()),
        );

    // Configure server address - backend runs HTTP only (nginx handles TLS)
    let addr = SocketAddr::from(([0, 0, 0, 0], config.backend_port()));
    
    tracing::info!("🌐 HushFM Backend starting on http://{} (hostname: {})", addr, config.host_name());
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

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
