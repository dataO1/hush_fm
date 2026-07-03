/**
 * WebSocket Schema Patterns
 *
 * Complete WebSocket schemas including connections, messages, and events.
 * Eliminates duplication and provides unified WebSocket handling across all domains.
 *
 * Uses S.Encoded vs S.Type pattern for proper boundary handling.
 */

import { Schema as S, pipe, Effect } from 'effect'

/**
 * Middleware Pattern for Global Schema Logging
 * Wraps schema make operations with detailed logging for debugging
 */
export const withSchemaLogging = (schema: any, schemaName: string) => {
  return (input: any) =>
    pipe(
      Effect.try(() => {
        console.info(`🔄 Schema: Creating ${schemaName} with input:`, input)
        return schema.make(input)
      }),
      Effect.tap((result) => 
        Effect.sync(() => console.info(`✅ Schema: ${schemaName} created successfully:`, result))
      ),
      Effect.tapError((error) =>
        Effect.sync(() => console.error(`❌ Schema: Failed to create ${schemaName}:`, error, 'Input:', input))
      )
    )
}
import { ConsumerParametersTransformSchema, DtlsParametersTransformSchema, RtpCapabilitiesTransformSchema, RtpParametersTransformSchema, TransportOptionsTransformSchema } from './mediasoup.schema'

/**
 * WebSocket Event Type Enums
 * 
 * Defines all possible event types as const objects for type safety.
 * Use these instead of magic strings throughout the application.
 * 
 * Naming Convention:
 * - Constants: WEBSOCKET_[CONTEXT]_EVENT_TYPES (e.g., WEBSOCKET_LOBBY_EVENT_TYPES)
 * - Types: WebSocket[Context]EventType (e.g., WebSocketLobbyEventType)
 * - Values: Use the actual string values from the backend protocol
 */

// Lobby Event Types - events received when connected to lobby WebSocket
export const WEBSOCKET_LOBBY_EVENT_TYPES = {
  ROOM_ADDED: 'roomAdded',
  ROOM_UPDATED: 'roomUpdated', 
  ROOM_REMOVED: 'roomRemoved',
  JOIN_APPROVED: 'joinApproved',
  ROOM_ANNOUNCED: 'roomAnnounced'
} as const

export type WebSocketLobbyEventType = typeof WEBSOCKET_LOBBY_EVENT_TYPES[keyof typeof WEBSOCKET_LOBBY_EVENT_TYPES]

// DJ Event Types - events received when connected as a DJ to room WebSocket
export const WEBSOCKET_DJ_EVENT_TYPES = {
  ROOM_INITIALIZED: 'roomInitialized',
  DJ_TRANSPORT_READY: 'djTransportReady',
  TRANSPORT_CONNECTED: 'transportConnected',
  PRODUCER_CREATED: 'producerCreated',
  STREAM_PAUSED: 'streamPaused',
  STREAM_RESUMED: 'streamResumed',
  ROOM_CLOSED: 'roomClosed',
  DJ_COMMAND_FAILED: 'djCommandFailed',
  ROOM_NOT_FOUND: 'roomNotFound'
} as const

export type WebSocketDJEventType = typeof WEBSOCKET_DJ_EVENT_TYPES[keyof typeof WEBSOCKET_DJ_EVENT_TYPES]

// Listener Event Types - events received when connected as a listener to room WebSocket
export const WEBSOCKET_LISTENER_EVENT_TYPES = {
  LISTENER_TRANSPORT_READY: 'listenerTransportReady',
  JOIN_READY: 'joinReady',
  TRANSPORT_CONNECTED: 'transportConnected',
  CONSUMER_CREATED: 'consumerCreated',
  ROUTER_CAPABILITIES: 'routerCapabilities',
  LISTENER_COUNT_UPDATED: 'listenerCountUpdated',
  STREAM_PAUSED: 'streamPaused',
  STREAM_RESUMED: 'streamResumed',
  ROOM_CLOSED: 'roomClosed',
  LISTENER_COMMAND_FAILED: 'listenerCommandFailed',
  ROOM_NOT_FOUND: 'roomNotFound',
  PONG: 'pong',
  LISTENER_NOT_FOUND: 'listenerNotFound'
} as const

