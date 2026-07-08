import { Data, Option } from "effect"


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
 * WebSocket Operation enum
 */
export enum WebSocketOperation {
  CONNECT = 'connect',
  SEND = 'send',
  RECEIVE = 'receive',
  ENCODE = 'encode',
  DECODE = 'decode',
  WAIT_FOR_EVENT = 'waitForEvent'
}

export class WebSocketError extends Data.TaggedError('WebSocketError')<{
  readonly cause: string
  readonly operation: WebSocketOperation
  readonly timestamp: Date
}> {}

/**
 * Raised when the WebSocket closes while one or more command replies are still
 * in flight (a socket drop mid-handshake). Distinct from WebSocketError so the
 * join flow can retry ONLY on this signal (a recovery-driven reconnect will
 * bring the socket back, at which point the whole handshake is safe to re-run).
 * A deliberate disconnect() still fails pending requests with WebSocketError, so
 * this tag never leaks from an intentional teardown.
 */
export class ConnectionDroppedError extends Data.TaggedError('ConnectionDroppedError')<{
  readonly cause: string
  readonly operation: WebSocketOperation
  readonly timestamp: Date
}> {}

/**
 * Connection Error Union Type
 */
export type ConnectionError =
  | MediaSoupDeviceError
  | ProducerError
  | ConsumerError
  | TransportError
  | RouterCompatibilityError
  | WebSocketError
  | ConnectionDroppedError

/**
 * Connection State - combining WebRTC and WebSocket connection states
 */
export type ConnectionState = {
    webrtcConnectionState: WebrtcConnectionState,
    wsConnectionState: WsConnectionState,
    lastError: Option.Option<ConnectionError>,
}

/**
 * Connection State enum for easy reference
 */
export enum WsConnectionState {
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
}

/**
 * Connection State enum for easy reference
 */
export enum WebrtcConnectionState {
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  STREAMING = 'STREAMING',
  PAUSED = 'PAUSED',
  DISCONNECTING = 'DISCONNECTING',
  DISCONNECTED = 'DISCONNECTED',
  ERROR = 'ERROR'
}
