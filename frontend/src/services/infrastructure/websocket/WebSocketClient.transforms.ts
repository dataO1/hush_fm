/**
 * WebSocket Transform Utilities
 * 
 * Transforms wire format data from WebSocket messages to native mediasoup-client types.
 * Uses Effect Schema transformations for type-safe conversion between JSON and MediaSoup objects.
 * 
 * Architecture:
 * - Wire format: JSON data with Option types (from backend)
 * - Native format: Actual mediasoup-client types for runtime use
 * 
 * All s.declare native types are imported from mediasoup.schema.ts as single source of truth.
 */

import { Schema as S, Option as O } from 'effect'

// Import the schemas from mediasoup schema as single source of truth
import { 
  ConsumerOptionsSchema,
  TransportOptionsSchema,
  IceCandidateSchema,
  RtpCapabilitiesSchema,
  RtpParametersSchema,
  DtlsParametersSchema
} from '../../../domain/schemas/shared/mediasoup.schema'

/**
 * =============================================================================
 * WebSocket Wire Format Schemas (from backend)
 * =============================================================================
 */

/**
 * Wire format RTP Parameters (from backend RtpParametersWrapper)
 * Backend uses serde_json::Value for complex nested structures
 */
const WireRtpParametersSchema = S.Struct({
  mid: S.Option(S.String), // Backend: Option<String>
  codecs: S.mutable(S.Array(S.Unknown)), // Backend: Vec<serde_json::Value>
  headerExtensions: S.mutable(S.Array(S.Unknown)), // Backend: header_extensions → headerExtensions (Vec<serde_json::Value>)
  encodings: S.mutable(S.Array(S.Unknown)), // Backend: Vec<serde_json::Value>
  rtcp: S.Option(S.Unknown) // Backend: Option<serde_json::Value>
})

/**
 * Wire format Consumer Parameters (from backend ConsumerParameters)
 * Matches backend structure with camelCase field names
 */
const WireConsumerParametersSchema = S.Struct({
  id: S.String, // Backend: String (required)
  producerId: S.String, // Backend: producer_id → producerId (String, required)
  kind: S.String, // Backend: String (required) - backend always sends "audio"
  rtpParameters: WireRtpParametersSchema, // Backend: rtp_parameters → rtpParameters (RtpParametersWrapper, required)
  type: S.String, // Backend: r#type → type (String, required) - backend always sends "simple"
  producerPaused: S.Boolean // Backend: producer_paused → producerPaused (bool, required)
})

/**
 * Wire format ICE Candidate (from backend ICE candidate messages)
 */
const WireIceCandidateSchema = S.Struct({
  foundation: S.String,
  priority: S.Number,
  address: S.String, // Backend sends 'address', mediasoup expects 'ip'
  protocol: S.Union(S.Literal('udp'), S.Literal('tcp')),
  port: S.Number,
  type: S.Union(S.Literal('host'), S.Literal('srflx'), S.Literal('prflx'), S.Literal('relay')),
  tcpType: S.Option(S.Union(S.Literal('active'), S.Literal('passive'), S.Literal('so')))
})

/**
 * Wire format DTLS Parameters (from backend transport connect messages)
 */
const WireDtlsParametersSchema = S.Struct({
  role: S.Union(S.Literal('auto'), S.Literal('client'), S.Literal('server')),
  fingerprints: S.mutable(S.Array(S.Struct({
    algorithm: S.String,
    value: S.String
  })))
})

/**
 * Wire format Transport Options (from backend connect transport messages)  
 * This represents the full transport setup parameters from the backend
 */
const WireTransportOptionsSchema = S.Struct({
  id: S.String,
  iceParameters: S.Struct({
    usernameFragment: S.String,
    password: S.String,
    iceLite: S.Option(S.Boolean)
  }),
  iceCandidates: S.mutable(S.Array(WireIceCandidateSchema)),
  dtlsParameters: WireDtlsParametersSchema
})

/**
 * Wire format RTP Capabilities (from backend RtpCapabilitiesWrapper)
 * Matches backend structure exactly with camelCase field names
 */
