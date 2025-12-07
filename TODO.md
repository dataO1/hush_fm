- [ ] use AsyncAPI for websocket connections and auto client generation in addition to the exiting openapi definition. Bot in the server to define the backend for clients and in the frontend to auto-generate a client, which is then used throughout the code instead of manual client implementation in /ws/client. Use descriptions and examples to make usage of the backend very clear to the client. this should include a graph of the state machine that is implemented in the backend.
- [ ] Add extensive logging/tracing to the backend, see [Logging Feedback](#logging-feedback)
- [ ] fix WaveVisualizer component (currently commented out, since it breaks compilation)

# Logging Feedback
Unified Cross-Service Span Architecture for Silent Disco
Goal: Single Coherent Trace from User Action to Audio Playback in the room. WE
NEED A SPAN PER USER (LISTENER/DJ), which should contain subspans from server
and frontend.

You want to see a single trace in Jaeger that spans from "User clicks Join Room" in the browser all the way through WebSocket signaling, Mediasoup operations, and audio stream establishment.
Core Concept: Trace Context Propagation
The W3C Trace Context Standard

OpenTelemetry uses the W3C Trace Context standard to link spans across services. It consists of:

    Trace ID: Unique identifier for the entire operation (e.g., 4bf92f3577b34da6a3ce929d0e0e4736)

    Parent Span ID: Links child spans to their parent

    Trace Flags: Sampling decisions

Header Format:

text
traceparent: 00-<trace-id>-<parent-span-id>-<flags>

Your Application's Trace Flow
Scenario: User Joins a Room

Visual Representation:

text
┌─────────────────────────────────────────────────────────────────┐
│ Trace ID: abc123                                                │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐│
│ │ Frontend: "join_room_click" (Root Span)         300ms      ││
│ │                                                             ││
│ │ ┌─────────────────────────────────────────────────────────┐││
│ │ │ Frontend: "ws_send_join_room"               50ms       │││
│ │ └──┬──────────────────────────────────────────────────────┘││
│ │    │                                                        ││
│ │    │ HTTP Header: traceparent=00-abc123-parent1-01         ││
│ │    ▼                                                        ││
│ │ ┌──────────────────────────────────────────────────────────┐││
│ │ │ Backend: "ws_handle_join_room"             200ms       │││
│ │ │                                                         │││
│ │ │ ┌─────────────────────────────────────────────────────┐│││
│ │ │ │ Backend: "create_webrtc_transport"    100ms        ││││
│ │ │ └─────────────────────────────────────────────────────┘│││
│ │ │ ┌─────────────────────────────────────────────────────┐│││
│ │ │ │ Backend: "create_consumer"            80ms         ││││
│ │ │ └─────────────────────────────────────────────────────┘│││
│ │ └──┬───────────────────────────────────────────────────────┘││
│ │    │ WS Response with traceparent                          ││
│ │    ▼                                                        ││
│ │ ┌─────────────────────────────────────────────────────────┐││
│ │ │ Frontend: "consume_audio_stream"        40ms          │││
│ │ └─────────────────────────────────────────────────────────┘││
│ └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘

Implementation: Propagating Context
1. Frontend: Create Root Span & Inject Context

File: frontend/src/programs/room.ts

typescript
import { trace, context, propagation } from '@opentelemetry/api'

const tracer = trace.getTracer('silent-disco-frontend')

export const joinRoomProgram = (roomId: string) => Effect.gen(function*(_) {
  // 1. Create ROOT span (this is the top-level operation)
  const rootSpan = tracer.startSpan('join_room_click', {
    kind: SpanKind.CLIENT,
    attributes: {
      'room.id': roomId,
      'user.action': 'join'
    }
  })

  // 2. Set this span as active context
  const ctx = trace.setSpan(context.active(), rootSpan)

  return yield* _(
    context.with(ctx, () =>
      Effect.gen(function*(_) {
        // 3. Child span: Sending WebSocket message
        const wsSendSpan = tracer.startSpan('ws_send_join_room', {
          attributes: {
            'messaging.system': 'websocket',
            'messaging.operation': 'send',
            'message.type': 'JoinRoom'
          }
        }, ctx) // Link to parent context

        // 4. INJECT trace context into WebSocket message
        const carrier: Record<string, string> = {}
        propagation.inject(trace.setSpan(context.active(), wsSendSpan), carrier)

        const message = {
          type: 'JoinRoom',
          roomId,
          // ADD THIS: Embed trace context in message payload
          _traceContext: carrier
        }

        yield* _(sendWebSocketMessage(message))
        wsSendSpan.end()

        // 5. Wait for response and link it to same trace
        const response = yield* _(waitForRoomJoinedEvent)

        // 6. Continue with consume flow (still within root span)
        yield* _(consumeAudioStream(response.transportOptions))

        rootSpan.end()
      })
    )
  )
})

Key Points:

    rootSpan is the parent of everything

    propagation.inject() creates a traceparent header

    We embed it in the WebSocket message payload (since WebSocket doesn't have HTTP headers)

2. Backend: Extract Context & Create Child Span

File: backend/src/handlers/websocket.rs

rust
use opentelemetry::global;
use opentelemetry::trace::{TraceContextExt, Tracer, SpanKind};
use opentelemetry::propagation::Extractor;

// Custom extractor for WebSocket message payload
struct MessageExtractor<'a>(&'a ClientMessage);

impl<'a> Extractor for MessageExtractor<'a> {
    fn get(&self, key: &str) -> Option<&str> {
        // Extract trace context from message payload
        self.0._trace_context.as_ref()
            .and_then(|ctx| ctx.get(key))
            .map(|s| s.as_str())
    }

    fn keys(&self) -> Vec<&str> {
        vec!["traceparent", "tracestate"]
    }
}

#[tracing::instrument(skip(msg, state))]
async fn handle_ws_message(
    user_id: String,
    msg: ClientMessage,
    state: Arc<AppState>
) -> Result<()> {
    // 1. EXTRACT trace context from the message
    let parent_context = global::get_text_map_propagator(|propagator| {
        propagator.extract(&MessageExtractor(&msg))
    });

    // 2. Create a span as a CHILD of the frontend span
    let tracer = global::tracer("silent-disco-backend");
    let mut span = tracer
        .span_builder("ws_handle_join_room")
        .with_kind(SpanKind::Server)
        .with_attributes(vec![
            KeyValue::new("room.id", msg.room_id.to_string()),
            KeyValue::new("user.id", user_id.clone()),
            KeyValue::new("messaging.system", "websocket"),
        ])
        .start_with_context(&tracer, &parent_context); // Link to parent!

    // 3. Execute handler logic (spans inside this will be children)
    let result = match msg {
        ClientMessage::JoinRoom { room_id } => {
            join_room_handler(user_id, room_id, state).await
        }
        // ... other handlers
    };

    // 4. Record result in span
    match &result {
        Ok(_) => span.set_status(Status::Ok),
        Err(e) => {
            span.set_status(Status::error(e.to_string()));
            span.record_exception(e);
        }
    }

    span.end();
    result
}

What happens:

    extract() reads the traceparent from the message

    start_with_context() makes this span a child of the frontend span

    All subsequent operations (create transport, etc.) become grandchildren

3. Backend: Nested Operations Inherit Context

File: backend/src/media/transport.rs

rust
#[tracing::instrument(
    name = "create_webrtc_transport",
    skip(router),
    fields(
        room_id = %room_id,
        user_id = %user_id
    )
)]
async fn create_transport(
    router: &Router,
    room_id: Uuid,
    user_id: String,
) -> Result<WebRtcTransport> {
    // This span is automatically a CHILD of "ws_handle_join_room"
    // because tracing-opentelemetry links to the current context

    tracing::info!("Creating WebRTC transport");

    let transport = router.create_webrtc_transport(options).await?;

    tracing::info!(
        transport_id = %transport.id(),
        "Transport created"
    );

    Ok(transport)
}

