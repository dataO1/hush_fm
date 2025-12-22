/**
 * Listener Application Service
 * 
 * Effect-TS service for listener workflow orchestration.
 * Uses Context.Tag pattern for all dependencies - no direct imports.
 * Follows Schema-First architecture to avoid circular dependencies.
 * 
 * Responsibilities:
 * - Join room as listener (10-step flow)
 * - Leave room and cleanup
 * - Control audio playback
 * - Handle stream events (pause/resume)
 * - Manage listener session state
 */

import { Effect, Context, Layer, Option as O, pipe } from 'effect'
import { WebRTCConnectionState } from '../../domain/schemas/room.schema'

// Import only adapters via Context.Tag
import { ConnectionAdapter } from '../../stores/adapters/connection.adapter'
import { ListenersAdapter } from '../../stores/adapters/listeners.adapter'
import { WebRTCAdapter } from '../../stores/adapters/webrtc.adapter'
import { RoomMetadataAdapter } from '../../stores/adapters/room-metadata.adapter'

// Import only infrastructure via Context.Tag
import { WebSocketClient } from '../infrastructure/websocket/WebSocketClient'
import { MediaSoupClient } from '../infrastructure/MediaSoupClient'
import { AudioClient } from '../infrastructure/AudioClient'

/**
 * Listener join result (using schema types only)
 */
export interface ListenerJoinResult {
  listenerId: string
  roomId: string
  sessionId: string
  joinedAt: Date
}

/**
 * Listener Service Error
 */
export class ListenerServiceError extends Error {
  constructor(
    message: string,
    public operation: string,
    public step: string,
    public stepNumber: number,
    public recoverable: boolean = false,
    public cause?: unknown
  ) {
    super(message)
    this.name = 'ListenerServiceError'
  }
}

/**
 * Listener Service Interface
 * 
 * Pure business logic interface - no store dependencies.
 */

/**
 * Listener Service Context Tag
 * 
 * Uses modern 2025 Effect-TS class-based Tag syntax.
 * Acts as both type and value for clean dependency injection.
 */
export class ListenerService extends Context.Tag("@app/services/ListenerService")<
  ListenerService,
  {
    readonly joinRoom: (roomId: string, sessionId: string, listenerWebSocketUrl: string) => Effect.Effect<ListenerJoinResult, ListenerServiceError, ListenersAdapter | ConnectionAdapter | WebRTCAdapter | RoomMetadataAdapter | WebSocketClient | MediaSoupClient | AudioClient>
    readonly leaveRoom: (listenerId: string) => Effect.Effect<void, ListenerServiceError, ListenersAdapter | ConnectionAdapter | WebRTCAdapter | RoomMetadataAdapter | WebSocketClient | MediaSoupClient>
    readonly controlAudio: (listenerId: string, action: 'play' | 'pause' | 'setVolume', value?: number) => Effect.Effect<void, ListenerServiceError, ListenersAdapter>
    readonly handleManualPlay: (listenerId: string) => Effect.Effect<void, ListenerServiceError, ListenersAdapter>
    readonly checkExistingResources: (roomId: string, sessionId: string) => Effect.Effect<ListenerJoinResult | null, ListenerServiceError, ListenersAdapter | ConnectionAdapter>
    readonly cleanupListenerResources: (listenerId: string, isLeaving?: boolean) => Effect.Effect<void, ListenerServiceError, ListenersAdapter>
  }
>() {}

/**
 * Listener Service Implementation
 * 
 * Uses Effect.gen for all operations and Context.Tag for all dependencies.
 * No direct imports - everything comes through the context.
 */
