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
import type { RoomInfo, DtlsParametersSchema, DtlsFingerprintSchema } from '../generated/api.schemas'

// Re-export the generated schema types for WebSocket usage
export type DtlsParameters = DtlsParametersSchema
export type DtlsFingerprint = DtlsFingerprintSchema

/**
 * Trace context for distributed tracing (W3C Trace Context)
 * Internal representation with Option types for Effect-TS compatibility
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
      type: 'connectTransport'
      /** DTLS parameters for WebRTC transport connection */
      dtlsParameters: DtlsParameters
      /** Trace context for request tracing */
      _traceContext: SerializedTraceContext
    }
  | {
      type: 'produce'
      /** RTP parameters for media production */
      rtpParameters: any
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
      type: 'joinRoom'
      /** ID of the room to join */
      roomId: string
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
      consumerParameters: any
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
      type: 'roomJoined'
      /** Room information */
      room: Room
      /** Transport options for WebRTC connection */
      transportOptions: any
      /** Producer ID to consume from (if available) */
      producerId?: string
      /** RTP capabilities for consuming */
      rtpCapabilities: any
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
  return ['connectTransport', 'produce', 'pauseStream', 'resumeStream', 'closeRoom', 'joinRoom', 'connectListenerTransport', 'consumeAudio', 'leaveRoom'].includes(message.type)
}

export const isServerEvent = (message: WebSocketMessage): message is ServerEvent => {
  return ['transportReady', 'transportConnected', 'producerCreated', 'consumerCreated', 'streamPaused', 'streamResumed', 'roomJoined', 'roomClosed', 'listenerCountUpdated', 'commandFailed', 'authenticationError', 'roomNotFound'].includes(message.type)
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