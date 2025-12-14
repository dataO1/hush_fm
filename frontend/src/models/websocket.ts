/**
 * WebSocket Models - Single Source of Truth
 *
 * These types match the backend Rust models exactly.
 * All message types use camelCase with type tags for discriminated unions.
 * Uses Effect-TS Option types instead of null/undefined for better type safety.
 *
 * @see /home/data01/Projects/hushfm/backend/src/models/
 */

import { Option } from 'effect'
import { types } from 'mediasoup-client'
import type {
  RoomInfo,
  DtlsParametersWrapper,
  DtlsFingerprintWrapper,
  TransportOptions as ApiTransportOptions,
  RtpCapabilitiesWrapper,
  RtpParametersWrapper,
  ConsumerParameters as ApiConsumerParameters
} from '../generated/api.schemas'

// Use native MediaSoup types for WebSocket communication
export type DtlsParameters = DtlsParametersWrapper
export type DtlsFingerprint = DtlsFingerprintWrapper
export type RtpCapabilities = types.RtpCapabilities
export type RtpParameters = types.RtpParameters

/**
 * Internal trace context for Effect-TS compatibility
 * Uses Option types for safer null handling
 */
export interface TraceContext {
  /** W3C trace-parent header */
  traceparent: string
  /** W3C trace-state header */
  tracestate: Option.Option<string>
  /** Additional trace metadata */
  metadata: Option.Option<Record<string, string>>
}

/**
 * Serialized trace context for wire format
 * Matches backend Rust TraceContext structure exactly
 */
export interface SerializedTraceContext {
  /** W3C trace-parent header */
  traceparent: string
  /** Optional W3C trace-state header */
  tracestate?: string | null
  /** Optional trace metadata */
  metadata?: Record<string, string> | null
}

/**
 * Room type - re-export clean client model from generated API
 */
export type Room = RoomInfo

/**
 * Client-to-Server Commands
 *
 * Commands that clients can send to the server for WebRTC signaling and stream control.
 * Replaces the old DJMessage interface with proper typing for all command types.
 */
export type ClientCommand =
  // DJ Commands - Room Management
  | {
      type: 'connectDjTransport'
      /** DTLS parameters for WebRTC transport connection */
      dtlsParameters: DtlsParameters
      /** Trace context for request tracing */
      _traceContext: SerializedTraceContext
    }
  | {
      type: 'produce'
      /** RTP parameters for media production */
      rtpParameters: RtpParameters
      /** Trace context for request tracing */
      _traceContext: SerializedTraceContext
    }
  | {
      type: 'pauseStream'
      /** Trace context for request tracing */
      _traceContext: SerializedTraceContext
    }
  | {
      type: 'resumeStream'
      /** Trace context for request tracing */
      _traceContext: SerializedTraceContext
    }
  | {
      type: 'closeRoom'
      /** Trace context for request tracing */
      _traceContext: SerializedTraceContext
    }
  // Listener Commands - Audio Consumption
  | {
      type: 'getRouterCapabilities'
      /** ID of the room to get capabilities for */
      roomId: string
      /** Trace context for request tracing */
      _traceContext: SerializedTraceContext
    }
  | {
      type: 'requestJoin'
      /** ID of the room to join */
      roomId: string
      /** RTP capabilities for media consumption (native MediaSoup type) */
      rtpCapabilities: types.RtpCapabilities
      /** Trace context for request tracing */
      _traceContext: SerializedTraceContext
    }
  | {
      type: 'connectListenerTransport'
      /** DTLS parameters for WebRTC transport connection */
      dtlsParameters: DtlsParameters
      /** Trace context for request tracing */
      _traceContext: SerializedTraceContext
    }
  | {
      type: 'leaveRoom'
      /** Trace context for request tracing */
      _traceContext: SerializedTraceContext
    }
  | {
      type: 'requestConsumer'
      /** ID of the producer to consume from */
      producerId: string
      /** Trace context for request tracing */
      _traceContext: SerializedTraceContext
    }
  | {
      type: 'resumeConsumer'
      /** ID of the producer to consume from */
      consumerId: string
      /** Trace context for request tracing */
      _traceContext: SerializedTraceContext
    }

/**
 * Server-to-Client Events
 *
 * Events that the server sends to clients in response to commands or state changes.
 * Replaces the old ServerMessage interface with comprehensive event coverage.
 */