No manual linking needed! The #[tracing::instrument] macro automatically:

    Checks for an active OpenTelemetry context

    Creates a child span if one exists

    Records attributes and timing

4. Backend: Return Context to Frontend

File: backend/src/handlers/websocket.rs

rust
async fn send_response(
    ws: &WebSocket,
    event: ServerEvent,
    parent_span: &Span
) -> Result<()> {
    // 1. Inject current span context into response
    let mut carrier = HashMap::new();
    global::get_text_map_propagator(|propagator| {
        let context = Context::current_with_span(parent_span.clone());
        propagator.inject_context(&context, &mut carrier);
    });

    // 2. Add trace context to response payload
    let response = ServerEventWithContext {
        event,
        _traceContext: carrier,
    };

    ws.send(serde_json::to_string(&response)?).await?;
    Ok(())
}

5. Frontend: Link Response to Original Trace

File: frontend/src/programs/websocket.ts

typescript
const handleServerEvent = (event: ServerEvent) => Effect.gen(function*(_) {
  // 1. Extract trace context from server response
  if (event._traceContext) {
    const remoteContext = propagation.extract(
      context.active(),
      event._traceContext
    )

    // 2. Create a span linked to the same trace
    const span = tracer.startSpan('handle_room_joined_event', {
      attributes: {
        'event.type': event.type
      }
    }, remoteContext) // Use extracted context as parent

    // 3. Continue processing within this span
    yield* _(processRoomJoinedEvent(event))

    span.end()
  }
})