const WireRtpCapabilitiesSchema = S.Struct({
  codecs: S.mutable(S.Array(S.Struct({
    kind: S.String, // Backend: String (required)
    mimeType: S.String, // Backend: mime_type → mimeType (required)
    preferredPayloadType: S.Option(S.Number), // Backend: preferred_payload_type → preferredPayloadType (Option<u8>)
    clockRate: S.Number, // Backend: clock_rate → clockRate (u32, required)
    channels: S.Number, // Backend: channels (u8, required - NOT optional!)
    parameters: S.Record({ key: S.String, value: S.String }), // Backend: BTreeMap<String, String> (required)
    rtcpFeedback: S.mutable(S.Array(S.Struct({
      type: S.String, // Backend: r#type → type (required)
      parameter: S.Option(S.String) // Backend: parameter (Option<String>)
    }))) // Backend: rtcp_feedback → rtcpFeedback (required)
  }))), // Backend: codecs (Vec<>, required)
  headerExtensions: S.mutable(S.Array(S.Struct({
    kind: S.String, // Backend: String (required)
    uri: S.String, // Backend: String (required)
    preferredId: S.Number, // Backend: preferred_id → preferredId (u16, required)
    preferredEncrypt: S.Boolean, // Backend: preferred_encrypt → preferredEncrypt (bool, required - NOT optional!)
    direction: S.String // Backend: String (required - NOT optional!)
  }))) // Backend: header_extensions → headerExtensions (Vec<>, required)
})

/**
 * =============================================================================
 * Transform Schemas (Wire → Native)
 * All native schemas are imported from mediasoup.schema.ts as single source of truth
 * =============================================================================
 */

/**
 * Consumer Parameters Transform Schema
 * Converts backend createConsumer message to mediasoup consumer parameters
 */
export const ConsumerParametersTransformSchema = S.transform(
  WireConsumerParametersSchema,
  ConsumerOptionsSchema,
  {
    strict: true,
    decode: (wireData) => ({
      id: wireData.id,
      producerId: wireData.producerId,
      kind: wireData.kind as "audio" | "video", // Backend sends string, cast to MediaSoup enum
      rtpParameters: {
        // Backend sends complete RtpParametersWrapper as JSON, trust the serialization
        mid: O.getOrNull(wireData.rtpParameters.mid) ?? undefined,
        codecs: (wireData.rtpParameters.codecs as any[]).map((codec: any) => ({
          mimeType: codec.mimeType,
          payloadType: codec.payloadType,
          clockRate: codec.clockRate,
          channels: codec.channels,
          parameters: codec.parameters || {},
          rtcpFeedback: (codec.rtcpFeedback || []).map((feedback: any) => ({
            type: feedback.type,
            parameter: feedback.parameter
          }))
        })),
        headerExtensions: (wireData.rtpParameters.headerExtensions as any[]).map((ext: any) => ({
          uri: ext.uri,
          id: ext.id,
          encrypt: ext.encrypt,
          parameters: ext.parameters || {}
        })),
        encodings: (wireData.rtpParameters.encodings as any[]).map((encoding: any) => ({
          ssrc: encoding.ssrc,
          rid: encoding.rid,
          dtx: encoding.dtx,
          scalabilityMode: encoding.scalabilityMode,
          maxBitrate: encoding.maxBitrate
        })),
        rtcp: wireData.rtpParameters.rtcp ? {
          cname: (wireData.rtpParameters.rtcp as any).cname,
          reducedSize: (wireData.rtpParameters.rtcp as any).reducedSize
        } : undefined
      },
      type: wireData.type as "simple" | "simulcast" | "svc" | "pipe", // Backend sends string, cast to MediaSoup enum
      producerPaused: wireData.producerPaused
    }),
    encode: (nativeData) => ({
      id: nativeData.id,
      producerId: nativeData.producerId,
      kind: nativeData.kind,
      rtpParameters: {
        mid: nativeData.rtpParameters.mid !== undefined ? O.some(nativeData.rtpParameters.mid) : O.none(),
        codecs: (nativeData.rtpParameters.codecs || []).map(codec => ({
          mimeType: codec.mimeType,
          payloadType: codec.payloadType,
          clockRate: codec.clockRate,
          channels: codec.channels !== undefined ? O.some(codec.channels) : O.none(),
          parameters: codec.parameters || {},
          rtcpFeedback: (codec.rtcpFeedback || []).map(feedback => ({
            type: feedback.type,
            parameter: feedback.parameter !== undefined ? O.some(feedback.parameter) : O.none()
          }))
        })),
        headerExtensions: (nativeData.rtpParameters.headerExtensions || []).map(ext => ({
          uri: ext.uri,
          id: ext.id,
          encrypt: ext.encrypt !== undefined ? O.some(ext.encrypt) : O.none(),
          parameters: ext.parameters || {}
        })),
        encodings: (nativeData.rtpParameters.encodings || []).map(encoding => ({
          ssrc: encoding.ssrc !== undefined ? O.some(encoding.ssrc) : O.none(),
          rid: encoding.rid !== undefined ? O.some(encoding.rid) : O.none(),
          dtx: encoding.dtx !== undefined ? O.some(encoding.dtx) : O.none(),
          scalabilityMode: encoding.scalabilityMode !== undefined ? O.some(encoding.scalabilityMode) : O.none(),
          maxBitrate: encoding.maxBitrate !== undefined ? O.some(encoding.maxBitrate) : O.none()
        })),
        rtcp: nativeData.rtpParameters.rtcp ? O.some({
          cname: nativeData.rtpParameters.rtcp.cname !== undefined ? O.some(nativeData.rtpParameters.rtcp.cname) : O.none(),
          reducedSize: nativeData.rtpParameters.rtcp.reducedSize !== undefined ? O.some(nativeData.rtpParameters.rtcp.reducedSize) : O.none()
        }) : O.none()
      },
      type: nativeData.type,
      producerPaused: nativeData.producerPaused
    })
  }
)