export type WebSocketListenerEventType = typeof WEBSOCKET_LISTENER_EVENT_TYPES[keyof typeof WEBSOCKET_LISTENER_EVENT_TYPES]

// Command Types - commands sent to WebSocket servers
export const WEBSOCKET_COMMAND_TYPES = {
  // DJ Commands
  INIT_ROOM: 'initRoom',
  REQUEST_DJ_TRANSPORT: 'requestDjTransport',
  CONNECT_DJ_TRANSPORT: 'connectDjTransport',
  PRODUCE: 'produce',
  PAUSE_STREAM: 'pauseStream',
  RESUME_STREAM: 'resumeStream',
  CLOSE_ROOM: 'closeRoom',

  // Listener Commands
  INIT_LISTENER: 'initListener',
  CONNECT_LISTENER_TRANSPORT: 'connectListenerTransport',
  REQUEST_CONSUMER: 'requestConsumer',
  RESUME_CONSUMER: 'resumeConsumer',
  PING: 'ping',

  // Lobby Commands
  ANNOUNCE_ROOM: 'announceRoom',
  JOIN_ROOM_REQUEST: 'joinRoomRequest'
} as const

export type WebSocketCommandType = typeof WEBSOCKET_COMMAND_TYPES[keyof typeof WEBSOCKET_COMMAND_TYPES]

/**
 * Individual command and event schemas with type fields
 * Uses withConstructorDefault for commands to auto-inject type fields
 */

/**
 * =============================================================================
 * WEBSOCKET MESSAGE & EVENT SCHEMAS
 * =============================================================================
 */

/**
 * Lobby Commands (Client → Server)
 */
// Union type created from individual schemas below
export type LobbyCommandType =
  | S.Schema.Type<typeof AnnounceRoomCommandSchema>
  | S.Schema.Type<typeof RequestJoinCommandSchema>
  | S.Schema.Type<typeof RefreshRoomsCommandSchema>

/**
 * Lobby Events (Server → Client)
 */
// Union type created from individual schemas below
export type LobbyEventType =
  | S.Schema.Type<typeof RoomAnnouncedEventSchema>
  | S.Schema.Type<typeof RoomAddedEventSchema>
  | S.Schema.Type<typeof RoomUpdatedEventSchema>
  | S.Schema.Type<typeof RoomRemovedEventSchema>
  | S.Schema.Type<typeof JoinRoomResponseEventSchema>

// Individual Lobby Event Schemas for specific type safety
export const RoomAnnouncedEventSchema = S.Struct({
  room: S.Struct({
    id: S.String,
    name: S.String,
    djName: S.String,
    djId: S.String,
    listenerCount: S.Number,
    isStreaming: S.Boolean,
    createdAt: S.String,
    description: S.OptionFromNullOr(S.String),
    tags: S.Array(S.String)
  }),
  wsUrl: S.String,
  type: S.Literal("roomAnnounced")
})

export const RoomAddedEventSchema = S.Struct({
  room: S.Struct({
    id: S.String,
    name: S.String,
    djName: S.String,
    djId: S.String,
    listenerCount: S.Number,
    isStreaming: S.Boolean,
    createdAt: S.String,
    description: S.OptionFromNullOr(S.String),
    tags: S.Array(S.String)
  }),
  type: S.Literal("roomAdded")
})

export const RoomUpdatedEventSchema = S.Struct({
  room: S.Struct({
    id: S.String,
    name: S.String,
    djName: S.String,
    djId: S.String,
    listenerCount: S.Number,
    isStreaming: S.Boolean,
    createdAt: S.String,
    description: S.OptionFromNullOr(S.String),
    tags: S.Array(S.String)
  }),
  type: S.Literal("roomUpdated")
})

export const RoomRemovedEventSchema = S.Struct({
  roomId: S.String,
  type: S.Literal("roomRemoved")
})

export const JoinRoomResponseEventSchema = S.Struct({
  sessionId: S.String,
  roomId: S.String,
  success: S.Boolean,
  error: S.OptionFromNullOr(S.String),
  listenerWebSocketUrl: S.OptionFromNullOr(S.String),
  room: S.OptionFromNullOr(S.Struct({
    id: S.String,
    name: S.String,
    djName: S.String,
    djId: S.String,
    listenerCount: S.Number,
    isStreaming: S.Boolean,
    createdAt: S.String,
    description: S.OptionFromNullOr(S.String),
    tags: S.Array(S.String)
  })),
  type: S.Literal("joinRoomResponse")
})

