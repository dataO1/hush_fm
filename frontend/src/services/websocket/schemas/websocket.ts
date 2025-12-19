/**
 * WebSocket Models - Backend Alignment
 *
 * These types match the refactored backend Rust models exactly.
 * Events are split into role-based categories: Lobby, DJ, and Listener.
 * Trace context has been completely removed as per backend refactoring.
 *
 * @see /home/data01/Projects/hushfm/backend/src/lib/models/events.rs
 * @see /home/data01/Projects/hushfm/backend/src/lib/models/commands.rs
 */

import { types } from 'mediasoup-client'
import type {
  RoomInfo,
  TransportOptions as ApiTransportOptions,
  RtpCapabilitiesWrapper,
  ConsumerParameters
} from '../../generated/hushFMAPI.schemas'

/**
 * Room type - use RoomInfo directly from generated API
 */
export type { RoomInfo }

/**
 * DTLS parameters in JSON format (matches MediaSoup client output)
 */
export interface DtlsParametersJson {
  /** DTLS role as string: "auto", "client", or "server" */
  role: string
  /** DTLS fingerprints array */
  fingerprints: Array<{
    /** Hash algorithm name (e.g., "sha-256") */
    algorithm: string
    /** Fingerprint value as colon-separated hex string */
    value: string
  }>
}

/**
 * Lobby Commands - sent from lobby clients to server
 */
export type LobbyCommand = 
  | {
      type: 'announceRoom'
      /** Name of the room to create */
      name: string
      /** DJ name for the room */
      djName: string
      /** Optional room description */
      description?: string
      /** Optional room tags */
      tags?: string[]
    }
  | {
      type: 'requestJoin'
      /** Stable session ID from browser fingerprint */
      sessionId: string
      /** ID of the room to join */
      roomId: string
    }

/**
 * DJ Commands - sent from DJ clients to server
 */
export type DjCommand =
  | {
      type: 'initRoom'
      /** ID of the room to initialize */
      roomId: string
    }
  | {
      type: 'requestDjTransport'
    }
  | {
      type: 'connectDjTransport'
      /** Transport ID for connection validation */
      transportId?: string
      /** DTLS parameters for WebRTC transport connection */
      dtlsParameters: DtlsParametersJson
    }
  | {
      type: 'produce'
      /** RTP parameters for media production */
      rtpParameters: any // Will be RtpParameters from MediaSoup
    }
  | {
      type: 'pauseStream'
    }
  | {
      type: 'resumeStream'
    }
  | {
      type: 'closeRoom'
    }

/**
 * Listener Commands - sent from listener clients to server
 */
export type ListenerCommand =
  | {
      type: 'initListener'
    }
  | {
      type: 'connectListenerTransport'
      /** Transport ID for connection validation */
      transportId?: string
      /** DTLS parameters for WebRTC transport connection */
      dtlsParameters: DtlsParametersJson
    }
  | {
      type: 'getRouterCapabilities'
      /** ID of the room to get capabilities for */
      roomId: string
    }
  | {
      type: 'leaveRoom'
    }
  | {
      type: 'requestConsumer'
      /** Device RTP capabilities for consumer creation */
      rtpCapabilities: any // Will be RtpCapabilities from MediaSoup
    }
  | {
      type: 'resumeConsumer'
      /** ID of the consumer to resume */
      consumerId: string
    }

/**
 * Lobby Events - broadcast to all lobby clients
 */
export type LobbyEvent =
  | {
      type: 'roomAdded'
      /** Information about the new room */
      room: RoomInfo
    }
  | {
      type: 'roomUpdated'
      /** Updated room information */
      room: RoomInfo
    }
  | {
      type: 'roomRemoved'
      /** ID of the removed room */
      roomId: string
    }
  | {
      type: 'joinRoomResponse'
      /** Session ID that requested the join */
      sessionId: string
      /** ID of the room being joined */
      roomId: string
      /** Whether the join request was successful */
      success: boolean
      /** Error message if join failed */
      error?: string
      /** Unique WebSocket URL for listener connection (if successful) */
      listenerWebSocketUrl?: string
      /** Room information (if successful) */
      room?: RoomInfo
    }

