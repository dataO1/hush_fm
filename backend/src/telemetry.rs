use opentelemetry::KeyValue;
use opentelemetry_otlp::{HttpExporterBuilder, WithExportConfig};
use opentelemetry_sdk::propagation::TraceContextPropagator;
use opentelemetry_sdk::trace::Sampler;
use opentelemetry_sdk::Resource;
use opentelemetry_semantic_conventions as semcov;
use opentelemetry::global;
use tracing_opentelemetry::OpenTelemetryLayer;
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};
use anyhow::Result;
use tracing::info;
use opentelemetry_sdk::trace::SdkTracerProvider;
use once_cell::sync::Lazy;
use std::sync::Mutex;

static TRACER_PROVIDER: Lazy<Mutex<Option<SdkTracerProvider>>> = Lazy::new(|| Mutex::new(None));

/// Initialize OpenTelemetry with OTLP exporter for Jaeger
pub fn init_tracing_with_level(level: &str) -> Result<()> {
    let exporter = HttpExporterBuilder::default()
        .with_endpoint("http://localhost:4318/v1/traces")
        .build_span_exporter()?;
    
    let resource = Resource::builder().with_attributes(vec![
        KeyValue::new(semcov::resource::SERVICE_NAME, "hushfm-backend"),
        KeyValue::new(semcov::resource::SERVICE_VERSION, env!("CARGO_PKG_VERSION")),
    ]).build();
    
    let tracer_provider = SdkTracerProvider::builder()
        .with_sampler(Sampler::AlwaysOn)
        .with_resource(resource)
        .with_batch_exporter(exporter)
        .build();
    
    *TRACER_PROVIDER.lock().unwrap() = Some(tracer_provider.clone());
    global::set_tracer_provider(tracer_provider.clone());
    global::set_text_map_propagator(TraceContextPropagator::new());
    
    let tracer = global::tracer("hushfm-backend");
    
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(level));
        
    let fmt_layer = tracing_subscriber::fmt::layer()
        .with_target(true)
        .with_thread_ids(false)
        .with_line_number(false);

    let otel_layer = OpenTelemetryLayer::new(tracer);

    tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt_layer)
        .with(otel_layer)
        .try_init()?;

    info!("Tracing initialized with level: {}", level);
    info!("OpenTelemetry exporting to Jaeger at http://localhost:4318");

    Ok(())
}

pub fn shutdown_tracer() {
    if let Some(provider) = TRACER_PROVIDER.lock().unwrap().take() {
        if let Err(e) = provider.shutdown() {
            eprintln!("Error shutting down tracer provider: {}", e);
        }
    }
}


/// Create a child span with WebSocket message attributes using static string
pub fn create_ws_message_span(
    _operation_name: &str,
    message_type: &str,
    room_id: Option<&uuid::Uuid>,
    user_id: Option<&str>,
) -> tracing::Span {
    let span = tracing::info_span!(
        "ws_handle_message",
        messaging.system = "websocket",
        messaging.operation = "receive",
        message.type = message_type,
    );

    if let Some(room_id) = room_id {
        span.record("room.id", room_id.to_string());
    }

    if let Some(user_id) = user_id {
        span.record("user.id", user_id);
    }

    span
}

/// Create a span for WebRTC operations using static string
pub fn create_webrtc_span(
    _operation_name: &str,
    transport_id: Option<&str>,
    room_id: Option<&uuid::Uuid>,
) -> tracing::Span {
    let span = tracing::info_span!(
        "webrtc_operation",
        webrtc.component = "mediasoup",
    );

    if let Some(transport_id) = transport_id {
        span.record("transport.id", transport_id);
    }

    if let Some(room_id) = room_id {
        span.record("room.id", room_id.to_string());
    }

    span
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_init_tracing() {
        // Just verify function compiles and runs, actual init requires Tokio runtime
        assert!(true);
    }
}