// Individual Lobby Event Types
export type RoomAnnouncedEvent = S.Schema.Type<typeof RoomAnnouncedEventSchema>
export type RoomAddedEvent = S.Schema.Type<typeof RoomAddedEventSchema>
export type RoomUpdatedEvent = S.Schema.Type<typeof RoomUpdatedEventSchema>
export type RoomRemovedEvent = S.Schema.Type<typeof RoomRemovedEventSchema>
export type JoinRoomResponseEvent = S.Schema.Type<typeof JoinRoomResponseEventSchema>

/**
 * Lobby Event Union Schema with discriminated type field
 */
export const LobbyEventSchema = S.Union(
  RoomAnnouncedEventSchema,
  RoomAddedEventSchema,
  RoomUpdatedEventSchema,
  RoomRemovedEventSchema,
  JoinRoomResponseEventSchema
)

// Individual Lobby Command Schemas with default type fields
export const AnnounceRoomCommandSchema = S.Struct({
  name: S.String,
  djName: S.String,
  sessionId: S.String,
  description: S.OptionFromNullOr(S.String),
  tags: S.OptionFromNullOr(S.Array(S.String)),
  type: S.Literal("announceRoom").pipe(
    S.propertySignature,
    S.withConstructorDefault(() => "announceRoom" as const)
  )
})

export const RequestJoinCommandSchema = S.Struct({
  roomId: S.String,
  sessionId: S.String,
  type: S.Literal("requestJoin").pipe(
    S.propertySignature,
    S.withConstructorDefault(() => "requestJoin" as const)
  )
})

export const RefreshRoomsCommandSchema = S.Struct({
  type: S.Literal("refreshRooms").pipe(
    S.propertySignature,
    S.withConstructorDefault(() => "refreshRooms" as const)
  )
})

// Individual Lobby Command Types
export type AnnounceRoomCommand = S.Schema.Type<typeof AnnounceRoomCommandSchema>
export type RequestJoinCommand = S.Schema.Type<typeof RequestJoinCommandSchema>
export type RefreshRoomsCommand = S.Schema.Type<typeof RefreshRoomsCommandSchema>

/**
 * Lobby Command Union Schema
 * Commands include type fields with default values for discrimination
 */
export const LobbyCommandSchema = S.Union(
  AnnounceRoomCommandSchema,
  RequestJoinCommandSchema,
  RefreshRoomsCommandSchema
)


/**
 * DJ Commands (Client → Server)
 */
// Union type created from individual schemas below
export type DJCommandType =
  | S.Schema.Type<typeof InitRoomCommandSchema>
  | S.Schema.Type<typeof RequestDjTransportCommandSchema>
  | S.Schema.Type<typeof ConnectDjTransportCommandSchema>
  | S.Schema.Type<typeof ProduceCommandSchema>
  | S.Schema.Type<typeof PauseStreamCommandSchema>
  | S.Schema.Type<typeof ResumeStreamCommandSchema>
  | S.Schema.Type<typeof CloseRoomCommandSchema>

/**
 * DJ Events (Server → Client)
 */
// Union type created from individual schemas below
export type DJEventType =
  | S.Schema.Type<typeof RoomInitializedEventSchema>
  | S.Schema.Type<typeof DjTransportReadyEventSchema>
  | S.Schema.Type<typeof TransportConnectedEventSchema>
  | S.Schema.Type<typeof ProducerCreatedEventSchema>
  | S.Schema.Type<typeof StreamPausedEventSchema>
  | S.Schema.Type<typeof StreamResumedEventSchema>
  | S.Schema.Type<typeof RoomClosedEventSchema>
  | S.Schema.Type<typeof DJCommandFailedEventSchema>
  | S.Schema.Type<typeof RoomNotFoundEventSchema>

// Individual DJ Event Schemas for specific type safety
export const RoomInitializedEventSchema = S.Struct({
  roomId: S.String,
  rtpCapabilities: RtpCapabilitiesTransformSchema,
  type: S.Literal("roomInitialized")
})