export type ServerEvent =
  // Connection Events
  | {
      type: 'transportReady'
      /** ID of the created transport */
      transportId: string
      /** Optional trace context for request tracing */
      _traceContext: Option.Option<TraceContext>
    }
  | {
      type: 'transportConnected'
      /** ID of the connected transport */
      transportId: string
      /** Optional trace context for request tracing */
      _traceContext: Option.Option<TraceContext>
    }
  // Production Events
  | {
      type: 'producerCreated'
      /** ID of the created producer */
      producerId: string
      /** ID of the room where producer was created */
      roomId: string
      /** Optional trace context for request tracing */
      _traceContext: Option.Option<TraceContext>
    }
  // Consumer Events
  | {
      type: 'consumerCreated'
      /** ID of the created consumer */
      consumerId: string
      /** ID of the producer being consumed */
      producerId: string
      /** Consumer parameters for WebRTC */
      consumerParameters: ApiConsumerParameters
      /** Optional trace context for request tracing */
      _traceContext: Option.Option<TraceContext>
    }
  // Stream Events
  | {
      type: 'streamPaused'
      /** ID of the room where stream was paused */
      roomId: string
      /** Optional trace context for request tracing */
      _traceContext: Option.Option<TraceContext>
    }
  | {
      type: 'streamResumed'
      /** ID of the room where stream was resumed */
      roomId: string
      /** Optional trace context for request tracing */
      _traceContext: Option.Option<TraceContext>
    }
  // Room Events
  | {
      type: 'routerCapabilities'
      /** ID of the room these capabilities are for */
      roomId: string
      /** Router RTP capabilities for device initialization (native MediaSoup type) */
      rtpCapabilities: types.RtpCapabilities
      /** Optional trace context for request tracing */
      _traceContext: Option.Option<TraceContext>
    }
  | {
      type: 'joinReady'
      /** Room information */
      room: Room
      /** Transport options for WebRTC connection */
      transportOptions: ApiTransportOptions
      /** Producer ID to consume from (guaranteed to exist) */
      producerId: string
      /** RTP capabilities for consuming (native MediaSoup type) */
      rtpCapabilities: types.RtpCapabilities
      /** Optional trace context for request tracing */
      _traceContext: Option.Option<TraceContext>
    }
  | {
      type: 'roomJoined'
      /** Room information */
      room: Room
      /** Transport options for WebRTC connection */
      transportOptions: ApiTransportOptions
      /** Producer ID to consume from (if available) */
      producerId?: string
      /** RTP capabilities for consuming (native MediaSoup type) */
      rtpCapabilities: types.RtpCapabilities
      /** Optional trace context for request tracing */
      _traceContext: Option.Option<TraceContext>
    }
  | {
      type: 'roomClosed'
      /** ID of the closed room */
      roomId: string
      /** Reason for closing */
      reason: string
      /** Optional trace context for request tracing */
      _traceContext: Option.Option<TraceContext>
    }
  | {
      type: 'listenerCountUpdated'
      /** ID of the room */
      roomId: string
      /** New listener count */
      count: number
      /** Optional trace context for request tracing */
      _traceContext: Option.Option<TraceContext>
    }
  // Error Events
  | {
      type: 'commandFailed'
      /** The command that failed */
      command: string
      /** Error description */
      error: string
      /** Optional trace context for request tracing */
      _traceContext: Option.Option<TraceContext>
    }
  | {
      type: 'authenticationError'
      /** Error message */
      message: string
      /** Optional trace context for request tracing */
      _traceContext: Option.Option<TraceContext>
    }
  | {
      type: 'roomNotFound'
      /** ID of the room that wasn't found */
      roomId: string
      /** Optional trace context for request tracing */
      _traceContext: Option.Option<TraceContext>
    }

/**
 * Lobby Events
 *
 * Events broadcast to all lobby clients about room changes.
 * Replaces the old BroadcastMessage interface.
 */
export type LobbyEvent =
  | {
      type: 'roomAdded'
      /** Information about the new room */
      room: Room
      /** Optional trace context for request tracing */
      _traceContext: Option.Option<TraceContext>
    }
  | {
      type: 'roomUpdated'
      /** Updated room information */
      room: Room
      /** Optional trace context for request tracing */
      _traceContext: Option.Option<TraceContext>
    }
  | {
      type: 'roomRemoved'
      /** ID of the removed room */
      roomId: string
      /** Optional trace context for request tracing */
      _traceContext: Option.Option<TraceContext>
    }

/**
 * Union type for all WebSocket messages
 */
export type WebSocketMessage = ClientCommand | ServerEvent | LobbyEvent

/**
 * Type guards for message discrimination
 */
export const isClientCommand = (message: WebSocketMessage): message is ClientCommand => {
  return ['connectDjTransport', 'produce', 'pauseStream', 'resumeStream', 'closeRoom', 'getRouterCapabilities', 'requestJoin', 'connectListenerTransport', 'leaveRoom', 'requestConsumer', 'resumeConsumer'].includes(message.type)
}

export const isServerEvent = (message: WebSocketMessage): message is ServerEvent => {
  return ['transportReady', 'transportConnected', 'producerCreated', 'consumerCreated', 'streamPaused', 'streamResumed', 'routerCapabilities', 'joinReady', 'roomJoined', 'roomClosed', 'listenerCountUpdated', 'commandFailed', 'authenticationError', 'roomNotFound'].includes(message.type)
}

