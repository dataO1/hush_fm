/**
 * MediaSoup Resource Cleanup Flows Service
 * 
 * Store-aware cleanup services for proper MediaSoup resource lifecycle management.
 * Handles asynchronous cleanup with proper event handling and store state updates.
 * 
 * This service ensures that MediaSoup transports, consumers, and WebSockets are
 * properly cleaned up to prevent connection leaks that interfere with rejoining.
 */

import { Effect, Option, pipe } from 'effect'
import { RoomStore } from '../../stores/room.store'

/**
 * Cleanup error for MediaSoup resource operations
 */
export class MediaSoupCleanupError extends Error {
  constructor(
    message: string,
    public readonly resource: 'consumer' | 'transport' | 'websocket',
    public readonly listenerId: string,
    public readonly context?: any
  ) {
    super(`MediaSoup cleanup error (${resource}): ${message}`)
    this.name = 'MediaSoupCleanupError'
  }
}

/**
 * Clean up MediaSoup consumer with proper event handling and store updates
 */
export const cleanupConsumerWithStore = (
  roomStore: RoomStore,
  listenerId: string,
  timeoutMs: number = 5000,
  isLeaving: boolean = false
): Effect.Effect<void, MediaSoupCleanupError> =>
  pipe(
    Effect.gen(function* (_) {
      console.info(`🧹 [${listenerId}] Starting consumer cleanup with store updates`)
      
      // Get current listener state from store using session ID
      const listener = roomStore.getListener(listenerId)
      
      if (!listener) {
        console.warn(`⚠️ [${listenerId}] No listener found for consumer cleanup`)
        return
      }

      // Get consumer from store state
      const consumerOption = listener.consumer.consumer
      
      if (Option.isNone(consumerOption)) {
        console.info(`ℹ️ [${listenerId}] No consumer to clean up`)
        roomStore.actions.markListenerResourceClosed(listenerId, 'consumer')
        return
      }

      const consumer = Option.getOrNull(consumerOption)
      if (!consumer) {
        console.warn(`⚠️ [${listenerId}] Consumer option was Some but value is null`)
        roomStore.actions.markListenerResourceClosed(listenerId, 'consumer')
        return
      }

      console.info(`🔄 [${listenerId}] Found consumer to cleanup: ${consumer.id}`)

      // Setup async cleanup with event handling
      yield* _(Effect.async<void, MediaSoupCleanupError>((resolve) => {
        let isResolved = false
        let timeoutId: NodeJS.Timeout

        const resolveOnce = (result: Effect.Effect<void, MediaSoupCleanupError>) => {
          if (!isResolved) {
            isResolved = true
            clearTimeout(timeoutId)
            resolve(result)
          }
        }

        // Handle transportclose event - this indicates the consumer is fully closed
        const onTransportClose = () => {
          console.info(`✅ [${listenerId}] Consumer transport closed event received`)
          
          // Update store to mark consumer as closed
          roomStore.actions.markListenerResourceClosed(listenerId, 'consumer')
          
          // Clean up event listener
          consumer.off('transportclose', onTransportClose)
          
          resolveOnce(Effect.void)
        }

        // Set up event listener for transportclose
        consumer.on('transportclose', onTransportClose)

        // Set timeout for cleanup
        timeoutId = setTimeout(() => {
          console.warn(`⏰ [${listenerId}] Consumer cleanup timeout, forcing cleanup`)
          
          // Clean up event listener
          consumer.off('transportclose', onTransportClose)
          
          // Force store update
          roomStore.actions.markListenerResourceClosed(listenerId, 'consumer')
          
          resolveOnce(Effect.fail(new MediaSoupCleanupError(
            `Consumer cleanup timeout after ${timeoutMs}ms`,
            'consumer',
            listenerId,
            { consumerId: consumer.id, timeout: timeoutMs }
          )))
        }, timeoutMs)

        // Close the consumer
        try {
          console.info(`🛑 [${listenerId}] Calling consumer.close()`)
          if (typeof consumer.close === 'function') {
            consumer.close()
            
            // If we're leaving intentionally, don't wait for transport events
            // Consumer.close() should be synchronous, so we can resolve immediately
            if (isLeaving) {
              console.info(`📤 [${listenerId}] Leaving mode - resolving consumer cleanup immediately`)
              roomStore.actions.markListenerResourceClosed(listenerId, 'consumer')
              consumer.off('transportclose', onTransportClose)
              resolveOnce(Effect.void)
              return
            }
          } else {
            console.warn(`⚠️ [${listenerId}] Consumer does not have close method`)
            resolveOnce(Effect.void)
          }
        } catch (error) {
          console.error(`❌ [${listenerId}] Error calling consumer.close():`, error)
          resolveOnce(Effect.fail(new MediaSoupCleanupError(
            `Failed to call consumer.close(): ${error}`,
            'consumer',
            listenerId,
            { error, consumerId: consumer.id }
          )))
        }

        // Return cleanup function
        return Effect.sync(() => {
          clearTimeout(timeoutId)
          consumer.off('transportclose', onTransportClose)
        })
      }))

      console.info(`✅ [${listenerId}] Consumer cleanup completed successfully`)
    }),
    Effect.catchAll((error) => {
      console.error(`❌ [${listenerId}] Consumer cleanup failed:`, error)
      // Ensure store is updated even on failure
      roomStore.actions.markListenerResourceClosed(listenerId, 'consumer')
      return Effect.fail(error)
    })
  )

