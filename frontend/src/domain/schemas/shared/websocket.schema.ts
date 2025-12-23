/**
 * WebSocket Schema Patterns
 *
 * Complete WebSocket schemas including connections, messages, and events.
 * Eliminates duplication and provides unified WebSocket handling across all domains.
 *
 * Uses S.Encoded vs S.Type pattern for proper boundary handling.
 */

import { Schema as S, Option as O } from 'effect'
import { WebSocketSchema } from './webapi.schema'
import { ConsumerOptionsSchema, ConsumerParametersTransformSchema, DtlsParametersSchema, DtlsParametersTransformSchema, IceCandidateSchema, RtpCapabilitiesSchema, RtpCapabilitiesTransformSchema, RtpParametersSchema, RtpParametersTransformSchema, TransportOptionsSchema, TransportOptionsTransformSchema } from './mediasoup.schema'

/**
 * Base WebSocket Connection States
 */
export const WSConnectionState = S.Literal(
  'disconnected',
  'connecting',
  'connected',
  'error',
  'reconnecting'
)
export type WSConnectionStateType = S.Schema.Type<typeof WSConnectionState>

/**
 * WebSocket Connection Quality Metrics
 *
 * Encoded (from API): Numbers as strings, timestamps as ISO strings
 * Type (internal): Numbers as numbers, timestamps as Date objects
 */
export const ConnectionQualitySchema = S.Struct({
  // Wire format uses string timestamps, internal uses Date objects
  timestamp: S.DateFromString, // Transform: ISO string → Date
  rtt: S.NumberFromString,     // Transform: string → number
  packetsLost: S.NumberFromString,
  packetsReceived: S.Option(S.NumberFromString), // Only for listeners
  jitter: S.NumberFromString,
  quality: S.Literal('excellent', 'good', 'fair', 'poor')
})
export type ConnectionQualityType = S.Schema.Type<typeof ConnectionQualitySchema>
export type ConnectionQualityEncoded = S.Schema.Encoded<typeof ConnectionQualitySchema>

/**
 * Base WebSocket Connection State Pattern
 *
 * Can be extended by domain-specific schemas with additional fields.
 * Handles the common pattern of connection tracking across all WebSocket types.
 */
export const BaseWebSocketConnectionSchema = S.Struct({
  websocket: S.Option(WebSocketSchema),
  connectionState: WSConnectionState,
  url: S.Option(S.String),
  connectedAt: S.Option(S.DateFromString), // Transform: ISO string → Date
  lastMessageAt: S.Option(S.DateFromString),
  messageCount: S.Number,
  connectionError: S.Option(S.String)
})
export type BaseWebSocketConnectionType = S.Schema.Type<typeof BaseWebSocketConnectionSchema>
export type BaseWebSocketConnectionEncoded = S.Schema.Encoded<typeof BaseWebSocketConnectionSchema>

/**
 * WebSocket Connection Statistics
 *
 * Used for debugging and monitoring WebSocket health across domains.
 */
export const WSConnectionStatsSchema = S.Struct({
  totalConnections: S.Number,
  failedConnections: S.Number,
  reconnectAttempts: S.Number,
  averageConnectionTime: S.Number, // milliseconds
  lastFailureReason: S.Option(S.String),
  lastFailureAt: S.Option(S.DateFromString)
})
export type WSConnectionStatsType = S.Schema.Type<typeof WSConnectionStatsSchema>
export type WSConnectionStatsEncoded = S.Schema.Encoded<typeof WSConnectionStatsSchema>

/**
 * WebSocket Message Metadata Pattern
 *
 * Standard structure for message history and debugging across all WebSocket types.
 */
export const WSMessageMetadataSchema = S.Struct({
  timestamp: S.DateFromString, // Transform: ISO string → Date
  direction: S.Literal('incoming', 'outgoing'),
  type: S.String,
  size: S.Number, // bytes
  success: S.Boolean
})
export type WSMessageMetadataType = S.Schema.Type<typeof WSMessageMetadataSchema>
export type WSMessageMetadataEncoded = S.Schema.Encoded<typeof WSMessageMetadataSchema>

/**
 * WebSocket Error Schema
 *
 * Structured error information for WebSocket failures with recovery context.
 */
export const WSErrorSchema = S.Struct({
  code: S.Number, // WebSocket close code
  reason: S.String,
  wasClean: S.Boolean,
  timestamp: S.DateFromString,
  recoverable: S.Boolean,
  retryAfter: S.Option(S.Number) // milliseconds
})
export type WSErrorType = S.Schema.Type<typeof WSErrorSchema>
export type WSErrorEncoded = S.Schema.Encoded<typeof WSErrorSchema>