export const DjTransportReadyEventSchema = S.Struct({
  transportOptions: TransportOptionsTransformSchema,
  type: S.Literal("djTransportReady")
})

export const TransportConnectedEventSchema = S.Struct({
  transportId: S.String,
  type: S.Literal("transportConnected")
})

export const ProducerCreatedEventSchema = S.Struct({
  producerId: S.String,
  roomId: S.String,
  type: S.Literal("producerCreated")
})

export const StreamPausedEventSchema = S.Struct({
  roomId: S.String,
  type: S.Literal("streamPaused")
})

export const StreamResumedEventSchema = S.Struct({
  roomId: S.String,
  type: S.Literal("streamResumed")
})

export const RoomClosedEventSchema = S.Struct({
  roomId: S.String,
  reason: S.String,
  type: S.Literal("roomClosed")
})

export const DJCommandFailedEventSchema = S.Struct({
  command: S.String,
  error: S.String,
  type: S.Literal("commandFailed")
})

export const RoomNotFoundEventSchema = S.Struct({
  roomId: S.String,
  type: S.Literal("roomNotFound")
})

// Individual DJ Event Types
export type RoomInitializedEvent = S.Schema.Type<typeof RoomInitializedEventSchema>
export type DjTransportReadyEvent = S.Schema.Type<typeof DjTransportReadyEventSchema>
export type TransportConnectedEvent = S.Schema.Type<typeof TransportConnectedEventSchema>
export type ProducerCreatedEvent = S.Schema.Type<typeof ProducerCreatedEventSchema>
export type StreamPausedEvent = S.Schema.Type<typeof StreamPausedEventSchema>
export type StreamResumedEvent = S.Schema.Type<typeof StreamResumedEventSchema>
export type RoomClosedEvent = S.Schema.Type<typeof RoomClosedEventSchema>
export type DJCommandFailedEvent = S.Schema.Type<typeof DJCommandFailedEventSchema>
export type RoomNotFoundEvent = S.Schema.Type<typeof RoomNotFoundEventSchema>

/**
 * DJ Event Union Schema with discriminated type field
 */
export const DJEventSchema = S.Union(
  RoomInitializedEventSchema,
  DjTransportReadyEventSchema,
  TransportConnectedEventSchema,
  ProducerCreatedEventSchema,
  StreamPausedEventSchema,
  StreamResumedEventSchema,
  RoomClosedEventSchema,
  DJCommandFailedEventSchema,
  RoomNotFoundEventSchema
)


// Individual DJ Command Schemas with default type fields
export const InitRoomCommandSchema = S.Struct({
  roomId: S.String,
  type: S.Literal("initRoom").pipe(
    S.propertySignature,
    S.withConstructorDefault(() => "initRoom" as const)
  )
})

export const RequestDjTransportCommandSchema = S.Struct({
  type: S.Literal("requestDjTransport").pipe(
    S.propertySignature,
    S.withConstructorDefault(() => "requestDjTransport" as const)
  )
})

export const ConnectDjTransportCommandSchema = S.Struct({
  transportId: S.OptionFromNullOr(S.String),
  dtlsParameters: DtlsParametersTransformSchema,
  type: S.Literal("connectDjTransport").pipe(
    S.propertySignature,
    S.withConstructorDefault(() => "connectDjTransport" as const)
  )
})

export const ProduceCommandSchema = S.Struct({
  rtpParameters: RtpParametersTransformSchema,
  type: S.Literal("produce").pipe(
    S.propertySignature,
    S.withConstructorDefault(() => "produce" as const)
  )
})

export const PauseStreamCommandSchema = S.Struct({
  type: S.Literal("pauseStream").pipe(
    S.propertySignature,
    S.withConstructorDefault(() => "pauseStream" as const)
  )
})

export const ResumeStreamCommandSchema = S.Struct({
  type: S.Literal("resumeStream").pipe(
    S.propertySignature,
    S.withConstructorDefault(() => "resumeStream" as const)
  )
})

export const CloseRoomCommandSchema = S.Struct({
  type: S.Literal("closeRoom").pipe(
    S.propertySignature,
    S.withConstructorDefault(() => "closeRoom" as const)
  )
})