/**
 * Transport Options Transform Schema  
 * Converts backend connect transport message to mediasoup transport options
 */
export const TransportOptionsTransformSchema = S.transform(
  WireTransportOptionsSchema,
  TransportOptionsSchema,
  {
    strict: true,
    decode: (wireData) => ({
      id: wireData.id,
      iceParameters: {
        usernameFragment: wireData.iceParameters.usernameFragment,
        password: wireData.iceParameters.password,
        iceLite: O.getOrNull(wireData.iceParameters.iceLite) ?? undefined
      },
      iceCandidates: wireData.iceCandidates.map(candidate => ({
        foundation: candidate.foundation,
        priority: candidate.priority,
        ip: candidate.address,
        address: candidate.address,
        protocol: candidate.protocol,
        port: candidate.port,
        type: candidate.type,
        tcpType: O.getOrNull(candidate.tcpType) ?? undefined
      })),
      dtlsParameters: wireData.dtlsParameters
    }),
    encode: (nativeData) => ({
      id: nativeData.id,
      iceParameters: {
        usernameFragment: nativeData.iceParameters.usernameFragment,
        password: nativeData.iceParameters.password,
        iceLite: nativeData.iceParameters.iceLite !== undefined ? O.some(nativeData.iceParameters.iceLite) : O.none()
      },
      iceCandidates: nativeData.iceCandidates.map(candidate => ({
        foundation: candidate.foundation,
        priority: candidate.priority,
        address: candidate.address,
        protocol: candidate.protocol,
        port: candidate.port,
        type: candidate.type,
        tcpType: candidate.tcpType !== undefined ? O.some(candidate.tcpType) : O.none()
      })),
      dtlsParameters: nativeData.dtlsParameters
    })
  }
)

/**
 * ICE Candidate Transform Schema
 * Converts backend ICE candidate message to mediasoup ICE candidate
 * Maps 'address' field to 'ip' field for mediasoup compatibility
 */