/**
 * Domain-Specific WebSocket Extensions
 *
 * Utility schemas for extending the base connection with domain-specific fields.
 */

/**
 * DJ WebSocket Extension (adds streaming-specific fields)
 */
export const DJWebSocketExtensionSchema = S.Struct({
  roomId: S.Option(S.String),
  streamingStartedAt: S.Option(S.DateFromString),
  producerIds: S.Array(S.String)
})
export type DJWebSocketExtensionType = S.Schema.Type<typeof DJWebSocketExtensionSchema>

/**
 * Listener WebSocket Extension (adds consumption-specific fields)
 */
export const ListenerWebSocketExtensionSchema = S.Struct({
  roomId: S.Option(S.String),
  sessionId: S.String,
  listeningStartedAt: S.Option(S.DateFromString),
  consumerIds: S.Array(S.String)
})
export type ListenerWebSocketExtensionType = S.Schema.Type<typeof ListenerWebSocketExtensionSchema>

/**
 * Lobby WebSocket Extension (adds discovery-specific fields)
 */
export const LobbyWebSocketExtensionSchema = S.Struct({
  lastRoomListUpdate: S.Option(S.DateFromString),
  subscriptionFilters: S.Array(S.String)
})
export type LobbyWebSocketExtensionType = S.Schema.Type<typeof LobbyWebSocketExtensionSchema>


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
  })
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
  })
})

export const RoomRemovedEventSchema = S.Struct({
  roomId: S.String
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
  }))
})

// Individual Lobby Event Types
export type RoomAddedEvent = S.Schema.Type<typeof RoomAddedEventSchema>
export type RoomUpdatedEvent = S.Schema.Type<typeof RoomUpdatedEventSchema>
export type RoomRemovedEvent = S.Schema.Type<typeof RoomRemovedEventSchema>
export type JoinRoomResponseEvent = S.Schema.Type<typeof JoinRoomResponseEventSchema>

/**
 * Lobby Event Union Schema with discriminator for wire format
 * Uses attachPropertySignature to add 'type' field only in encoded format
 */
export const LobbyEventSchema = S.Union(
  RoomAddedEventSchema.pipe(S.attachPropertySignature("type", "roomAdded")),
  RoomUpdatedEventSchema.pipe(S.attachPropertySignature("type", "roomUpdated")),
  RoomRemovedEventSchema.pipe(S.attachPropertySignature("type", "roomRemoved")),
  JoinRoomResponseEventSchema.pipe(S.attachPropertySignature("type", "joinRoomResponse"))
)

// Individual Lobby Command Schemas for specific type safety
export const AnnounceRoomCommandSchema = S.Struct({
  name: S.String,
  djName: S.String,
  sessionId: S.String,
  description: S.Option(S.String),
  tags: S.Array(S.String)
})

export const RequestJoinCommandSchema = S.Struct({
  roomId: S.String,
  sessionId: S.String
})

export const RefreshRoomsCommandSchema = S.Struct({
})

// Individual Lobby Command Types
export type AnnounceRoomCommand = S.Schema.Type<typeof AnnounceRoomCommandSchema>
export type RequestJoinCommand = S.Schema.Type<typeof RequestJoinCommandSchema>
export type RefreshRoomsCommand = S.Schema.Type<typeof RefreshRoomsCommandSchema>

/**
 * Lobby Command Union Schema with discriminator for wire format
 * Uses attachPropertySignature to add 'type' field only in encoded format
 */
export const LobbyCommandSchema = S.Union(
  AnnounceRoomCommandSchema.pipe(S.attachPropertySignature("type", "announceRoom")),
  RequestJoinCommandSchema.pipe(S.attachPropertySignature("type", "requestJoin")),
  RefreshRoomsCommandSchema.pipe(S.attachPropertySignature("type", "refreshRooms"))
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
  wsUrl: S.String
})

export const RoomInitializedEventSchema = S.Struct({
  roomId: S.String,
  rtpCapabilities: RtpCapabilitiesTransformSchema
})

export const DjTransportReadyEventSchema = S.Struct({
  transportOptions: TransportOptionsTransformSchema
})

export const TransportConnectedEventSchema = S.Struct({
  transportId: S.String
})

export const ProducerCreatedEventSchema = S.Struct({
  producerId: S.String,
  roomId: S.String
})

export const StreamPausedEventSchema = S.Struct({
  roomId: S.String
})

export const StreamResumedEventSchema = S.Struct({
  roomId: S.String
})

