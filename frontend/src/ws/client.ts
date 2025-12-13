import { Effect, Option } from 'effect'
import { types } from 'mediasoup-client'
import type { ClientCommand, ServerEvent, LobbyEvent, WebSocketMessage } from '../models/websocket'
import type { RtpCapabilitiesWrapper } from '../generated/api.schemas'

// Re-export types
export type { ClientCommand, ServerEvent, LobbyEvent, WebSocketMessage }

/**
 * API Serialization Layer
 * Converts between native MediaSoup types (used in core logic) and backend wrapper types (used for API)
 */

// Convert native RtpCapabilities to backend wrapper format for command serialization
const serializeRtpCapabilities = (caps: types.RtpCapabilities): any => ({
  codecs: caps.codecs || [],
  headerExtensions: caps.headerExtensions || [],
  fecMechanisms: []  // Always empty for MediaSoup
})

// Convert backend wrapper to native RtpCapabilities for event deserialization
const deserializeRtpCapabilities = (wrapper: RtpCapabilitiesWrapper): types.RtpCapabilities => ({
  codecs: wrapper.codecs as any,
  headerExtensions: wrapper.headerExtensions as any
  // Note: fecMechanisms not present in MediaSoup RtpCapabilities
}) as types.RtpCapabilities

// Serialize commands for sending to backend
const serializeCommand = (command: ClientCommand): any => {
  if (command.type === 'requestJoin') {
    return {
      ...command,
      rtpCapabilities: serializeRtpCapabilities(command.rtpCapabilities)
    }
  }
  // Other commands pass through unchanged
  return command
}

// Deserialize events received from backend
const deserializeServerEvent = (rawEvent: any): ServerEvent => {
  // Handle events with _traceContext - wrap in Option
  const baseEvent = {
    ...rawEvent,
    _traceContext: Option.fromNullable(rawEvent._traceContext)
  }

  if (rawEvent.type === 'routerCapabilities') {
    return {
      ...baseEvent,
      rtpCapabilities: deserializeRtpCapabilities(rawEvent.rtpCapabilities)
    }
  }
  if (rawEvent.type === 'joinReady') {
    return {
      ...baseEvent,
      rtpCapabilities: deserializeRtpCapabilities(rawEvent.rtpCapabilities)
    }
  }
  if (rawEvent.type === 'roomJoined') {
    return {
      ...baseEvent,
      rtpCapabilities: deserializeRtpCapabilities(rawEvent.rtpCapabilities)
    }
  }
  // Other events pass through with _traceContext wrapped in Option
  return baseEvent as ServerEvent
}

class WebSocketError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebSocketError'
  }
}

export const connectWebSocket = (url: string): Effect.Effect<WebSocket, WebSocketError> =>
  Effect.async<WebSocket, WebSocketError>((resume) => {
    const ws = new WebSocket(url)
    
    ws.onopen = () => {
      resume(Effect.succeed(ws))
    }
    
    ws.onerror = () => {
      resume(Effect.fail(new WebSocketError(`Failed to connect to ${url}`)))
    }
    
    return Effect.sync(() => {
      ws.close()
    })
  })

export const sendMessage = (ws: WebSocket, message: ClientCommand): Effect.Effect<void, WebSocketError> =>
  Effect.sync(() => {
    if (ws.readyState === WebSocket.OPEN) {
      // Serialize command with API conversion layer
      const serializedMessage = serializeCommand(message)
      ws.send(JSON.stringify(serializedMessage))
    } else {
      throw new WebSocketError('WebSocket not connected')
    }
  })

export const subscribeToMessages = <T>(
  ws: WebSocket,
  onMessage: (message: T) => void,
  onError?: (error: Error) => void
): Effect.Effect<void, never> =>
  Effect.sync(() => {
    ws.onmessage = (event) => {
      try {
        const rawMessage = JSON.parse(event.data)
        // Deserialize event with API conversion layer
        const deserializedMessage = deserializeServerEvent(rawMessage)
        onMessage(deserializedMessage as T)
      } catch (error) {
        onError?.(error as Error)
      }
    }
    
    ws.onerror = (_) => {
      onError?.(new Error('WebSocket error'))
    }
  })