// Individual DJ Command Types
export type InitRoomCommand = S.Schema.Type<typeof InitRoomCommandSchema>
export type RequestDjTransportCommand = S.Schema.Type<typeof RequestDjTransportCommandSchema>
export type ConnectDjTransportCommand = S.Schema.Type<typeof ConnectDjTransportCommandSchema>
export type ProduceCommand = S.Schema.Type<typeof ProduceCommandSchema>
export type PauseStreamCommand = S.Schema.Type<typeof PauseStreamCommandSchema>
export type ResumeStreamCommand = S.Schema.Type<typeof ResumeStreamCommandSchema>
export type CloseRoomCommand = S.Schema.Type<typeof CloseRoomCommandSchema>

/**
 * DJ Command Union Schema
 * Commands include type fields with default values for discrimination
 */
export const DJCommandSchema = S.Union(
  InitRoomCommandSchema,
  RequestDjTransportCommandSchema,
  ConnectDjTransportCommandSchema,
  ProduceCommandSchema,
  PauseStreamCommandSchema,
  ResumeStreamCommandSchema,
  CloseRoomCommandSchema
)


/**
 * Listener Commands (Client → Server)
 */
// Union type created from individual schemas below
export type ListenerCommandType =
  | S.Schema.Type<typeof InitListenerCommandSchema>
  | S.Schema.Type<typeof GetRouterCapabilitiesCommandSchema>
  | S.Schema.Type<typeof ConnectListenerTransportCommandSchema>
  | S.Schema.Type<typeof RequestConsumerCommandSchema>
  | S.Schema.Type<typeof ResumeConsumerCommandSchema>
  | S.Schema.Type<typeof LeaveRoomCommandSchema>
  | S.Schema.Type<typeof PingCommandSchema>

/**
 * Listener Events (Server → Client)
 */
// Union type created from individual schemas below
export type ListenerEventType =
  | S.Schema.Type<typeof ListenerTransportReadyEventSchema>
  | S.Schema.Type<typeof JoinReadyEventSchema>
  | S.Schema.Type<typeof ListenerTransportConnectedEventSchema>
  | S.Schema.Type<typeof ConsumerCreatedEventSchema>
  | S.Schema.Type<typeof RouterCapabilitiesEventSchema>
  | S.Schema.Type<typeof ListenerCountUpdatedEventSchema>
  | S.Schema.Type<typeof ListenerStreamPausedEventSchema>
  | S.Schema.Type<typeof ListenerStreamResumedEventSchema>
  | S.Schema.Type<typeof ListenerRoomClosedEventSchema>
  | S.Schema.Type<typeof ListenerCommandFailedEventSchema>
  | S.Schema.Type<typeof ListenerRoomNotFoundEventSchema>
  | S.Schema.Type<typeof PongEventSchema>
  | S.Schema.Type<typeof ListenerNotFoundEventSchema>

// Individual Listener Event Schemas for specific type safety
export const ListenerTransportReadyEventSchema = S.Struct({
  transportOptions: TransportOptionsTransformSchema,
  type: S.Literal("listenerTransportReady")
})

export const JoinReadyEventSchema = S.Struct({
  room: S.Struct({
    id: S.String,
    name: S.String,
    djName: S.String,
    djId: S.String,
    listenerCount: S.Number,
    isStreaming: S.Boolean,
    createdAt: S.String,
    description: S.OptionFromNullOr(S.String),
    tags: S.Array(S.String)
  }),
  transportOptions: TransportOptionsTransformSchema,
  producerId: S.String,
  rtpCapabilities: RtpCapabilitiesTransformSchema,
  type: S.Literal("joinReady")
})

export const ListenerTransportConnectedEventSchema = S.Struct({
  transportId: S.String,
  type: S.Literal("transportConnected")
})

export const ConsumerCreatedEventSchema = S.Struct({
  consumerId: S.String,
  producerId: S.String,
  consumerParameters: ConsumerParametersTransformSchema,
  type: S.Literal("consumerCreated")
})

export const RouterCapabilitiesEventSchema = S.Struct({
  roomId: S.String,
  rtpCapabilities: RtpCapabilitiesTransformSchema,
  type: S.Literal("routerCapabilities")
})