Result: What You See in Jaeger UI

Query: Search for Trace ID abc123

Waterfall View:

text
Trace: abc123 (Total: 300ms)

► silent-disco-frontend: join_room_click                    [0ms -------- 300ms]
  │
  ├─► silent-disco-frontend: ws_send_join_room             [0ms -- 50ms]
  │
  ├─► silent-disco-backend: ws_handle_join_room            [50ms -------- 250ms]
  │   │
  │   ├─► silent-disco-backend: create_webrtc_transport    [60ms ---- 160ms]
  │   │
  │   └─► silent-disco-backend: create_consumer            [170ms -- 250ms]
  │
  └─► silent-disco-frontend: consume_audio_stream          [260ms -- 300ms]

Span Details (Backend span):

text
Service: silent-disco-backend
Operation: ws_handle_join_room
Duration: 200ms
Tags:
  - room.id: "550e8400-e29b-41d4-a716-446655440000"
  - user.id: "browser-fp-abc123"
  - messaging.system: "websocket"
  - http.status_code: 200
Logs:
  - t=50ms: "Creating WebRTC transport"
  - t=160ms: "Transport created, transport_id=xyz"

Data Structures for Context Propagation
Shared TypeScript/Rust Types

Frontend (TypeScript):

typescript
interface TraceContext {
  traceparent: string  // "00-abc123-parent1-01"
  tracestate?: string  // Optional vendor data
}

interface ClientMessage {
  type: 'JoinRoom' | 'StartStream' | ...
  roomId?: string
  _traceContext?: TraceContext  // Injected by OTel
}

interface ServerEvent {
  type: 'RoomJoined' | 'StreamStarted' | ...
  payload: any
  _traceContext?: TraceContext  // Injected by backend
}

Backend (Rust):

rust
#[derive(Serialize, Deserialize)]
struct TraceContext {
    traceparent: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    tracestate: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
enum ClientMessage {
    JoinRoom {
        room_id: Uuid,
        #[serde(rename = "_traceContext")]
        trace_context: Option<TraceContext>,
    },
    // ...
}

Summary: The Complete Flow

    Frontend: User clicks "Join Room"

        Creates root span join_room_click

        Generates Trace ID (e.g., abc123)

    Frontend: Sends WebSocket message

        Creates child span ws_send_join_room

        Injects traceparent header into message payload

    Backend: Receives WebSocket message

        Extracts traceparent from payload

        Creates span ws_handle_join_room as child of frontend span

        Trace ID is preserved: abc123

    Backend: Executes nested operations

        create_webrtc_transport span (grandchild)

        create_consumer span (grandchild)

        All inherit abc123 trace ID

    Backend: Sends response

        Injects current span context into response

        Returns to frontend with traceparent

    Frontend: Processes response

        Extracts context, creates span handle_room_joined_event

        Links back to original abc123 trace

    Jaeger: Displays unified view

        Single trace abc123 spans both services

        Shows exact timing of each operation

        Reveals bottlenecks (e.g., "Why is join slow? → Transport creation took 100ms")

Result: You click "Join Room" in the browser, and Jaeger shows you every single step from that click to the final audio stream, all in one coherent trace.
