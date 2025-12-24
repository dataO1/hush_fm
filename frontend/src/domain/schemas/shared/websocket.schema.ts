/**
 * WebSocket Schema Patterns
 *
 * Complete WebSocket schemas including connections, messages, and events.
 * Eliminates duplication and provides unified WebSocket handling across all domains.
 *
 * Uses S.Encoded vs S.Type pattern for proper boundary handling.
 */

import { Schema as S } from 'effect'
import { ConsumerParametersTransformSchema, DtlsParametersTransformSchema, RtpCapabilitiesTransformSchema, RtpParametersTransformSchema, TransportOptionsTransformSchema } from './mediasoup.schema'

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
  | S.Schema.Type<typeof RoomAddedEventSchema>
  | S.Schema.Type<typeof RoomUpdatedEventSchema>
  | S.Schema.Type<typeof RoomRemovedEventSchema>
  | S.Schema.Type<typeof JoinRoomResponseEventSchema>

// Individual Lobby Event Schemas for specific type safety
export const RoomAddedEventSchema = S.Struct({
  room: S.Struct({
    id: S.String,
    name: S.String,
    djName: S.String,
    djId: S.String,
    listenerCount: S.Number,
    isStreaming: S.Boolean,
    createdAt: S.String,
    description: S.optional(S.String),
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
    description: S.optional(S.String),
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
  error: S.Option(S.String),
  listenerWebSocketUrl: S.Option(S.String),
  room: S.Option(S.Struct({
    id: S.String,
    name: S.String,
    djName: S.String,
    djId: S.String,
    listenerCount: S.Number,
    isStreaming: S.Boolean,
    createdAt: S.String,
    description: S.optional(S.String),
    tags: S.Array(S.String)
  })),
  type: S.Literal("joinRoomResponse")
})

// Individual Lobby Event Types
export type RoomAddedEvent = S.Schema.Type<typeof RoomAddedEventSchema>
export type RoomUpdatedEvent = S.Schema.Type<typeof RoomUpdatedEventSchema>
export type RoomRemovedEvent = S.Schema.Type<typeof RoomRemovedEventSchema>
export type JoinRoomResponseEvent = S.Schema.Type<typeof JoinRoomResponseEventSchema>

/**
 * Lobby Event Union Schema with discriminated type field
 */
export const LobbyEventSchema = S.Union(
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
  description: S.Option(S.String),
  tags: S.Array(S.String),
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
  | S.Schema.Type<typeof RoomAnnouncedEventSchema>
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
export const RoomAnnouncedEventSchema = S.Struct({
  room: S.Struct({
    id: S.String,
    name: S.String,
    djName: S.String,
    djId: S.String,
    listenerCount: S.Number,
    isStreaming: S.Boolean,
    createdAt: S.String,
    description: S.optional(S.String),
    tags: S.Array(S.String)
  }),
  wsUrl: S.String,
  type: S.Literal("roomAnnounced")
})

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
export type RoomAnnouncedEvent = S.Schema.Type<typeof RoomAnnouncedEventSchema>
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
  RoomAnnouncedEventSchema,
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
  transportId: S.Option(S.String),
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
    description: S.optional(S.String),
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
  ListenerRoomNotFoundEventSchema
)


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
  transportId: S.Option(S.String),
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

// Individual Listener Command Types
export type InitListenerCommand = S.Schema.Type<typeof InitListenerCommandSchema>
export type GetRouterCapabilitiesCommand = S.Schema.Type<typeof GetRouterCapabilitiesCommandSchema>
export type ConnectListenerTransportCommand = S.Schema.Type<typeof ConnectListenerTransportCommandSchema>
export type RequestConsumerCommand = S.Schema.Type<typeof RequestConsumerCommandSchema>
export type ResumeConsumerCommand = S.Schema.Type<typeof ResumeConsumerCommandSchema>
export type LeaveRoomCommand = S.Schema.Type<typeof LeaveRoomCommandSchema>

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
  LeaveRoomCommandSchema
)

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