const ListenerServiceImpl = {
  /**
   * Check for existing working resources to avoid full reconnection flow
   */
  checkExistingResources: (roomId: string, sessionId: string) =>
    Effect.gen(function* () {
      console.info('🔍 Checking for existing MediaSoup resources for listener:', sessionId)
      
      const listenerAdapter = yield* ListenersAdapter
      const connectionAdapter = yield* ConnectionAdapter
      
      const existingListener = listenerAdapter.getListenerState(sessionId)
      
      if (existingListener) {
        console.info('🔍 Found existing listener, checking resources validity')
        
        // Proper check for working resources using Option matching
        const hasWorkingResources = pipe(
          existingListener,
          (listener) => {
            // Check if we're in streaming step
            if (listener.currentStep !== 'streaming') return false
            
            // Check receive transport exists and is connected
            const transportCheck = pipe(
              listener.receiveTransport,
              O.match({
                onNone: () => false,
                onSome: (transport) => transport.connected
              })
            )
            
            // Check consumer exists and has a consumer object
            const consumerCheck = pipe(
              listener.consumer,
              O.match({
                onNone: () => false,
                onSome: (consumer) => pipe(
                  consumer.consumer,
                  O.match({
                    onNone: () => false,
                    onSome: () => true
                  })
                )
              })
            )
            
            // Check audio playback exists and has audio element
            const audioCheck = pipe(
              listener.audioPlayback,
              O.match({
                onNone: () => false,
                onSome: (audio) => pipe(
                  audio.audioElement,
                  O.match({
                    onNone: () => false,
                    onSome: () => true
                  })
                )
              })
            )
            
            return transportCheck && consumerCheck && audioCheck
          }
        )
        
        if (hasWorkingResources) {
          console.info('✅ Found existing working resources, reusing connection')
          
          connectionAdapter.setConnectionState('STREAMING' as any)
          
          return {
            listenerId: sessionId,
            roomId,
            sessionId,
            joinedAt: O.getOrElse(existingListener.flowStartedAt, () => new Date())
          }
        } else {
          console.info('⚠️ Found existing listener but resources are not working')
        }
      }
      
      console.info('ℹ️ No existing working resources found')
      return null
    }),

  /**
   * Join room as listener - simplified 10-step flow
   */
  joinRoom: (roomId: string, sessionId: string, listenerWebSocketUrl: string) =>
    Effect.gen(function* () {
      console.info('🎧 Starting listener join flow for room:', roomId)
      
      const listenerAdapter = yield* ListenersAdapter
      const connectionAdapter = yield* ConnectionAdapter
      const webrtcAdapter = yield* WebRTCAdapter
      const roomMetadataAdapter = yield* RoomMetadataAdapter
      const wsClient = yield* WebSocketClient
      const mediaSoupClient = yield* MediaSoupClient
      const audioClient = yield* AudioClient

      // Step 0: Check for existing working resources
      const existingResult = yield* ListenerServiceImpl.checkExistingResources(roomId, sessionId)
      if (existingResult !== null) {
        return existingResult
      }

      // Step 1: Create WebSocket connection
      console.info('✅ Step 1: Creating listener WebSocket connection')
      
      const listenerWebSocket = yield* wsClient.connect({
        url: listenerWebSocketUrl,
        connectionTimeout: 10000
      })
      
      // Initialize listener in store
      listenerAdapter.updateListenerState(sessionId, {
        currentStep: 'connecting',
        flowStartedAt: O.some(new Date()),
        websocket: {
          websocket: O.some(listenerWebSocket),
          connectionState: 'connected',
          url: O.some(listenerWebSocketUrl),
          connectedAt: O.some(new Date()),
          lastMessageAt: O.none(),
          messageCount: 0,
          connectionError: O.none()
        }
      } as any)

      // Step 2-3: Get router capabilities for the room
      console.info('✅ Step 2-3: Getting router capabilities')
      const routerCapabilitiesResult = yield* wsClient.getListenerRouterCapabilities(listenerWebSocket, roomId)

      // Step 4: Create MediaSoup device with native RTP capabilities
      const device = yield* mediaSoupClient.createDevice(routerCapabilitiesResult.rtpCapabilities)

      // Step 5-6: Initialize listener transport and get transport options
      console.info('✅ Step 5-6: Setting up listener transport')
      const transportResult = yield* wsClient.initListenerTransport(listenerWebSocket)
      const receiveTransport = yield* mediaSoupClient.createReceiveTransport(device, transportResult.transportOptions)

      // Step 8: Request consumer with device capabilities (transformation handled internally)
      console.info('✅ Step 8: Requesting consumer creation')
      const consumerResult = yield* wsClient.requestListenerConsumer(listenerWebSocket, device.rtpCapabilities)

      // Step 9: Create consumer
      console.info('✅ Step 9: Creating consumer')
      const consumer = yield* mediaSoupClient.createConsumer(receiveTransport, consumerResult.consumerParameters)
      const audioElement = yield* audioClient.createAudioElement()

      // Step 10: Set up audio playback
      audioElement.srcObject = new MediaStream([consumer.track])
      audioElement.volume = 0.8
      audioElement.autoplay = true

      // Handle autoplay blocked
      yield* Effect.tryPromise({
        try: () => audioElement.play(),
        catch: (error: any) => {
          if (error.name === 'NotAllowedError') {
            console.info('🚫 Autoplay blocked')
            listenerAdapter.setListenerAutoplayBlocked(sessionId, true)
          }
          return error
        }
      })

      // Mark as streaming
      listenerAdapter.setListenerFlowStep(sessionId, 'streaming')
      connectionAdapter.setConnectionState('STREAMING' as any)
      webrtcAdapter.setStatus(WebRTCConnectionState.CONNECTED)

      // Update room metadata
      roomMetadataAdapter.setRoomMetadata({
        id: roomId,
        name: `Room ${roomId}`,
        djName: 'DJ',
        description: O.none(),
        isPublic: true,
        createdAt: new Date(),
        tags: []
      })

      console.info('🎉 Listener join flow completed successfully!')

      return {
        listenerId: sessionId,
        roomId,
        sessionId,
        joinedAt: new Date()
      }
    }),

  /**
   * Leave room as listener - cleanup flow
   */
  leaveRoom: (listenerId: string) =>
    Effect.gen(function* () {
      console.info('👋 Leaving room as listener:', listenerId)

      const listenerAdapter = yield* ListenersAdapter
      const connectionAdapter = yield* ConnectionAdapter
      const wsClient = yield* WebSocketClient
      const mediaSoupClient = yield* MediaSoupClient

      const listener = listenerAdapter.getListenerState(listenerId)
      if (!listener) {
        console.warn('No listener found with ID:', listenerId)
        return
      }

      // Send leaveRoom command if WebSocket is open
      yield* pipe(
        listener.websocket.websocket,
        O.match({
          onNone: () => Effect.void,
          onSome: (ws) => {
            if (ws.readyState === WebSocket.OPEN) {
              console.info('📡 Sending leaveRoom command to backend')
              return Effect.catchAll(
                wsClient.leaveListenerRoom(ws),
                () => Effect.void
              )
            }
            return Effect.void
          }
        })
      )

      // Cleanup resources
      yield* pipe(
        listener.consumer,
        O.match({
          onNone: () => Effect.void,
          onSome: (consumerState) => pipe(
            consumerState.consumer,
            O.match({
              onNone: () => Effect.void,
              onSome: (consumer) => Effect.catchAll(
                mediaSoupClient.closeConsumer(consumer),
                () => Effect.void
              )
            })
          )
        })
      )

      yield* pipe(
        listener.receiveTransport,
        O.match({
          onNone: () => Effect.void,
          onSome: (transportState) => pipe(
            transportState.transport,
            O.match({
              onNone: () => Effect.void,
              onSome: (transport) => Effect.catchAll(
                mediaSoupClient.closeTransport(transport),
                () => Effect.void
              )
            })
          )
        })
      )

      yield* pipe(
        listener.websocket.websocket,
        O.match({
          onNone: () => Effect.void,
          onSome: (ws) => Effect.catchAll(
            wsClient.close(ws),
            () => Effect.void
          )
        })
      )

      // Update stores
      connectionAdapter.setConnectionState('DISCONNECTED' as any)
      listenerAdapter.removeListener(listenerId)

      console.info('✅ Leave room as listener flow completed successfully')
    }),

  /**
   * Control audio playback for listener
   */
  controlAudio: (listenerId: string, action: 'play' | 'pause' | 'setVolume', value?: number) =>
    Effect.gen(function* () {
      const listenerAdapter = yield* ListenersAdapter

      const listener = listenerAdapter.getListenerState(listenerId)
      if (!listener) {
        throw new ListenerServiceError(
          `Listener ${listenerId} not found`,
          'controlAudio',
          action,
          1,
          false
        )
      }

      // Execute action
      switch (action) {
        case 'play':
          listenerAdapter.setListenerMuted(listenerId, false)
          break
        case 'pause':
          listenerAdapter.setListenerMuted(listenerId, true)
          break
        case 'setVolume':
          if (typeof value === 'number') {
            const clampedVolume = Math.max(0, Math.min(1, value))
            listenerAdapter.setListenerVolume(listenerId, clampedVolume)
          }
          break
      }
    }),

  /**
   * Handle manual play for autoplay-blocked audio
   */
  handleManualPlay: (listenerId: string) =>
    Effect.gen(function* () {
      console.info('▶️ Handling manual play for autoplay-blocked audio')

      const listenerAdapter = yield* ListenersAdapter

      const listener = listenerAdapter.getListenerState(listenerId)
      if (!listener) {
        throw new ListenerServiceError(
          'Listener not found',
          'handleManualPlay',
          'manual_play',
          1,
          true
        )
      }

      // Properly handle nested Option types for audioPlayback
      yield* pipe(
        listener.audioPlayback,
        O.match({
          onNone: () => Effect.fail(new ListenerServiceError(
            'No audio playback state available for manual play',
            'handleManualPlay',
            'manual_play',
            1,
            true
          )),
          onSome: (audioPlayback) => pipe(
            audioPlayback.audioElement,
            O.match({
              onNone: () => Effect.fail(new ListenerServiceError(
                'No audio element available for manual play',
                'handleManualPlay',
                'manual_play',
                1,
                true
              )),
              onSome: (audioElement) => Effect.tryPromise({
                try: () => audioElement.play(),
                catch: (error) => new ListenerServiceError(
                  `Manual play failed: ${String(error)}`,
                  'handleManualPlay',
                  'manual_play',
                  2,
                  true,
                  error
                )
              })
            })
          )
        })
      )

      // Update store to clear autoplay blocked state
      listenerAdapter.setListenerAutoplayBlocked(listenerId, false)
      console.info('✅ Manual play successful, autoplay block cleared')
    }),

  /**
   * Cleanup listener MediaSoup resources
   */
  cleanupListenerResources: (listenerId: string, isLeaving = false) =>
    Effect.gen(function* () {
      console.info('🧹 Cleaning up listener MediaSoup resources:', { listenerId, isLeaving })

      const listenerAdapter = yield* ListenersAdapter

      const listener = listenerAdapter.getListenerState(listenerId)
      if (!listener) {
        console.info('No listener found for cleanup, skipping')
        return
      }

      // Clean up HTML audio element first
      pipe(
        listener.audioPlayback,
        O.match({
          onNone: () => {},
          onSome: (audioPlayback) => pipe(
            audioPlayback.audioElement,
            O.match({
              onNone: () => {},
              onSome: (audioElement) => {
                try {
                  audioElement.pause()
                  audioElement.srcObject = null
                  audioElement.removeAttribute('src')
                  audioElement.load()
                  console.info('✅ HTML audio element cleaned up')
                } catch (error) {
                  console.warn('⚠️ Audio element cleanup failed:', error)
                }
              }
            })
          )
        })
      )

      // MediaSoup resource cleanup is handled by the Effect-based cleanup above

      // Close WebSocket if leaving
      if (isLeaving) {
        pipe(
          listener.websocket.websocket,
          O.match({
            onNone: () => {},
            onSome: (ws) => {
              try {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.close()
                  console.info('✅ Listener WebSocket closed')
                }
              } catch (error) {
                console.warn('⚠️ WebSocket cleanup warning:', error)
              }
            }
          })
        )
      }

      console.info('✅ Listener cleanup completed')
    })
}


/**
 * Listener Service Live Implementation Layer
 * 
 * Provides the ListenerService implementation through Effect Layer system.
 */
export const ListenerServiceLive = Layer.succeed(
  ListenerService,
  ListenerService.of(ListenerServiceImpl)
)