export const IceCandidateTransformSchema = S.transform(
  WireIceCandidateSchema,
  IceCandidateSchema,
  {
    strict: true,
    decode: (wireData) => ({
      foundation: wireData.foundation,
      priority: wireData.priority,
      ip: wireData.address, // Map 'address' to 'ip'
      address: wireData.address, // Keep both for compatibility
      protocol: wireData.protocol,
      port: wireData.port,
      type: wireData.type,
      tcpType: O.getOrNull(wireData.tcpType) ?? undefined
    }),
    encode: (nativeData) => ({
      foundation: nativeData.foundation,
      priority: nativeData.priority,
      address: nativeData.address, // Map back to 'address'
      protocol: nativeData.protocol,
      port: nativeData.port,
      type: nativeData.type,
      tcpType: nativeData.tcpType !== undefined ? O.some(nativeData.tcpType) : O.none()
    })
  }
)

/**
 * RTP Capabilities Transform Schema
 * Converts backend router capabilities message to mediasoup RTP capabilities
 * Handles Option types in wire format to native undefined values
 */
export const RtpCapabilitiesTransformSchema = S.transform(
  WireRtpCapabilitiesSchema,
  RtpCapabilitiesSchema,
  {
    strict: true,
    decode: (wireData) => ({
      codecs: wireData.codecs ? wireData.codecs.map(codec => ({
        kind: codec.kind as "audio" | "video", // Cast string to MediaSoup enum
        mimeType: codec.mimeType,
        preferredPayloadType: O.getOrNull(codec.preferredPayloadType) ?? 96,
        clockRate: codec.clockRate,
        channels: codec.channels, // Backend: required u8, no Option handling needed
        parameters: codec.parameters || {},
        rtcpFeedback: codec.rtcpFeedback?.map(feedback => ({
          type: feedback.type,
          parameter: O.getOrNull(feedback.parameter) ?? undefined
        })) || []
      })) : undefined,
      headerExtensions: wireData.headerExtensions ? wireData.headerExtensions.map(ext => ({
        kind: ext.kind as "audio" | "video", // Cast string to MediaSoup enum
        uri: ext.uri,
        preferredId: ext.preferredId,
        preferredEncrypt: ext.preferredEncrypt, // Backend: required bool, no Option handling needed
        direction: ext.direction // Backend: required String, no Option handling needed
      })) : undefined
    }),
    encode: (nativeData) => ({
      codecs: (nativeData.codecs || []).map(codec => ({
        kind: codec.kind,
        mimeType: codec.mimeType,
        preferredPayloadType: codec.preferredPayloadType !== undefined ? O.some(codec.preferredPayloadType) : O.none(),
        clockRate: codec.clockRate,
        channels: codec.channels || 1, // Backend: required u8, provide default
        parameters: codec.parameters || {},
        rtcpFeedback: (codec.rtcpFeedback || []).map(feedback => ({
          type: feedback.type,
          parameter: feedback.parameter !== undefined ? O.some(feedback.parameter) : O.none()
        }))
      })),
      headerExtensions: (nativeData.headerExtensions || []).map(ext => ({
        kind: ext.kind,
        uri: ext.uri,
        preferredId: ext.preferredId,
        preferredEncrypt: ext.preferredEncrypt !== undefined ? ext.preferredEncrypt : false, // Backend: required bool
        direction: ext.direction || 'sendrecv' // Backend: required String, provide default
      }))
    })
  }
)

/**
 * RTP Parameters Transform Schema
 * Converts backend producer/consumer parameters to mediasoup RTP parameters
 */
