/**
 * MediaSoup Public Schema Definitions
 * 
 * Public-facing MediaSoup schemas for domain layer.
 * Contains only schemas exposed to application services and stores.
 * 
 * Transform-related schemas have been moved to WebSocket infrastructure layer.
 * Native type declarations are exported for use in transform utilities.
 */

import { Schema as S } from 'effect'
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
 * MediaSoup Transport Options Schema
 * Schema for transport connection options
 */
export const TransportOptionsSchema = S.Struct({
  id: S.String,
  iceParameters: IceParametersSchema,
  iceCandidates: S.mutable(S.Array(IceCandidateSchema)),
  dtlsParameters: DtlsParametersSchema
})
export type TransportOptionsType = S.Schema.Type<typeof TransportOptionsSchema>

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
  TransportOptions: TransportOptionsSchema,
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
  TransportOptions: TransportOptionsType
  ConsumerOptions: ConsumerOptionsType
}