/**
 * DJ Events - sent from server to DJ clients
 */
export type DjEvent =
  | {
      type: 'roomAnnounced'
      /** Created room information */
      room: RoomInfo
      /** WebSocket URL for DJ room connection */
      wsUrl: string
    }
  | {
      type: 'roomInitialized'
      /** ID of the initialized room */
      roomId: string
      /** RTP capabilities for device initialization */
      rtpCapabilities: RtpCapabilitiesWrapper
    }
  | {
      type: 'djTransportReady'
      /** Transport options for WebRTC connection */
      transportOptions: ApiTransportOptions
    }
  | {
      type: 'transportConnected'
      /** ID of the connected transport */
      transportId: string
    }
  | {
      type: 'producerCreated'
      /** ID of the created producer */
      producerId: string
      /** ID of the room where producer was created */
      roomId: string
    }
  | {
      type: 'streamPaused'
      /** ID of the room where stream was paused */
      roomId: string
    }
  | {
      type: 'streamResumed'
      /** ID of the room where stream was resumed */
      roomId: string
    }
  | {
      type: 'roomClosed'
      /** ID of the closed room */
      roomId: string
      /** Reason for closing */
      reason: string
    }
  | {
      type: 'commandFailed'
      /** The command that failed */
      command: string
      /** Error description */
      error: string
    }
  | {
      type: 'roomNotFound'
      /** ID of the room that wasn't found */
      roomId: string
    }

/**
 * Listener Events - sent from server to listener clients
 */
export type ListenerEvent =
  | {
      type: 'listenerTransportReady'
      /** Transport options for WebRTC connection */
      transportOptions: ApiTransportOptions
    }
  | {
      type: 'joinReady'
      /** Room information */
      room: RoomInfo
      /** Transport options for WebRTC connection */
      transportOptions: ApiTransportOptions
      /** Producer ID to consume from */
      producerId: string
      /** RTP capabilities for consuming */
      rtpCapabilities: RtpCapabilitiesWrapper
    }
  | {
      type: 'transportConnected'
      /** ID of the connected transport */
      transportId: string
    }
  | {
      type: 'consumerCreated'
      /** ID of the created consumer */
      consumerId: string
      /** ID of the producer being consumed */
      producerId: string
      /** Consumer parameters for WebRTC */
      consumerParameters: ConsumerParameters
    }
  | {
      type: 'routerCapabilities'
      /** ID of the room these capabilities are for */
      roomId: string
      /** Router RTP capabilities */
      rtpCapabilities: RtpCapabilitiesWrapper
    }
  | {
      type: 'listenerCountUpdated'
      /** ID of the room */
      roomId: string
      /** New listener count */
      count: number
    }
  | {
      type: 'streamPaused'
      /** ID of the room where stream was paused */
      roomId: string
    }
  | {
      type: 'streamResumed'
      /** ID of the room where stream was resumed */
      roomId: string
    }
  | {
      type: 'roomClosed'
      /** ID of the closed room */
      roomId: string
      /** Reason for closing */
      reason: string
    }
  | {
      type: 'commandFailed'
      /** The command that failed */
      command: string
      /** Error description */
      error: string
    }
  | {
      type: 'roomNotFound'
      /** ID of the room that wasn't found */
      roomId: string
    }

/**
 * Union types for all WebSocket messages by role
 */
export type WebSocketMessage = LobbyCommand | DjCommand | ListenerCommand | LobbyEvent | DjEvent | ListenerEvent

/**
 * Type guards for message discrimination
 */
export const isLobbyCommand = (message: WebSocketMessage): message is LobbyCommand => {
  return ['announceRoom', 'requestJoin'].includes(message.type)
}