export const RtpParametersTransformSchema = S.transform(
  WireRtpParametersSchema,
  RtpParametersSchema,
  {
    strict: true,
    decode: (wireData) => ({
      mid: O.getOrNull(wireData.mid) ?? undefined,
      codecs: (wireData.codecs as any[]).map((codec: any) => ({
        mimeType: codec.mimeType,
        payloadType: codec.payloadType,
        clockRate: codec.clockRate,
        channels: codec.channels ?? undefined,
        parameters: codec.parameters || {},
        rtcpFeedback: (codec.rtcpFeedback || []).map((feedback: any) => ({
          type: feedback.type,
          parameter: feedback.parameter ?? undefined
        }))
      })),
      headerExtensions: (wireData.headerExtensions as any[]).map((ext: any) => ({
        uri: ext.uri,
        id: ext.id,
        encrypt: ext.encrypt ?? undefined,
        parameters: ext.parameters || {}
      })),
      encodings: (wireData.encodings as any[]).map((encoding: any) => ({
        ssrc: encoding.ssrc ?? undefined,
        rid: encoding.rid ?? undefined,
        dtx: encoding.dtx ?? undefined,
        scalabilityMode: encoding.scalabilityMode ?? undefined,
        maxBitrate: encoding.maxBitrate ?? undefined
      })),
      rtcp: O.getOrNull(wireData.rtcp) ? {
        cname: (O.getOrNull(wireData.rtcp) as any).cname ?? undefined,
        reducedSize: (O.getOrNull(wireData.rtcp) as any).reducedSize ?? undefined
      } : undefined
    }),
    encode: (nativeData) => ({
      mid: nativeData.mid !== undefined ? O.some(nativeData.mid) : O.none(),
      codecs: (nativeData.codecs || []).map(codec => ({
        mimeType: codec.mimeType,
        payloadType: codec.payloadType,
        clockRate: codec.clockRate,
        channels: codec.channels !== undefined ? O.some(codec.channels) : O.none(),
        parameters: codec.parameters || {},
        rtcpFeedback: (codec.rtcpFeedback || []).map(feedback => ({
          type: feedback.type,
          parameter: feedback.parameter !== undefined ? O.some(feedback.parameter) : O.none()
        }))
      })),
      headerExtensions: (nativeData.headerExtensions || []).map(ext => ({
        uri: ext.uri,
        id: ext.id,
        encrypt: ext.encrypt !== undefined ? O.some(ext.encrypt) : O.none(),
        parameters: ext.parameters || {}
      })),
      encodings: (nativeData.encodings || []).map(encoding => ({
        ssrc: encoding.ssrc !== undefined ? O.some(encoding.ssrc) : O.none(),
        rid: encoding.rid !== undefined ? O.some(encoding.rid) : O.none(),
        dtx: encoding.dtx !== undefined ? O.some(encoding.dtx) : O.none(),
        scalabilityMode: encoding.scalabilityMode !== undefined ? O.some(encoding.scalabilityMode) : O.none(),
        maxBitrate: encoding.maxBitrate !== undefined ? O.some(encoding.maxBitrate) : O.none()
      })),
      rtcp: nativeData.rtcp ? O.some({
        cname: nativeData.rtcp.cname !== undefined ? O.some(nativeData.rtcp.cname) : O.none(),
        reducedSize: nativeData.rtcp.reducedSize !== undefined ? O.some(nativeData.rtcp.reducedSize) : O.none()
      }) : O.none()
    })
  }
)

/**
 * DTLS Parameters Transform Schema
 * Converts backend transport connect message to mediasoup DTLS parameters
 */
export const DtlsParametersTransformSchema = S.transform(
  WireDtlsParametersSchema,
  DtlsParametersSchema,
  {
    strict: true,
    decode: (wireData) => wireData, // Direct pass-through as structures match
    encode: (nativeData) => nativeData // Direct pass-through as structures match
  }
)

/**
 * =============================================================================
 * WebSocket Message Transforms (Add/Remove Type Field)
 * =============================================================================
 */

/**
 * Wire format for messages with type field (backend expects this)
 */
type WireMessage<T extends string, P> = P & { type: T }

/**
 * Transform functions to add/remove type field from messages
 * These allow the WebSocketClient to work with typed schemas internally
 * while maintaining backward compatibility with the backend's discriminated union format
 */

/**
 * Lobby Command Transforms
 */
