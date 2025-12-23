/**
 * MediaSoup Public Schema Definitions
 *
 * Public-facing MediaSoup schemas for domain layer.
 * Contains only schemas exposed to application services and stores.
 *
 * Transform-related schemas have been moved to WebSocket infrastructure layer.
 * Native type declarations are exported for use in transform utilities.
 */

import { Schema as S, Option as O } from 'effect'
import { Device } from 'mediasoup-client'

/**
 * MediaSoup Device Schema (synchronized with mediasoup-client Device class)
 */
export const MediaSoupDeviceSchema = S.instanceOf(Device)
export type MediaSoupDeviceType = S.Schema.Type<typeof MediaSoupDeviceSchema>

/**
 * MediaSoup Transport Schema (synchronized with mediasoup-client Transport interface)
 * Using S.as pattern to match external interface exactly
 */
export const MediaSoupTransportSchema = S.Struct({
  id: S.String,
  closed: S.Boolean,
  direction: S.Union(S.Literal('send'), S.Literal('recv')),
  connectionState: S.Union(
    S.Literal('new'),
    S.Literal('connecting'),
    S.Literal('connected'),
    S.Literal('disconnected'),
    S.Literal('failed')
  ),
  appData: S.Record({ key: S.String, value: S.Union(S.String, S.Number, S.Boolean, S.Null) })
})
export type MediaSoupTransportType = S.Schema.Type<typeof MediaSoupTransportSchema>

/**
 * MediaSoup Producer Schema (synchronized with mediasoup-client Producer interface)
 */
export const MediaSoupProducerSchema = S.Struct({
  id: S.String,
  closed: S.Boolean,
  kind: S.Union(S.Literal('audio'), S.Literal('video')),
  paused: S.Boolean,
  maxSpatialLayer: S.optional(S.Number),
  appData: S.Record({ key: S.String, value: S.Union(S.String, S.Number, S.Boolean, S.Null) }),
  track: S.optional(S.instanceOf(MediaStreamTrack))
})
export type MediaSoupProducerType = S.Schema.Type<typeof MediaSoupProducerSchema>

/**
 * MediaSoup Consumer Schema (synchronized with mediasoup-client Consumer interface)
 */
export const MediaSoupConsumerSchema = S.Struct({
  id: S.String,
  producerId: S.String,
  closed: S.Boolean,
  kind: S.Union(S.Literal('audio'), S.Literal('video')),
  paused: S.Boolean,
  track: S.instanceOf(MediaStreamTrack),
  appData: S.Record({ key: S.String, value: S.Union(S.String, S.Number, S.Boolean, S.Null) })
})
export type MediaSoupConsumerType = S.Schema.Type<typeof MediaSoupConsumerSchema>




/**
 * Public MediaSoup RTP Capabilities Schema
 * Simple schema for application use - transformations handled in infrastructure layer
 */
export const RtpCapabilitiesSchema = S.Struct({
  codecs: S.optional(S.mutable(S.Array(S.Struct({
    kind: S.Union(S.Literal('audio'), S.Literal('video')), // MediaSoup: MediaKind enum
    mimeType: S.String,
    preferredPayloadType: S.Number, // MediaSoup: required number
    clockRate: S.Number,
    channels: S.optional(S.Number), // MediaSoup: optional number
    parameters: S.optional(S.Record({ key: S.String, value: S.Unknown })), // MediaSoup: optional Record<string, any>
    rtcpFeedback: S.optional(S.mutable(S.Array(S.Struct({
      type: S.String,
      parameter: S.optional(S.String)
    })))) // MediaSoup: optional RtcpFeedback[]
  })))), // MediaSoup: optional RtpCodecCapability[]
  headerExtensions: S.optional(S.mutable(S.Array(S.Struct({
    kind: S.Union(S.Literal('audio'), S.Literal('video')), // MediaSoup: MediaKind enum
    uri: S.String,
    preferredId: S.Number,
    preferredEncrypt: S.optional(S.Boolean), // MediaSoup: optional boolean
    direction: S.optional(S.String) // MediaSoup: optional string (not enum)
  })))) // MediaSoup: optional RtpHeaderExtension[]
})
export type RtpCapabilitiesType = S.Schema.Type<typeof RtpCapabilitiesSchema>

/**
 * Public MediaSoup RTP Parameters Schema
 * Simple schema for application use - transformations handled in infrastructure layer
 */
export const RtpParametersSchema = S.Struct({
  mid: S.optional(S.String),
  codecs: S.mutable(S.Array(S.Struct({
    mimeType: S.String,
    payloadType: S.Number,
    clockRate: S.Number,
    channels: S.optional(S.Number),
    parameters: S.optional(S.Record({ key: S.String, value: S.Unknown })),
    rtcpFeedback: S.optional(S.mutable(S.Array(S.Struct({
      type: S.String,
      parameter: S.optional(S.String)
    }))))
  }))),
  headerExtensions: S.optional(S.mutable(S.Array(S.Struct({
    uri: S.String,
    id: S.Number,
    encrypt: S.optional(S.Boolean),
    parameters: S.optional(S.Record({ key: S.String, value: S.Unknown }))
  })))),
  encodings: S.optional(S.mutable(S.Array(S.Struct({
    ssrc: S.optional(S.Number),
    rid: S.optional(S.String),
    dtx: S.optional(S.Boolean),
    scalabilityMode: S.optional(S.String),
    maxBitrate: S.optional(S.Number)
  })))),
  rtcp: S.optional(S.Struct({
    cname: S.optional(S.String),
    reducedSize: S.optional(S.Boolean)
  }))
})
export type RtpParametersType = S.Schema.Type<typeof RtpParametersSchema>