export const ListenerCountUpdatedEventSchema = S.Struct({
  roomId: S.String,
  count: S.Number,
  type: S.Literal("listenerCountUpdated")
})

export const ListenerStreamPausedEventSchema = S.Struct({
  roomId: S.String,
  type: S.Literal("streamPaused")
})

export const ListenerStreamResumedEventSchema = S.Struct({
  roomId: S.String,
  type: S.Literal("streamResumed")
})

export const ListenerRoomClosedEventSchema = S.Struct({
  roomId: S.String,
  reason: S.String,
  type: S.Literal("roomClosed")
})

export const ListenerCommandFailedEventSchema = S.Struct({
  command: S.String,
  error: S.String,
  type: S.Literal("commandFailed")
})

export const ListenerRoomNotFoundEventSchema = S.Struct({
  roomId: S.String,
  type: S.Literal("roomNotFound")
})

/**
 * Application-level heartbeat pong (reply to ListenerCommand::Ping)
 * Matches backend ListenerEvent::Pong which serialises as {"type":"pong"}.
 */
export const PongEventSchema = S.Struct({
  type: S.Literal("pong")
})

/**
 * Sent by the server immediately before closing the WebSocket when the
 * listener session_id is unknown (e.g. session expired or bad URL).
 * Matches backend ListenerEvent::ListenerNotFound.
 */
export const ListenerNotFoundEventSchema = S.Struct({
  roomId: S.String,
  type: S.Literal("listenerNotFound")
})

// Individual Listener Event Types
export type ListenerTransportReadyEvent = S.Schema.Type<typeof ListenerTransportReadyEventSchema>
export type JoinReadyEvent = S.Schema.Type<typeof JoinReadyEventSchema>
export type ListenerTransportConnectedEvent = S.Schema.Type<typeof ListenerTransportConnectedEventSchema>
export type ConsumerCreatedEvent = S.Schema.Type<typeof ConsumerCreatedEventSchema>
export type RouterCapabilitiesEvent = S.Schema.Type<typeof RouterCapabilitiesEventSchema>
export type ListenerCountUpdatedEvent = S.Schema.Type<typeof ListenerCountUpdatedEventSchema>
export type ListenerStreamPausedEvent = S.Schema.Type<typeof ListenerStreamPausedEventSchema>
export type ListenerStreamResumedEvent = S.Schema.Type<typeof ListenerStreamResumedEventSchema>
export type ListenerRoomClosedEvent = S.Schema.Type<typeof ListenerRoomClosedEventSchema>
export type ListenerCommandFailedEvent = S.Schema.Type<typeof ListenerCommandFailedEventSchema>
export type ListenerRoomNotFoundEvent = S.Schema.Type<typeof ListenerRoomNotFoundEventSchema>
export type PongEvent = S.Schema.Type<typeof PongEventSchema>
export type ListenerNotFoundEvent = S.Schema.Type<typeof ListenerNotFoundEventSchema>

/**
 * Listener Event Union Schema with discriminated type field
 */
export const ListenerEventSchema = S.Union(
  ListenerTransportReadyEventSchema,
  JoinReadyEventSchema,
  ListenerTransportConnectedEventSchema,
  ConsumerCreatedEventSchema,
  RouterCapabilitiesEventSchema,
  ListenerCountUpdatedEventSchema,
  ListenerStreamPausedEventSchema,
  ListenerStreamResumedEventSchema,
  ListenerRoomClosedEventSchema,
  ListenerCommandFailedEventSchema,
  ListenerRoomNotFoundEventSchema,
  PongEventSchema,
  ListenerNotFoundEventSchema
)

/**
 * Master WebSocket Event Union Schema
 * 
 * Contains all DJ, Lobby, and Listener events with discriminated type field.
 * Use this for single-decode operations in WebSocket message processing.
 */
export const WebSocketEventSchema = S.Union(
  LobbyEventSchema,
  DJEventSchema,
  ListenerEventSchema
)

export type WebSocketEvent = S.Schema.Type<typeof WebSocketEventSchema>

// Individual Listener Command Schemas with default type fields
export const InitListenerCommandSchema = S.Struct({
  type: S.Literal("initListener").pipe(
    S.propertySignature,
    S.withConstructorDefault(() => "initListener" as const)
  )
})