export const LobbyCommandTransforms = {
  announceRoom: {
    encode: (cmd: { name: string; djName: string; sessionId: string; description?: string; tags: string[] }) => 
      ({ ...cmd, type: 'announceRoom' as const }),
    decode: (wire: WireMessage<'announceRoom', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  requestJoin: {
    encode: (cmd: { roomId: string; sessionId: string }) => 
      ({ ...cmd, type: 'requestJoin' as const }),
    decode: (wire: WireMessage<'requestJoin', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  refreshRooms: {
    encode: (cmd: {}) => ({ type: 'refreshRooms' as const }),
    decode: (wire: WireMessage<'refreshRooms', any>) => ({})
  }
}

/**
 * Lobby Event Transforms
 */
export const LobbyEventTransforms = {
  roomAdded: {
    decode: (wire: WireMessage<'roomAdded', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  roomUpdated: {
    decode: (wire: WireMessage<'roomUpdated', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  roomRemoved: {
    decode: (wire: WireMessage<'roomRemoved', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  joinRoomResponse: {
    decode: (wire: WireMessage<'joinRoomResponse', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  }
}

/**
 * DJ Command Transforms
 */
export const DJCommandTransforms = {
  initRoom: {
    encode: (cmd: { roomId: string }) => 
      ({ ...cmd, type: 'initRoom' as const }),
    decode: (wire: WireMessage<'initRoom', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  requestDjTransport: {
    encode: (cmd: {}) => ({ type: 'requestDjTransport' as const }),
    decode: (wire: WireMessage<'requestDjTransport', any>) => ({})
  },
  connectDjTransport: {
    encode: (cmd: { transportId?: string; dtlsParameters: any }) => 
      ({ ...cmd, type: 'connectDjTransport' as const }),
    decode: (wire: WireMessage<'connectDjTransport', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  produce: {
    encode: (cmd: { rtpParameters: any }) => 
      ({ ...cmd, type: 'produce' as const }),
    decode: (wire: WireMessage<'produce', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  pauseStream: {
    encode: (cmd: {}) => ({ type: 'pauseStream' as const }),
    decode: (wire: WireMessage<'pauseStream', any>) => ({})
  },
  resumeStream: {
    encode: (cmd: {}) => ({ type: 'resumeStream' as const }),
    decode: (wire: WireMessage<'resumeStream', any>) => ({})
  },
  closeRoom: {
    encode: (cmd: {}) => ({ type: 'closeRoom' as const }),
    decode: (wire: WireMessage<'closeRoom', any>) => ({})
  }
}

/**
 * DJ Event Transforms
 */
export const DJEventTransforms = {
  roomAnnounced: {
    decode: (wire: WireMessage<'roomAnnounced', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  roomInitialized: {
    decode: (wire: WireMessage<'roomInitialized', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  djTransportReady: {
    decode: (wire: WireMessage<'djTransportReady', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  transportConnected: {
    decode: (wire: WireMessage<'transportConnected', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  producerCreated: {
    decode: (wire: WireMessage<'producerCreated', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  streamPaused: {
    decode: (wire: WireMessage<'streamPaused', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  streamResumed: {
    decode: (wire: WireMessage<'streamResumed', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  roomClosed: {
    decode: (wire: WireMessage<'roomClosed', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  commandFailed: {
    decode: (wire: WireMessage<'commandFailed', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  roomNotFound: {
    decode: (wire: WireMessage<'roomNotFound', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  }
}

/**
 * Listener Command Transforms
 */
export const ListenerCommandTransforms = {
  initListener: {
    encode: (cmd: {}) => ({ type: 'initListener' as const }),
    decode: (wire: WireMessage<'initListener', any>) => ({})
  },
  getRouterCapabilities: {
    encode: (cmd: { roomId: string }) => 
      ({ ...cmd, type: 'getRouterCapabilities' as const }),
    decode: (wire: WireMessage<'getRouterCapabilities', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  connectListenerTransport: {
    encode: (cmd: { transportId?: string; dtlsParameters: any }) => 
      ({ ...cmd, type: 'connectListenerTransport' as const }),
    decode: (wire: WireMessage<'connectListenerTransport', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  requestConsumer: {
    encode: (cmd: { rtpCapabilities: any }) => 
      ({ ...cmd, type: 'requestConsumer' as const }),
    decode: (wire: WireMessage<'requestConsumer', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  resumeConsumer: {
    encode: (cmd: { consumerId: string }) => 
      ({ ...cmd, type: 'resumeConsumer' as const }),
    decode: (wire: WireMessage<'resumeConsumer', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  leaveRoom: {
    encode: (cmd: {}) => ({ type: 'leaveRoom' as const }),
    decode: (wire: WireMessage<'leaveRoom', any>) => ({})
  }
}

/**
 * Listener Event Transforms
 */
export const ListenerEventTransforms = {
  listenerTransportReady: {
    decode: (wire: WireMessage<'listenerTransportReady', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  joinReady: {
    decode: (wire: WireMessage<'joinReady', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  transportConnected: {
    decode: (wire: WireMessage<'transportConnected', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  consumerCreated: {
    decode: (wire: WireMessage<'consumerCreated', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  routerCapabilities: {
    decode: (wire: WireMessage<'routerCapabilities', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  listenerCountUpdated: {
    decode: (wire: WireMessage<'listenerCountUpdated', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  streamPaused: {
    decode: (wire: WireMessage<'streamPaused', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  streamResumed: {
    decode: (wire: WireMessage<'streamResumed', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  roomClosed: {
    decode: (wire: WireMessage<'roomClosed', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  commandFailed: {
    decode: (wire: WireMessage<'commandFailed', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  },
  roomNotFound: {
    decode: (wire: WireMessage<'roomNotFound', any>) => {
      const { type, ...rest } = wire
      return rest
    }
  }
}

/**
 * Generic message transform function
 * Infers the type from the message and applies the appropriate transform
 */
export function encodeCommand<T extends string>(
  type: T, 
  command: any
): WireMessage<T, any> {
  // Add type field to command
  return { ...command, type } as WireMessage<T, any>
}

export function decodeEvent<T extends string>(
  wireMessage: WireMessage<T, any>
): any {
  // Remove type field from event
  const { type, ...rest } = wireMessage
  return rest
}

/**
 * Helper to determine message type from wire format
 */
export function getMessageType(wireMessage: any): string | undefined {
  return wireMessage?.type
}

/**
 * =============================================================================
 * Consolidated Transform Schemas Export
 * =============================================================================
 */

/**
 * All WebSocket transform schemas for easy import
 */
export const WebSocketTransforms = {
  // MediaSoup transforms
  ConsumerParameters: ConsumerParametersTransformSchema,
  TransportOptions: TransportOptionsTransformSchema,
  IceCandidate: IceCandidateTransformSchema,
  RtpCapabilities: RtpCapabilitiesTransformSchema,
  RtpParameters: RtpParametersTransformSchema,
  DtlsParameters: DtlsParametersTransformSchema,
  
  // Message transforms
  LobbyCommands: LobbyCommandTransforms,
  LobbyEvents: LobbyEventTransforms,
  DJCommands: DJCommandTransforms,
  DJEvents: DJEventTransforms,
  ListenerCommands: ListenerCommandTransforms,
  ListenerEvents: ListenerEventTransforms,
  
  // Utilities
  encodeCommand,
  decodeEvent,
  getMessageType
} as const

/**
 * Transform Schema Types
 */
export type ConsumerParametersWire = S.Schema.Type<typeof WireConsumerParametersSchema>
export type ConsumerParametersNative = S.Schema.Type<typeof ConsumerOptionsSchema>

export type TransportOptionsWire = S.Schema.Type<typeof WireTransportOptionsSchema>
export type TransportOptionsNative = S.Schema.Type<typeof TransportOptionsSchema>

export type IceCandidateWire = S.Schema.Type<typeof WireIceCandidateSchema>
export type IceCandidateNative = S.Schema.Type<typeof IceCandidateSchema>

export type RtpCapabilitiesWire = S.Schema.Type<typeof WireRtpCapabilitiesSchema>
export type RtpCapabilitiesNative = S.Schema.Type<typeof RtpCapabilitiesSchema>

export type RtpParametersWire = S.Schema.Type<typeof WireRtpParametersSchema>
export type RtpParametersNative = S.Schema.Type<typeof RtpParametersSchema>

export type DtlsParametersWire = S.Schema.Type<typeof WireDtlsParametersSchema>
export type DtlsParametersNative = S.Schema.Type<typeof DtlsParametersSchema>