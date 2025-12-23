import { Data } from "effect"


export class MediaSoupDeviceError extends Data.TaggedError('MediaSoupDeviceError')<{
  readonly cause: string
  readonly operation: 'create' | 'load' | 'capabilities'
  readonly timestamp: Date
}> {}


export class ProducerError extends Data.TaggedError('ProducerError')<{
  readonly cause: string
  readonly producerId?: string
  readonly operation: 'create' | 'pause' | 'resume' | 'close'
  readonly timestamp: Date
}> {}


export class ConsumerError extends Data.TaggedError('ConsumerError')<{
  readonly cause: string
  readonly consumerId?: string
  readonly producerId?: string
  readonly operation: 'create' | 'pause' | 'resume' | 'close'
  readonly timestamp: Date
}> {}


export class TransportError extends Data.TaggedError('TransportError')<{
  readonly cause: string
  readonly transportId?: string
  readonly direction: 'send' | 'receive'
  readonly operation: 'create' | 'connect' | 'close'
  readonly timestamp: Date
}> {}


export class RouterCompatibilityError extends Data.TaggedError('RouterCompatibilityError')<{
  readonly cause: string
  readonly deviceCapabilities?: unknown
  readonly routerCapabilities?: unknown
  readonly timestamp: Date
}> {}


/**
 * Connection State enum for easy reference
 */
export enum ConnectionState {
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  STREAMING = 'STREAMING',
  PAUSED = 'PAUSED',
  DISCONNECTING = 'DISCONNECTING',
  DISCONNECTED = 'DISCONNECTED',
  ERROR = 'ERROR'
}