export const isDjCommand = (message: WebSocketMessage): message is DjCommand => {
  return ['initRoom', 'requestDjTransport', 'connectDjTransport', 'produce', 'pauseStream', 'resumeStream', 'closeRoom'].includes(message.type)
}

export const isListenerCommand = (message: WebSocketMessage): message is ListenerCommand => {
  return ['initListener', 'connectListenerTransport', 'getRouterCapabilities', 'leaveRoom', 'requestConsumer', 'resumeConsumer'].includes(message.type)
}

export const isLobbyEvent = (message: WebSocketMessage): message is LobbyEvent => {
  return ['roomAdded', 'roomUpdated', 'roomRemoved', 'joinRoomResponse'].includes(message.type)
}

export const isDjEvent = (message: WebSocketMessage): message is DjEvent => {
  return ['roomAnnounced', 'roomInitialized', 'djTransportReady', 'transportConnected', 'producerCreated', 'streamPaused', 'streamResumed', 'roomClosed', 'commandFailed', 'roomNotFound'].includes(message.type)
}

export const isListenerEvent = (message: WebSocketMessage): message is ListenerEvent => {
  return ['listenerTransportReady', 'joinReady', 'transportConnected', 'consumerCreated', 'routerCapabilities', 'listenerCountUpdated', 'streamPaused', 'streamResumed', 'roomClosed', 'commandFailed', 'roomNotFound'].includes(message.type)
}

/**
 * Type conversion schemas using Effect's Brand system
 * These convert between API wrapper types and native MediaSoup client types
 */