export const GetRouterCapabilitiesCommandSchema = S.Struct({
  roomId: S.String,
  type: S.Literal("getRouterCapabilities").pipe(
    S.propertySignature,
    S.withConstructorDefault(() => "getRouterCapabilities" as const)
  )
})

export const ConnectListenerTransportCommandSchema = S.Struct({
  transportId: S.OptionFromNullOr(S.String),
  dtlsParameters: DtlsParametersTransformSchema,
  type: S.Literal("connectListenerTransport").pipe(
    S.propertySignature,
    S.withConstructorDefault(() => "connectListenerTransport" as const)
  )
})

export const RequestConsumerCommandSchema = S.Struct({
  rtpCapabilities: RtpCapabilitiesTransformSchema,
  type: S.Literal("requestConsumer").pipe(
    S.propertySignature,
    S.withConstructorDefault(() => "requestConsumer" as const)
  )
})

export const ResumeConsumerCommandSchema = S.Struct({
  consumerId: S.String,
  type: S.Literal("resumeConsumer").pipe(
    S.propertySignature,
    S.withConstructorDefault(() => "resumeConsumer" as const)
  )
})

export const LeaveRoomCommandSchema = S.Struct({
  type: S.Literal("leaveRoom").pipe(
    S.propertySignature,
    S.withConstructorDefault(() => "leaveRoom" as const)
  )
})

/**
 * Application-level heartbeat ping (no payload).
 * The server replies immediately with ListenerEvent::Pong.
 * Use fire-and-forget; do NOT add to getExpectedEventType — card 5 handles
 * the pong subscription via a dedicated subscribe path.
 */
export const PingCommandSchema = S.Struct({
  type: S.Literal("ping").pipe(
    S.propertySignature,
    S.withConstructorDefault(() => "ping" as const)
  )
})

// Individual Listener Command Types
export type InitListenerCommand = S.Schema.Type<typeof InitListenerCommandSchema>
export type GetRouterCapabilitiesCommand = S.Schema.Type<typeof GetRouterCapabilitiesCommandSchema>
export type ConnectListenerTransportCommand = S.Schema.Type<typeof ConnectListenerTransportCommandSchema>
export type RequestConsumerCommand = S.Schema.Type<typeof RequestConsumerCommandSchema>
export type ResumeConsumerCommand = S.Schema.Type<typeof ResumeConsumerCommandSchema>
export type LeaveRoomCommand = S.Schema.Type<typeof LeaveRoomCommandSchema>
export type PingCommand = S.Schema.Type<typeof PingCommandSchema>

/**
 * Listener Command Union Schema with proper transform handling
 * Each command schema handles type field transformation internally
 */
export const ListenerCommandSchema = S.Union(
  InitListenerCommandSchema,
  GetRouterCapabilitiesCommandSchema,
  ConnectListenerTransportCommandSchema,
  RequestConsumerCommandSchema,
  ResumeConsumerCommandSchema,
  LeaveRoomCommandSchema,
  PingCommandSchema
)

/**
 * Master WebSocket Command Union Schema
 * 
 * Contains all DJ, Lobby, and Listener commands with discriminated type field.
 * Use this for unified command processing in WebSocket operations.
 */
export const WebSocketCommandSchema = S.Union(
  LobbyCommandSchema,
  DJCommandSchema,
  ListenerCommandSchema
)

export type WebSocketCommand = S.Schema.Type<typeof WebSocketCommandSchema>

/**
 * Consolidated WebSocket Types for easy import
 */
export type WebSocketTypes = {

  // Message types
  LobbyCommand: LobbyCommandType
  LobbyEvent: LobbyEventType
  DJCommand: DJCommandType
  DJEvent: DJEventType
  ListenerCommand: ListenerCommandType
  ListenerEvent: ListenerEventType
}

/**
 * Command Validation Functions using Effect Schema
 *
 * These use the schema struct capabilities for full validation before sending.
 */
export const CommandValidators = {
  // Individual command validators - using specific schemas
  validateInitRoom: S.decodeUnknown(InitRoomCommandSchema),
  validateRequestConsumer: S.decodeUnknown(RequestConsumerCommandSchema),
  validateRequestJoin: S.decodeUnknown(RequestJoinCommandSchema)
}