/**
 * MediaSoup DTLS Parameters Schema (synchronized with mediasoup DtlsParameters)
 */
export const DtlsParametersSchema = S.Struct({
  role: S.Union(S.Literal('auto'), S.Literal('client'), S.Literal('server')),
  fingerprints: S.mutable(S.Array(S.Struct({
    algorithm: S.String,
    value: S.String
  })))
})
export type DtlsParametersType = S.Schema.Type<typeof DtlsParametersSchema>

/**
 * Public MediaSoup ICE Parameters Schema
 * Simple schema for application use - transformations handled in infrastructure layer
 */
export const IceParametersSchema = S.Struct({
  usernameFragment: S.String,
  password: S.String,
  iceLite: S.optional(S.Boolean)
})
export type IceParametersType = S.Schema.Type<typeof IceParametersSchema>

/**
 * Public MediaSoup ICE Candidate Schema
 * Simple schema for application use - transformations handled in infrastructure layer
 */
export const IceCandidateSchema = S.Struct({
  foundation: S.String,
  priority: S.Number,
  address: S.String,
  ip: S.String, // MediaSoup native field (usually same as address)
  protocol: S.Union(S.Literal('udp'), S.Literal('tcp')),
  port: S.Number,
  type: S.Union(S.Literal('host'), S.Literal('srflx'), S.Literal('prflx'), S.Literal('relay')),
  tcpType: S.optional(S.Union(S.Literal('active'), S.Literal('passive'), S.Literal('so')))
})
export type IceCandidateType = S.Schema.Type<typeof IceCandidateSchema>

/**
 * MediaSoup Consumer Options Schema
 * Schema for consumer creation parameters (matches MediaSoup ConsumerOptions interface)
 */
export const ConsumerOptionsSchema = S.Struct({
  id: S.String,
  producerId: S.String,
  kind: S.Union(S.Literal('audio'), S.Literal('video')), // MediaSoup: MediaKind enum
  rtpParameters: RtpParametersSchema,
  type: S.Union(S.Literal('simple'), S.Literal('simulcast'), S.Literal('svc'), S.Literal('pipe')), // MediaSoup: ConsumerType enum
  producerPaused: S.Boolean
  // Note: appData removed - not part of MediaSoup ConsumerOptions interface
})
export type ConsumerOptionsType = S.Schema.Type<typeof ConsumerOptionsSchema>


/**
 * Transport Options Schema - shared between DJ and Listener events
 * Used for WebRTC transport initialization parameters from backend
 */
export const TransportOptionsSchema = S.Struct({
  id: S.String,
  iceParameters: IceParametersSchema,
  iceCandidates: S.Array(IceCandidateSchema),
  dtlsParameters: DtlsParametersSchema
})
export type TransportOptionsType = S.Schema.Type<typeof TransportOptionsSchema>
export type TransportOptionsEncoded = S.Schema.Encoded<typeof TransportOptionsSchema>

/**
 * Consolidated MediaSoup Schemas for easy import
 */
export const MediaSoupSchemas = {
  Device: MediaSoupDeviceSchema,
  Transport: MediaSoupTransportSchema,
  Producer: MediaSoupProducerSchema,
  Consumer: MediaSoupConsumerSchema,
  RtpCapabilities: RtpCapabilitiesSchema,
  RtpParameters: RtpParametersSchema,
  DtlsParameters: DtlsParametersSchema,
  IceParameters: IceParametersSchema,
  IceCandidate: IceCandidateSchema,
  ConsumerOptions: ConsumerOptionsSchema
}



/**
 * Public MediaSoup Schema Collection
 *
 * Simple application-level schemas without transformations.
 * Wire format transformations are handled in the infrastructure layer.
 */


/**
 * Consolidated MediaSoup Types for easy import
 */
export type MediaSoupTypes = {
  Device: MediaSoupDeviceType
  Transport: MediaSoupTransportType
  Producer: MediaSoupProducerType
  Consumer: MediaSoupConsumerType
  RtpCapabilities: RtpCapabilitiesType
  RtpParameters: RtpParametersType
  DtlsParameters: DtlsParametersType
  IceParameters: IceParametersType
  IceCandidate: IceCandidateType
  ConsumerOptions: ConsumerOptionsType
}


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
    parameters: S.Record({ key: S.String, value: S.Unknown }), // Backend: BTreeMap<String, String> (required)
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
        address: candidate.address, // Map 'ip' back to 'address' for wire format
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
}



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
