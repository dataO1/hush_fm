use axum::{
    extract::{DefaultBodyLimit, State},
    http::{
        header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE},
        HeaderValue, Method,
    },
    response::Json,
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
use api::api::client_log::client_log_router;
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

    // Initialize console logging with an EnvFilter so we don't flood the Pi's
    // SD card / drown out signal on a long party. Default: `info` for the app,
    // `warn` for noisy deps. Fully overridable via `RUST_LOG`.
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| {
            tracing_subscriber::EnvFilter::new(
                "info,mediasoup=warn,tower_http=warn,hyper=warn,axum=warn",
            )
        });
    tracing_subscriber::fmt().with_env_filter(env_filter).init();

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

    // Spawn the setup-room sweeper: periodically close leaked non-public
    // (Setup-state) rooms whose DJ announced but never opened the room WS, so
    // the disconnect-grace timer never armed. The audio-bot room is never
    // swept (see Lobby::sweep_setup_rooms). Interval + idle threshold are
    // env-overridable with sane defaults.
    {
        let sweeper_lobby = lobby.clone();
        let sweep_interval_secs = std::env::var("HUSHFM_SWEEP_INTERVAL_SECS")
            .ok()
            .and_then(|s| s.trim().parse::<u64>().ok())
            .filter(|&n| n > 0)
            .unwrap_or(60);
        let idle_threshold_secs = std::env::var("HUSHFM_SETUP_ROOM_IDLE_SECS")
            .ok()
            .and_then(|s| s.trim().parse::<u64>().ok())
            .filter(|&n| n > 0)
            .unwrap_or(10 * 60); // 10 minutes
        let idle_threshold = std::time::Duration::from_secs(idle_threshold_secs);

        tracing::info!(
            interval_secs = sweep_interval_secs,
            idle_threshold_secs = idle_threshold_secs,
            "🧹 Setup-room sweeper started"
        );

        tokio::spawn(async move {
            let mut ticker =
                tokio::time::interval(std::time::Duration::from_secs(sweep_interval_secs));
            // Skip the immediate first tick; wait a full interval before the
            // first sweep so freshly-announced rooms get a chance to go live.
            ticker.tick().await;
            loop {
                ticker.tick().await;
                sweeper_lobby.sweep_setup_rooms(idle_threshold).await;
            }
        });
    }

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
        .route("/health", get(health))
        .nest("/api", rooms_router().merge(client_log_router()))
        .with_state(lobby.clone());

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
    // Wire the previously-dead `shutdown_signal` so SIGTERM (Pi deploy/restart)
    // drains in-flight connections cleanly instead of abruptly killing every
    // socket (which caused reconnect churn against a booting server).
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    tracing::info!("🎵 HushFM Backend shutdown complete");

    Ok(())
}

/// GET /health — cheap liveness/readiness probe for nginx / deploy scripts / a
/// phone on the headless offline Pi. No auth. Returns 200 with a small JSON
/// body: app version, MediaSoup worker count, and current room count.
async fn health(State(lobby): State<Lobby>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION"),
        "workers": lobby.worker_count(),
        "rooms": lobby.room_count(),
    }))
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