/**
 * Clean up MediaSoup transport with proper event handling and store updates
 */
export const cleanupTransportWithStore = (
  roomStore: RoomStore,
  listenerId: string,
  timeoutMs: number = 5000,
  isLeaving: boolean = false
): Effect.Effect<void, MediaSoupCleanupError> =>
  pipe(
    Effect.gen(function* (_) {
      console.info(`🧹 [${listenerId}] Starting transport cleanup with store updates`)
      
      // Get current listener state from store using session ID
      const listener = roomStore.getListener(listenerId)
      
      if (!listener) {
        console.warn(`⚠️ [${listenerId}] No listener found for transport cleanup`)
        return
      }

      // Get transport from store state
      const transportOption = listener.receiveTransport.transport
      
      if (Option.isNone(transportOption)) {
        console.info(`ℹ️ [${listenerId}] No transport to clean up`)
        roomStore.actions.markListenerResourceClosed(listenerId, 'transport')
        return
      }

      const transport = Option.getOrNull(transportOption)
      if (!transport) {
        console.warn(`⚠️ [${listenerId}] Transport option was Some but value is null`)
        roomStore.actions.markListenerResourceClosed(listenerId, 'transport')
        return
      }

      console.info(`🔄 [${listenerId}] Found transport to cleanup: ${transport.id}`)

      // Setup async cleanup with event handling
      yield* _(Effect.async<void, MediaSoupCleanupError>((resolve) => {
        let isResolved = false
        let timeoutId: NodeJS.Timeout

        const resolveOnce = (result: Effect.Effect<void, MediaSoupCleanupError>) => {
          if (!isResolved) {
            isResolved = true
            clearTimeout(timeoutId)
            resolve(result)
          }
        }

        // Handle connection state changes - transport becomes closed when disconnected or failed
        const onConnectionStateChange = (state: string) => {
          console.info(`✅ [${listenerId}] Transport connection state changed: ${state}`)
          
          // Consider transport closed when it's in a final state
          if (state === 'closed' || state === 'failed' || state === 'disconnected') {
            console.info(`✅ [${listenerId}] Transport reached final state: ${state}`)
            
            // Update store to mark transport as closed
            roomStore.actions.markListenerResourceClosed(listenerId, 'transport')
            
            resolveOnce(Effect.void)
          }
        }

        // Set up event listener for connection state changes
        transport.on('connectionstatechange', onConnectionStateChange)

        // Set timeout for cleanup
        timeoutId = setTimeout(() => {
          console.warn(`⏰ [${listenerId}] Transport cleanup timeout, forcing cleanup`)
          
          // Clean up event listener
          transport.off('connectionstatechange', onConnectionStateChange)
          
          // Force store update
          roomStore.actions.markListenerResourceClosed(listenerId, 'transport')
          
          resolveOnce(Effect.fail(new MediaSoupCleanupError(
            `Transport cleanup timeout after ${timeoutMs}ms`,
            'transport',
            listenerId,
            { transportId: transport.id, timeout: timeoutMs }
          )))
        }, timeoutMs)

        // Close the transport
        try {
          console.info(`🛑 [${listenerId}] Calling transport.close()`)
          if (typeof transport.close === 'function') {
            transport.close()
            
            // If we're leaving intentionally, don't wait for connection state events
            // Transport.close() should be synchronous, so we can resolve immediately
            if (isLeaving) {
              console.info(`📤 [${listenerId}] Leaving mode - resolving transport cleanup immediately`)
              roomStore.actions.markListenerResourceClosed(listenerId, 'transport')
              transport.off('connectionstatechange', onConnectionStateChange)
              resolveOnce(Effect.void)
              return
            }
          } else {
            console.warn(`⚠️ [${listenerId}] Transport does not have close method`)
            resolveOnce(Effect.void)
          }
        } catch (error) {
          console.error(`❌ [${listenerId}] Error calling transport.close():`, error)
          resolveOnce(Effect.fail(new MediaSoupCleanupError(
            `Failed to call transport.close(): ${error}`,
            'transport',
            listenerId,
            { error, transportId: transport.id }
          )))
        }

        // Return cleanup function
        return Effect.sync(() => {
          clearTimeout(timeoutId)
          transport.off('connectionstatechange', onConnectionStateChange)
        })
      }))

      console.info(`✅ [${listenerId}] Transport cleanup completed successfully`)
    }),
    Effect.catchAll((error) => {
      console.error(`❌ [${listenerId}] Transport cleanup failed:`, error)
      // Ensure store is updated even on failure
      roomStore.actions.markListenerResourceClosed(listenerId, 'transport')
      return Effect.fail(error)
    })
  )