// Transport options conversion
export const TransportOptionsFromApi = {
  decode: (api: ApiTransportOptions): InternalTransportOptions => ({
    id: api.id,
    dtlsParameters: api.dtlsParameters,
    iceParameters: api.iceParameters,
    iceCandidates: api.iceCandidates.map(candidate => {
      const mediasoupCandidate: any = {
        foundation: candidate.foundation,
        priority: candidate.priority,
        address: candidate.address,
        ip: candidate.address, // deprecated but required by mediasoup-client
        protocol: candidate.protocol, // already lowercase from backend
        port: candidate.port,
        type: candidate.type // already lowercase from backend
      }
      
      // Only set tcpType if tcp_type is not null (TCP candidates only)
      // Convert: tcp_type → tcpType, "Passive" → "passive" 
      if (candidate.tcp_type !== null && candidate.tcp_type !== undefined) {
        mediasoupCandidate.tcpType = candidate.tcp_type.toLowerCase() as 'passive'
      }
      // For UDP candidates (tcp_type is null), we omit tcpType entirely
      
      return mediasoupCandidate
    }),
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

// RTP capabilities conversion with proper type safety and defensive coding
export const RtpCapabilitiesFromApi = {
  decode: (api: RtpCapabilitiesWrapper): types.RtpCapabilities => {
    console.log(`🔧 RtpCapabilitiesFromApi.decode() input:`, api)
    
    // Defensive validation
    if (!api) {
      console.error('🚨 RtpCapabilitiesFromApi.decode() - api is null/undefined')
      throw new Error('RTP capabilities API data is null or undefined')
    }
    
    if (!api.codecs) {
      console.error('🚨 RtpCapabilitiesFromApi.decode() - api.codecs is missing:', api)
      throw new Error('RTP capabilities missing codecs array')
    }
    
    if (!Array.isArray(api.codecs)) {
      console.error('🚨 RtpCapabilitiesFromApi.decode() - api.codecs is not an array:', typeof api.codecs, api.codecs)
      throw new Error(`RTP capabilities codecs is not an array: ${typeof api.codecs}`)
    }
    
    if (!api.headerExtensions) {
      console.error('🚨 RtpCapabilitiesFromApi.decode() - api.headerExtensions is missing:', api)
      throw new Error('RTP capabilities missing headerExtensions array')
    }
    
    if (!Array.isArray(api.headerExtensions)) {
      console.error('🚨 RtpCapabilitiesFromApi.decode() - api.headerExtensions is not an array:', typeof api.headerExtensions, api.headerExtensions)
      throw new Error(`RTP capabilities headerExtensions is not an array: ${typeof api.headerExtensions}`)
    }
    
    console.log(`✅ RtpCapabilitiesFromApi.decode() - validation passed, processing ${api.codecs.length} codecs and ${api.headerExtensions.length} header extensions`)
    
    const result = {
      codecs: api.codecs.map((codec, index) => {
        console.log(`🎵 Processing codec ${index}:`, codec)
        return {
          kind: codec.kind as types.MediaKind,
          mimeType: codec.mimeType,
          preferredPayloadType: codec.preferredPayloadType ?? undefined, // Fix: Use ?? to preserve payload type 0
          clockRate: codec.clockRate,
          channels: codec.channels ?? 1, // Fix: Use ?? to preserve channels 0 if valid
          parameters: codec.parameters || {},
          rtcpFeedback: (codec.rtcpFeedback || []).map(fb => ({
            type: fb.type,
            parameter: fb.parameter ?? undefined // Fix: Use ?? to preserve empty string parameters
          }))
        }
      }),
      headerExtensions: api.headerExtensions.map((ext, index) => {
        console.log(`📡 Processing header extension ${index}:`, ext)
        return {
          kind: ext.kind as types.MediaKind,
          uri: ext.uri,
          preferredId: ext.preferredId,
          preferredEncrypt: ext.preferredEncrypt,
          direction: ext.direction as any // MediaSoup client types may be more restrictive
        }
      })
    } as types.RtpCapabilities
    
    console.log(`🎯 RtpCapabilitiesFromApi.decode() result:`, result)
    return result
  },
  encode: (native: types.RtpCapabilities): RtpCapabilitiesWrapper => ({
    codecs: (native.codecs || []).map(codec => ({
      kind: codec.kind,
      mimeType: codec.mimeType,
      preferredPayloadType: codec.preferredPayloadType ?? null, // Fix: Use ?? to preserve payload type 0
      clockRate: codec.clockRate,
      channels: codec.channels ?? 1, // Fix: Use ?? to preserve channels 0 if valid
      parameters: Object.fromEntries(
        Object.entries(codec.parameters || {}).map(([key, value]) => [key, String(value)])
      ),
      rtcpFeedback: (codec.rtcpFeedback || []).map(fb => ({
        type: fb.type,
        parameter: fb.parameter ?? null // Fix: Use ?? to preserve empty string parameters
      }))
    })),
    headerExtensions: (native.headerExtensions || []).map(ext => ({
      kind: ext.kind,
      uri: ext.uri,
      preferredId: ext.preferredId,
      preferredEncrypt: ext.preferredEncrypt || false,
      direction: ext.direction || 'sendrecv'
    }))
  })
}

// Consumer options conversion
export const ConsumerOptionsFromApi = {
  decode: (api: ConsumerParameters): ConsumerOptions => ({
    id: api.id,
    producerId: api.producerId,
    kind: api.kind as 'audio' | 'video',
    rtpParameters: api.rtpParameters as any,
    producerPaused: api.producerPaused ?? false
  }),
  encode: (native: ConsumerOptions): ConsumerParameters => ({
    id: native.id,
    producerId: native.producerId,
    kind: native.kind,
    rtpParameters: native.rtpParameters as any,
    type: 'simple',
    producerPaused: native.producerPaused ?? false
  })
}

/**
 * Internal types for native MediaSoup usage
 */
export interface InternalTransportOptions {
  id: string
  dtlsParameters: any  // Native MediaSoup client type
  iceParameters: any   // Native MediaSoup client type
  iceCandidates: any[] // Native MediaSoup client type
  sctpParameters?: any // Native MediaSoup client type
}

export interface ConsumerOptions {
  id: string
  producerId: string
  kind: 'audio' | 'video'
  rtpParameters: types.RtpParameters
  producerPaused?: boolean
}

// No legacy compatibility - use role-specific types only