export const isLobbyEvent = (message: WebSocketMessage): message is LobbyEvent => {
  return ['roomAdded', 'roomUpdated', 'roomRemoved'].includes(message.type)
}

/**
 * Message type mapping for legacy compatibility
 */
export const LEGACY_MESSAGE_MAPPING = {
  // Old DJMessage -> New ClientCommand
  'ConnectTransport': 'connectTransport',
  'Produce': 'produce',
  'StopProducing': 'pauseStream',
  'DeleteRoom': 'closeRoom',

  // Old ServerMessage -> New ServerEvent
  'ProducerCreated': 'producerCreated',
  'RoomDeleted': 'roomClosed',
  'ListenerJoined': 'listenerCountUpdated',
  'ListenerLeft': 'listenerCountUpdated',
  'Error': 'commandFailed',

  // Old BroadcastMessage -> New LobbyEvent
  'RoomAdded': 'roomAdded',
  'RoomUpdated': 'roomUpdated',
  'RoomRemoved': 'roomRemoved',
} as const

/**
 * Room Conversion Utilities
 *
 * Convert between API Room types and WebSocket Room types with proper Option handling
 */

/**
 * Note: Room type now directly uses the clean RoomInfo model from the API.
 * No conversion functions are needed since the backend now sends clean client models.
 */

/**
 * Type conversion schemas using Effect's Brand system
 * Similar to Rust's From/Into traits
 *
 * These convert between API wrapper types (used for WebSocket/HTTP communication)
 * and native MediaSoup client types (used internally)
 */

// Transport options conversion
export const TransportOptionsFromApi = {
  decode: (api: ApiTransportOptions): InternalTransportOptions => ({
    id: api.id,
    dtlsParameters: api.dtlsParameters,
    iceParameters: api.iceParameters,
    iceCandidates: api.iceCandidates,
    sctpParameters: api.sctpParameters
  }),
  encode: (native: InternalTransportOptions): ApiTransportOptions => ({
    id: native.id,
    dtlsParameters: native.dtlsParameters as any,
    iceParameters: native.iceParameters as any,
    iceCandidates: native.iceCandidates as any,
    sctpParameters: native.sctpParameters
  })
}

// RTP capabilities conversion
export const RtpCapabilitiesFromApi = {
  decode: (api: RtpCapabilitiesWrapper): types.RtpCapabilities => ({
    codecs: api.codecs as any,
    headerExtensions: api.headerExtensions as any
    // Note: fecMechanisms not present in MediaSoup RtpCapabilities
  }) as types.RtpCapabilities,
  encode: (native: types.RtpCapabilities): RtpCapabilitiesWrapper => ({
    codecs: native.codecs as any,
    headerExtensions: native.headerExtensions as any,
    fecMechanisms: [] // Always empty for MediaSoup
  })
}

// Consumer options conversion
export const ConsumerOptionsFromApi = {
  decode: (api: ApiConsumerParameters): InternalConsumerOptions => ({
    id: api.id,
    producerId: api.producerId,
    kind: api.kind as 'audio' | 'video',
    rtpParameters: api.rtpParameters as any,
    producerPaused: api.producerPaused ?? false
  }),
  encode: (native: InternalConsumerOptions): ApiConsumerParameters => ({
    id: native.id,
    producerId: native.producerId,
    kind: native.kind,
    rtpParameters: native.rtpParameters as any,
    type: 'simple',
    producerPaused: native.producerPaused ?? false
  })
}

// RTP parameters conversion for WebSocket communication
export const RtpParametersFromApi = {
  decode: (api: RtpParametersWrapper): types.RtpParameters => ({
    mid: api.mid || undefined,
    codecs: api.codecs as any,
    headerExtensions: api.headerExtensions as any,
    encodings: api.encodings as any,
    rtcp: api.rtcp as any
  }) as types.RtpParameters,
  encode: (native: types.RtpParameters): RtpParametersWrapper => ({
    mid: native.mid || null,
    codecs: native.codecs as any,
    headerExtensions: native.headerExtensions as any,
    encodings: native.encodings as any,
    rtcp: native.rtcp as any
  })
}

/**
 * Internal types for native MediaSoup usage
 * These match MediaSoup client expectations exactly
 */
export interface InternalTransportOptions {
  id: string
  dtlsParameters: any  // Native MediaSoup client type
  iceParameters: any   // Native MediaSoup client type
  iceCandidates: any[] // Native MediaSoup client type
  sctpParameters?: any // Native MediaSoup client type
}

export interface InternalConsumerOptions {
  id: string
  producerId: string
  kind: 'audio' | 'video'
  rtpParameters: types.RtpParameters
  producerPaused?: boolean
}
