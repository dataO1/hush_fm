- [ ] use AsyncAPI for websocket connections and auto client generation in addition to the exiting openapi definition. Bot in the server to define the backend for clients and in the frontend to auto-generate a client, which is then used throughout the code instead of manual client implementation in /ws/client. Use descriptions and examples to make usage of the backend very clear to the client. this should include a graph of the state machine that is implemented in the backend.
- [ ] Add extensive logging/tracing to the backend, see [Logging Feedback](#logging-feedback)
- [ ] fix WaveVisualizer component (currently commented out, since it breaks compilation)

# Logging Feedback

Backend (Rust) - Logging & Tracing
Recommended Stack: tracing + tracing-subscriber

Why tracing?

    Structured logging with spans (tracks request lifetime through your system)

    Zero-cost abstractions when disabled

    Native Tokio integration (critical for async debugging)

    Can trace through Mediasoup worker calls

Setup:

text
[dependencies]
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "json"] }
tracing-actix-web = "0.7"  # If using Actix
tower-http = { version = "0.5", features = ["trace"] }  # For Axum

Configuration for Pi:

rust
// main.rs
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

fn init_logging() {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "silent_disco=debug,mediasoup=info,axum=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer()
            .with_target(true)
            .with_thread_ids(true)
            .with_file(true)
            .with_line_number(true))
        .init();
}

Critical Spans to Add

WebSocket Message Flow:

rust
#[tracing::instrument(skip(msg, state))]
async fn handle_ws_message(user_id: &str, msg: ClientMessage, state: &AppState) {
    match msg {
        ClientMessage::JoinRoom { room_id } => {
            tracing::info!(room_id = %room_id, "User joining room");
            // Your logic
        }
    }
}

Mediasoup Operations:

rust
#[tracing::instrument(skip(router))]
async fn create_producer(router: &Router, rtp_params: RtpParameters) -> Result<Producer> {
    tracing::debug!(?rtp_params, "Creating producer");
    let producer = router.create_producer(options).await?;
    tracing::info!(producer_id = %producer.id(), "Producer created");
    Ok(producer)
}

Performance Monitoring

Add metrics for critical paths:

rust
use tracing::info_span;

let _span = info_span!("mediasoup_forward", room_id = %room.id).entered();
// Mediasoup packet forwarding happens here
// Span timing auto-logged on drop

Frontend (SolidJS + Effect-TS) - Debugging
1. Effect-TS Built-in Logging

Effect has native logging that integrates with its runtime:

typescript
import { Effect, Logger, LogLevel } from "effect"

// Configure logger at app root
const program = myApp.pipe(
  Effect.provide(Logger.pretty), // Human-readable logs
  Logger.withMinimumLogLevel(LogLevel.Debug)
)

In your programs:

typescript
const joinRoomProgram = (roomId: string) => Effect.gen(function*(_) {
  yield* _(Effect.log("Starting room join", { roomId }))

  const transport = yield* _(createTransport).pipe(
    Effect.tap(() => Effect.log("Transport connected")),
    Effect.tapError((e) => Effect.logError("Transport failed", e))
  )

  return transport
})

2. SolidJS DevTools

Install:

bash
npm install solid-devtools

Enable:

typescript
// App.tsx
import { attachDevtoolsOverlay } from 'solid-devtools'

if (import.meta.env.DEV) {
  attachDevtoolsOverlay()
}

Features:

    Visual signal dependency graph (see what triggers updates)

    Time-travel debugging for signal changes

    Component tree inspection

3. Browser Console Integration

Effect Console Logger (Production-safe):

typescript
import { Effect, Logger } from "effect"

const consoleLogger = Logger.make(({ message, logLevel, annotations }) => {
  const level = logLevel.label.toLowerCase()
  console[level](`[${level.toUpperCase()}]`, message, annotations)
})

Effect.provide(myApp, Layer.setConfigProvider(consoleLogger))

End-to-End Tracing (Backend ↔ Frontend)
Correlation IDs for Request Tracking

Backend - Generate:

rust
// Axum middleware
async fn add_request_id<B>(
    mut req: Request<B>,
    next: Next<B>,
) -> Response {
    let request_id = uuid::Uuid::new_v4();
    req.extensions_mut().insert(request_id);

    tracing::info_span!("request", %request_id).in_scope(|| {
        next.run(req)
    })
}

Frontend - Attach:

typescript
const apiCall = (roomId: string) => Effect.gen(function*(_) {
  const correlationId = crypto.randomUUID()

  yield* _(Effect.log("API call", { correlationId, roomId }))

  const result = yield* _(fetch('/api/join', {
    headers: { 'X-Correlation-ID': correlationId }
  }))

  return result
})

Benefit: Search logs for correlationId to trace a request from frontend click → backend processing → response.
WebRTC-Specific Debugging
Mediasoup Debug Mode

Backend:

rust
// Enable verbose mediasoup worker logs
let worker_settings = WorkerSettings::default()
    .log_level(WorkerLogLevel::Debug)
    .log_tags(vec![
        WorkerLogTag::Info,
        WorkerLogTag::Ice,
        WorkerLogTag::Dtls,
        WorkerLogTag::Rtp,
    ]);

Frontend (Browser):
Enable WebRTC internals:

    Chrome: chrome://webrtc-internals

    Firefox: about:webrtc

Shows real-time ICE candidates, packet stats, bitrate.
Audio Stream Visualization

Add stats logging to detect issues:

typescript
const logTransportStats = Effect.gen(function*(_) {
  const stats = yield* _(Effect.promise(() => transport.getStats()))

  stats.forEach(stat => {
    if (stat.type === 'inbound-rtp') {
      yield* _(Effect.log("Audio stats", {
        packetsLost: stat.packetsLost,
        jitter: stat.jitter,
        bytesReceived: stat.bytesReceived
      }))
    }
  })
})

// Run every 5 seconds
Effect.repeat(logTransportStats, Schedule.spaced("5 seconds"))