/**
 * Clean up WebSocket with store updates
 */
export const cleanupWebSocketWithStore = (
  roomStore: RoomStore,
  listenerId: string,
  timeoutMs: number = 3000
): Effect.Effect<void, MediaSoupCleanupError> =>
  pipe(
    Effect.gen(function* (_) {
      console.info(`🧹 [${listenerId}] Starting WebSocket cleanup with store updates`)
      
      // Get current listener state from store using session ID
      const listener = roomStore.getListener(listenerId)
      
      if (!listener) {
        console.warn(`⚠️ [${listenerId}] No listener found for WebSocket cleanup`)
        return
      }

      // Get WebSocket from store state
      const wsOption = listener.websocket.websocket
      
      if (Option.isNone(wsOption)) {
        console.info(`ℹ️ [${listenerId}] No WebSocket to clean up`)
        roomStore.actions.markListenerResourceClosed(listenerId, 'websocket')
        return
      }

      const ws = Option.getOrNull(wsOption)
      if (!ws) {
        console.warn(`⚠️ [${listenerId}] WebSocket option was Some but value is null`)
        roomStore.actions.markListenerResourceClosed(listenerId, 'websocket')
        return
      }

      console.info(`🔄 [${listenerId}] Found WebSocket to cleanup, state: ${ws.readyState}`)

      // If already closed, just update store
      if (ws.readyState === WebSocket.CLOSED) {
        console.info(`ℹ️ [${listenerId}] WebSocket already closed`)
        roomStore.actions.markListenerResourceClosed(listenerId, 'websocket')
        return
      }

      // Setup async cleanup with event handling
      yield* _(Effect.async<void, MediaSoupCleanupError>((resolve) => {
        let isResolved = false
        let timeoutId: NodeJS.Timeout

        const resolveOnce = (result: Effect.Effect<void, MediaSoupCleanupError>) => {
          if (!isResolved) {
            isResolved = true
            clearTimeout(timeoutId)
            resolve(result)
          }
        }

        // Handle close event
        const onClose = () => {
          console.info(`✅ [${listenerId}] WebSocket close event received`)
          
          // Update store to mark WebSocket as closed
          roomStore.actions.markListenerResourceClosed(listenerId, 'websocket')
          
          // Clean up event listener
          ws.removeEventListener('close', onClose)
          
          resolveOnce(Effect.void)
        }

        // Set up event listener
        ws.addEventListener('close', onClose)

        // Set timeout for cleanup
        timeoutId = setTimeout(() => {
          console.warn(`⏰ [${listenerId}] WebSocket cleanup timeout, forcing cleanup`)
          
          // Clean up event listener
          ws.removeEventListener('close', onClose)
          
          // Force store update
          roomStore.actions.markListenerResourceClosed(listenerId, 'websocket')
          
          resolveOnce(Effect.fail(new MediaSoupCleanupError(
            `WebSocket cleanup timeout after ${timeoutMs}ms`,
            'websocket',
            listenerId,
            { readyState: ws.readyState, timeout: timeoutMs }
          )))
        }, timeoutMs)

        // Close the WebSocket
        try {
          console.info(`🛑 [${listenerId}] Calling WebSocket.close()`)
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close()
          } else {
            console.info(`ℹ️ [${listenerId}] WebSocket not in closable state: ${ws.readyState}`)
            resolveOnce(Effect.void)
          }
        } catch (error) {
          console.error(`❌ [${listenerId}] Error calling WebSocket.close():`, error)
          resolveOnce(Effect.fail(new MediaSoupCleanupError(
            `Failed to call WebSocket.close(): ${error}`,
            'websocket',
            listenerId,
            { error, readyState: ws.readyState }
          )))
        }

        // Return cleanup function
        return Effect.sync(() => {
          clearTimeout(timeoutId)
          ws.removeEventListener('close', onClose)
        })
      }))

      console.info(`✅ [${listenerId}] WebSocket cleanup completed successfully`)
    }),
    Effect.catchAll((error) => {
      console.error(`❌ [${listenerId}] WebSocket cleanup failed:`, error)
      // Ensure store is updated even on failure
      roomStore.actions.markListenerResourceClosed(listenerId, 'websocket')
      return Effect.fail(error)
    })
  )