export const RoomClosedEventSchema = S.Struct({
  roomId: S.String,
  reason: S.String
})

export const DJCommandFailedEventSchema = S.Struct({
  command: S.String,
  error: S.String
})

export const RoomNotFoundEventSchema = S.Struct({
  roomId: S.String
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
 * DJ Event Union Schema with discriminator for wire format
 * Uses attachPropertySignature to add 'type' field only in encoded format
 */
export const DJEventSchema = S.Union(
  RoomAnnouncedEventSchema.pipe(S.attachPropertySignature("type", "roomAnnounced")),
  RoomInitializedEventSchema.pipe(S.attachPropertySignature("type", "roomInitialized")),
  DjTransportReadyEventSchema.pipe(S.attachPropertySignature("type", "djTransportReady")),
  TransportConnectedEventSchema.pipe(S.attachPropertySignature("type", "transportConnected")),
  ProducerCreatedEventSchema.pipe(S.attachPropertySignature("type", "producerCreated")),
  StreamPausedEventSchema.pipe(S.attachPropertySignature("type", "streamPaused")),
  StreamResumedEventSchema.pipe(S.attachPropertySignature("type", "streamResumed")),
  RoomClosedEventSchema.pipe(S.attachPropertySignature("type", "roomClosed")),
  DJCommandFailedEventSchema.pipe(S.attachPropertySignature("type", "commandFailed")),
  RoomNotFoundEventSchema.pipe(S.attachPropertySignature("type", "roomNotFound"))
)


// Individual DJ Command Schemas for specific type safety
export const InitRoomCommandSchema = S.Struct({
  roomId: S.String
})

export const RequestDjTransportCommandSchema = S.Struct({
})

export const ConnectDjTransportCommandSchema = S.Struct({
  transportId: S.Option(S.String),
  dtlsParameters: DtlsParametersTransformSchema
})

export const ProduceCommandSchema = S.Struct({
  rtpParameters: RtpParametersTransformSchema
})

export const PauseStreamCommandSchema = S.Struct({
})

export const ResumeStreamCommandSchema = S.Struct({
})

export const CloseRoomCommandSchema = S.Struct({
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
 * DJ Command Union Schema with discriminator for wire format
 * Uses attachPropertySignature to add 'type' field only in encoded format
 */
export const DJCommandSchema = S.Union(
  InitRoomCommandSchema.pipe(S.attachPropertySignature("type", "initRoom")),
  RequestDjTransportCommandSchema.pipe(S.attachPropertySignature("type", "requestDjTransport")),
  ConnectDjTransportCommandSchema.pipe(S.attachPropertySignature("type", "connectDjTransport")),
  ProduceCommandSchema.pipe(S.attachPropertySignature("type", "produce")),
  PauseStreamCommandSchema.pipe(S.attachPropertySignature("type", "pauseStream")),
  ResumeStreamCommandSchema.pipe(S.attachPropertySignature("type", "resumeStream")),
  CloseRoomCommandSchema.pipe(S.attachPropertySignature("type", "closeRoom"))
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
  transportOptions: TransportOptionsTransformSchema
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
  rtpCapabilities: RtpCapabilitiesTransformSchema
})

export const ListenerTransportConnectedEventSchema = S.Struct({
  transportId: S.String
})

export const ConsumerCreatedEventSchema = S.Struct({
  consumerId: S.String,
  producerId: S.String,
  consumerParameters: ConsumerParametersTransformSchema
})

export const RouterCapabilitiesEventSchema = S.Struct({
  roomId: S.String,
  rtpCapabilities: RtpCapabilitiesTransformSchema
})

export const ListenerCountUpdatedEventSchema = S.Struct({
  roomId: S.String,
  count: S.Number
})

export const ListenerStreamPausedEventSchema = S.Struct({
  roomId: S.String
})

export const ListenerStreamResumedEventSchema = S.Struct({
  roomId: S.String
})

export const ListenerRoomClosedEventSchema = S.Struct({
  roomId: S.String,
  reason: S.String
})

export const ListenerCommandFailedEventSchema = S.Struct({
  command: S.String,
  error: S.String
})

export const ListenerRoomNotFoundEventSchema = S.Struct({
  roomId: S.String
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
 * Listener Event Union Schema with discriminator for wire format
 * Uses attachPropertySignature to add 'type' field only in encoded format
 */
export const ListenerEventSchema = S.Union(
  ListenerTransportReadyEventSchema.pipe(S.attachPropertySignature("type", "listenerTransportReady")),
  JoinReadyEventSchema.pipe(S.attachPropertySignature("type", "joinReady")),
  ListenerTransportConnectedEventSchema.pipe(S.attachPropertySignature("type", "transportConnected")),
  ConsumerCreatedEventSchema.pipe(S.attachPropertySignature("type", "consumerCreated")),
  RouterCapabilitiesEventSchema.pipe(S.attachPropertySignature("type", "routerCapabilities")),
  ListenerCountUpdatedEventSchema.pipe(S.attachPropertySignature("type", "listenerCountUpdated")),
  ListenerStreamPausedEventSchema.pipe(S.attachPropertySignature("type", "streamPaused")),
  ListenerStreamResumedEventSchema.pipe(S.attachPropertySignature("type", "streamResumed")),
  ListenerRoomClosedEventSchema.pipe(S.attachPropertySignature("type", "roomClosed")),
  ListenerCommandFailedEventSchema.pipe(S.attachPropertySignature("type", "commandFailed")),
  ListenerRoomNotFoundEventSchema.pipe(S.attachPropertySignature("type", "roomNotFound"))
)


// Individual Listener Command Schemas for specific type safety
export const InitListenerCommandSchema = S.Struct({
})

export const GetRouterCapabilitiesCommandSchema = S.Struct({
  roomId: S.String
})

export const ConnectListenerTransportCommandSchema = S.Struct({
  transportId: S.Option(S.String),
  dtlsParameters: DtlsParametersTransformSchema
})

export const RequestConsumerCommandSchema = S.Struct({
  rtpCapabilities: RtpCapabilitiesTransformSchema
})

export const ResumeConsumerCommandSchema = S.Struct({
  consumerId: S.String
})

export const LeaveRoomCommandSchema = S.Struct({
})

// Individual Listener Command Types
export type InitListenerCommand = S.Schema.Type<typeof InitListenerCommandSchema>
export type GetRouterCapabilitiesCommand = S.Schema.Type<typeof GetRouterCapabilitiesCommandSchema>
export type ConnectListenerTransportCommand = S.Schema.Type<typeof ConnectListenerTransportCommandSchema>
export type RequestConsumerCommand = S.Schema.Type<typeof RequestConsumerCommandSchema>
export type ResumeConsumerCommand = S.Schema.Type<typeof ResumeConsumerCommandSchema>
export type LeaveRoomCommand = S.Schema.Type<typeof LeaveRoomCommandSchema>

/**
 * Listener Command Union Schema with discriminator for wire format
 * Uses attachPropertySignature to add 'type' field only in encoded format
 */
export const ListenerCommandSchema = S.Union(
  InitListenerCommandSchema.pipe(S.attachPropertySignature("type", "initListener")),
  GetRouterCapabilitiesCommandSchema.pipe(S.attachPropertySignature("type", "getRouterCapabilities")),
  ConnectListenerTransportCommandSchema.pipe(S.attachPropertySignature("type", "connectListenerTransport")),
  RequestConsumerCommandSchema.pipe(S.attachPropertySignature("type", "requestConsumer")),
  ResumeConsumerCommandSchema.pipe(S.attachPropertySignature("type", "resumeConsumer")),
  LeaveRoomCommandSchema.pipe(S.attachPropertySignature("type", "leaveRoom"))
)



/**
 * Consolidated WebSocket Schemas for easy import
 */
export const WebSocketSchemas = {
  // Connection patterns
  ConnectionState: WSConnectionState,
  ConnectionQuality: ConnectionQualitySchema,
  BaseConnection: BaseWebSocketConnectionSchema,
  ConnectionStats: WSConnectionStatsSchema,
  MessageMetadata: WSMessageMetadataSchema,
  Error: WSErrorSchema,

  // Domain extensions
  DJExtension: DJWebSocketExtensionSchema,
  ListenerExtension: ListenerWebSocketExtensionSchema,
  LobbyExtension: LobbyWebSocketExtensionSchema,

  // Transport options
  TransportOptions: TransportOptionsSchema,

  // Individual command and event schemas are exported separately above
}

/**
 * Consolidated WebSocket Types for easy import
 */
export type WebSocketTypes = {
  // Connection patterns
  ConnectionState: WSConnectionStateType
  ConnectionQuality: ConnectionQualityType
  BaseConnection: BaseWebSocketConnectionType
  ConnectionStats: WSConnectionStatsType
  MessageMetadata: WSMessageMetadataType
  Error: WSErrorType

  // Domain extensions
  DJExtension: DJWebSocketExtensionType
  ListenerExtension: ListenerWebSocketExtensionType
  LobbyExtension: LobbyWebSocketExtensionType

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
