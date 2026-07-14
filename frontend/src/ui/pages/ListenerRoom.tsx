import { Show, createResource, createSignal, onCleanup, createContext, useContext, ParentComponent, createEffect } from 'solid-js'
import { useParams, useNavigate, useLocation } from '@solidjs/router'
import { Option, Effect, Context, ManagedRuntime, Layer, Schedule, Duration } from 'effect'
import { useConnectionAdapter, useAudioAdapter, useUserAdapter, useAudioClient, useLobbyAdapter } from '../../App'
import { UserService, UserServiceLive } from '../../services/application/UserService'
import { AudioClient } from '../../services/infrastructure/AudioClient'
import { AudioAdapter } from '../../stores/audio'
import { UserAdapter, ConnectionAdapter } from '../../stores'
import { WebrtcConnectionState, ConnectionDroppedError } from '../../domain/schemas/connection.schema'
import { Oscilloscope } from '../components/shared/Oscilloscope'
import { ListenerCountBadge } from '../components/shared/ListenerCountBadge'
import { WebRTCErrorHandler } from '../components/WebRTCErrorHandler'
import { RoomHeader } from '../components/room/RoomHeader'
import { ConnectionStatusGroup } from '../components/streaming/ConnectionStatusGroup'
import { UserInteractionModal } from '../components/UserInteractionModal'
import { config } from '../../config'

// Utility function to construct WebSocket URLs from route params  
const constructListenerWebSocketUrl = (roomId: string, sessionId: string): string => {
  return `${config.websocket.baseUrl}/ws/listener/${roomId}/${sessionId}`
}

// User Feature Service Context (for Listener operations) - only User service needed
interface UserFeatureContextValue {
  userService: Context.Tag.Service<UserService>
}

const UserFeatureContext = createContext<UserFeatureContextValue>()

const UserFeatureProvider: ParentComponent = (props) => {
  // Create user feature services using scoped runtime to keep them alive for component lifecycle
  // Provide all necessary adapter dependencies (same pattern as DJRoom)
  const userAdapter = useUserAdapter()
  const connectionAdapter = useConnectionAdapter()
  const audioAdapter = useAudioAdapter()
  const audioClient = useAudioClient()
  
  const userServiceRuntime = ManagedRuntime.make(
    UserServiceLive.pipe(
      Layer.provide(Layer.succeed(UserAdapter, userAdapter)),
      Layer.provide(Layer.succeed(ConnectionAdapter, connectionAdapter)),
      Layer.provide(Layer.succeed(AudioAdapter, audioAdapter)),
      Layer.provide(Layer.succeed(AudioClient, audioClient))
    )
  )
  
  const userService = userServiceRuntime.runSync(UserService)
  
  const services: UserFeatureContextValue = {
    userService
  }
  
  // Cleanup on unmount
  onCleanup(async () => {
    console.info('🏠 UserFeatureProvider: Cleaning up on unmount')
    try {
      await userService.disconnect().pipe(Effect.runPromise)
      await userServiceRuntime.dispose()
    } catch (error) {
      console.warn('⚠️ UserFeatureProvider: Error during cleanup:', error)
    }
  })
  
  return (
    <UserFeatureContext.Provider value={services}>
      {props.children}
    </UserFeatureContext.Provider>
  )
}

const useUserFeature = () => {
  const context = useContext(UserFeatureContext)
  if (!context) {
    throw new Error('useUserFeature must be used within UserFeatureProvider')
  }
  return context
}


function ListenerRoomContent() {
  const params = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  // SolidJS 2025: Use Effect services through hooks
  // Use adapters for reactive state (read-only)
  const connectionAdapter = useConnectionAdapter()
  const audioAdapter = useAudioAdapter()
  const userAdapter = useUserAdapter()
  const lobbyAdapter = useLobbyAdapter()

  // Get scoped user feature services
  const { userService } = useUserFeature()
  
  // Get global audio client
  const audioClient = useAudioClient()

  // Get data from navigation state (from Landing.tsx)
  const navigationState = location.state as {
    listenerWebSocketUrl?: string
    sessionId?: string
    isReturning?: boolean
    roomInfo?: {
      id: string
      name: string
      djName: string
      description?: string
      tags?: string[]
      listenerCount?: number
      isPublic?: boolean
    }
  } || {}

  // SolidJS 2025: Computed values from adapters (read-only)
  const connectionState = () => connectionAdapter.getConnectionState()
  const isConnecting = () => connectionState()?.webrtcConnectionState === WebrtcConnectionState.CONNECTING
  const connectionError = () => Option.getOrNull(connectionAdapter.getError())
  const hasConnectionError = () => connectionAdapter.hasError()

  // Live listener count for this room — reactive read straight off the adapter
  // (UserService's listenerCountUpdated subscription writes it into the store).
  const listenerCount = () => connectionAdapter.getListenerCount()

  // Room information from params and navigation state
  const roomId = () => params.roomId
  const roomName = () => navigationState.roomInfo?.name || `Room ${roomId()}`

  // Get WebRTC state getter for connection dot
  const getWebrtcState = () => connectionState()?.webrtcConnectionState || WebrtcConnectionState.DISCONNECTED

  // B1+B2 — In-room terminal card state. When the DJ closes the room (roomClosed)
  // or the session expires (listenerNotFound), the recovery coordinator's
  // onTerminal fires with a kind + message. We render a CALM in-room card here
  // (neutral for roomClosed, still-not-red for the error case) with a single
  // "Back to rooms" action — instead of silently navigating to '/' and relying on
  // a red lobby banner that may not survive the route change. Audio teardown is
  // already done inside enterTerminal before this fires.
  const [terminalState, setTerminalState] = createSignal<
    { kind: 'roomClosed' | 'error'; message: string } | null
  >(null)

  // L11 — Differentiate first-connect from the #11 silent mid-join retry. Both
  // show "Connecting…"; after ~5 s still connecting we swap copy to reassure the
  // guest it isn't frozen. Timer is (re)armed by the createEffect below.
  const [connectingSlow, setConnectingSlow] = createSignal(false)

  // Audio stream is accessed directly via signal in template

  // SolidJS 2025: Use createResource for room joining with connection setup
  const [joinRoomOperation] = createResource(async () => {
    let sessionId = navigationState.sessionId
    let listenerWebSocketUrl = navigationState.listenerWebSocketUrl
    const roomInfo = navigationState.roomInfo
    const isReturning = navigationState.isReturning
    const currentRoomId = roomId()

    // Handle missing data (direct URL access or reload)
    if (!sessionId || !listenerWebSocketUrl) {
      console.info('🔄 ListenerRoom: Missing session data, inferring from URL...', {
        roomId: currentRoomId,
        hasSessionId: !!sessionId,
        hasWebSocketUrl: !!listenerWebSocketUrl
      })
      
      // Use existing session ID from user adapter (global session)
      if (!sessionId) {
        const existingSessionId = userAdapter.getSessionId()
        if (Option.isSome(existingSessionId)) {
          sessionId = existingSessionId.value
          console.info('🆔 ListenerRoom: Using existing session ID from user adapter:', sessionId)
        } else {
          console.error('❌ ListenerRoom: No session ID available - user not initialized')
          navigate('/')
          return null
        }
      }
      
      // Construct WebSocket URL directly from route params (no lobby service needed)
      try {
        listenerWebSocketUrl = constructListenerWebSocketUrl(currentRoomId, sessionId)
        console.info('✅ ListenerRoom: Constructed listener WebSocket URL from route params:', listenerWebSocketUrl)
        
      } catch (error) {
        console.error('❌ ListenerRoom: Failed to construct listener connection URL:', error)
        navigate('/')
        return null
      }
    }
    
    console.info('🎧 Starting listener join flow via Application Service:', {
      roomId: currentRoomId,
      sessionId: sessionId,
      listenerWebSocketUrl: listenerWebSocketUrl,
      hasRoomInfo: !!roomInfo,
      isReturning: !!isReturning
    })
    
    // #11 — Mid-handshake WiFi blip must NOT freeze the spinner for 30 s.
    // The join is a multi-command WS handshake; if the socket drops mid-flight,
    // WebSocketClient's onclose now fast-fails the awaiting command with
    // ConnectionDroppedError (instead of hanging to the 30 s timeout). Here we
    // silently re-attempt the WHOLE connect+join under the existing spinner —
    // connect() re-establishes the socket (its own bounded retries ride out the
    // blip / recovery reconnect), then the handshake re-runs clean — repeating
    // ONLY on ConnectionDroppedError, bounded by a 15 s wall-clock budget.
    const wsUrl = listenerWebSocketUrl
    const meta = { roomName: roomInfo?.name, djName: roomInfo?.djName }

    const connectAndJoin = userService.connect(wsUrl).pipe(
      Effect.andThen(() => userService.joinRoomAsListener(currentRoomId, sessionId, meta))
    )

    // Retry ONLY on ConnectionDroppedError (a real WiFi blip / reconnect), never
    // on genuine join failures (codec mismatch, etc.). Schedule.upTo caps the
    // TOTAL elapsed retry time at 15 s; the 1 s spacing gives the socket time to
    // come back between attempts.
    const retrySchedule = Schedule.spaced(Duration.seconds(1)).pipe(
      Schedule.upTo(Duration.seconds(15))
    )

    console.info('🔗 ListenerRoom: Connecting + joining (retriable on connection drop)...', { wsUrl })
    return await connectAndJoin.pipe(
      Effect.retry({
        schedule: retrySchedule,
        while: (error) => error._tag === 'ConnectionDroppedError'
      }),
      Effect.tap(() => Effect.sync(() =>
        console.info('✅ Listener join flow completed successfully')
      )),
      // Budget exhausted while still dropping → bounce to lobby with a banner.
      // Other errors (UserServiceError) fall through to the resource error path
      // (existing in-room "Failed to join room" panel).
      Effect.catchIf(
        (error): error is ConnectionDroppedError =>
          error._tag === 'ConnectionDroppedError',
        () => Effect.sync(() => {
          console.warn('⚠️ ListenerRoom: Connection kept dropping during join — bouncing to lobby')
          lobbyAdapter.setCreationError(
            `Lost connection while joining ${roomName()} — please try again.`
          )
          navigate('/')
          return null
        })
      ),
      Effect.runPromise
    )
  })

  // Effect to set up audio playback when stream changes
  // createEffect(() => {
  //   const stream = currentStream()
  //   Option.match(stream, {
  //     onSome: (s) => setupAudioPlayback(s),
  //     onNone: () => {}
  //   })
  // })




  // SolidJS 2025: Use createResource for leaving room
  const [leaveRoomRequest, setLeaveRoomRequest] = createSignal<boolean>(false)
  
  const [leaveRoomOperation] = createResource(leaveRoomRequest, async (shouldLeave) => {
    if (!shouldLeave) return null
    
    console.info('🚪 Initiating leave room flow via Application Service')
    
    const listenerId = roomId()
    if (listenerId) {
      console.info('📡 Calling leaveRoomAndNavigate Application Service')
      
      const result = await userService.leaveListenerRoom(listenerId).pipe(Effect.runPromise)
      console.info('✅ Leave room Application Service completed')
      
      // Navigate back to lobby after successful cleanup
      console.info('🔙 Navigating back to lobby')
      navigate('/')
      
      return result
    }
    
    // Navigate anyway if no listener ID
    navigate('/')
    return null
  })
  
  const leaveRoom = () => {
    setLeaveRoomRequest(true)
  }

  // ── Recovery coordinator ───────────────────────────────────────────────────
  // Started exactly once after the initial joinRoomAsListener succeeds.
  // Monitors {WS alive × transport dead} and takes the appropriate action
  // without ever touching a working session (the iOS lock-screen safe path).
  let recoveryCleanup: (() => void) | null = null

  createEffect(() => {
    const result = joinRoomOperation()
    // Only start coordinator on successful initial join; guard with null-check so
    // it never starts twice (createEffect re-runs on every reactive read change).
    if (result && recoveryCleanup === null) {
      Effect.runPromise(
        userService.startListenerRecovery({
          roomId: roomId(),
          sessionId: result.sessionId,
          meta: {
            roomName: navigationState.roomInfo?.name,
            djName: navigationState.roomInfo?.djName
          },
          // canRecover: initial join is complete by the time this runs,
          // so no additional guard is needed here.
          canRecover: () => !joinRoomOperation.loading && !!joinRoomOperation(),
          onTerminal: (info) => {
            // B1+B2 — Surface a calm in-room terminal card instead of navigating
            // away and hoping a red lobby banner survives the route change. The
            // card's "Back to rooms" button does the navigate('/') explicitly.
            console.info('ListenerRoom: Session terminal —', info.kind, info.message)
            setTerminalState(info)
          }
        })
      ).then(cleanup => {
        recoveryCleanup = cleanup
      }).catch(error => {
        console.error('ListenerRoom: Failed to start recovery coordinator:', error)
      })
    }
  })

  // L11 — Arm a 5 s "still connecting" timer whenever we enter the connecting
  // state; clear it (and reset the flag) the moment we leave it. Using a tracked
  // createEffect so it re-arms on every transition into connecting (e.g. the #11
  // mid-join retry re-entering the spinner). Timer is cleared on cleanup.
  let slowConnectTimer: ReturnType<typeof setTimeout> | null = null
  createEffect(() => {
    const connecting = isConnecting() || joinRoomOperation.loading
    if (connecting) {
      if (slowConnectTimer === null) {
        slowConnectTimer = setTimeout(() => {
          setConnectingSlow(true)
          slowConnectTimer = null
        }, 5000)
      }
    } else {
      if (slowConnectTimer !== null) {
        clearTimeout(slowConnectTimer)
        slowConnectTimer = null
      }
      setConnectingSlow(false)
    }
  })
  onCleanup(() => {
    if (slowConnectTimer !== null) {
      clearTimeout(slowConnectTimer)
      slowConnectTimer = null
    }
  })

  // X3: pagehide (tab close / swipe-away / bfcache navigation) — fire-and-forget
  // LeaveRoom over the open WS so the server frees the slot immediately.
  // registerPagehideLeave is synchronous (Effect.sync); unregistered in onCleanup.
  const unregisterPagehideLeave = userService.registerPagehideLeave().pipe(Effect.runSync)

  // Cleanup on component unmount
  onCleanup(async () => {
    // X3: full client-side teardown on navigate-away — best-effort LeaveRoom
    // (server frees the slot immediately instead of after the reaper grace),
    // stop audio playback, close all MediaSoup resources, then the WS.
    // The explicit Leave button still uses leaveListenerRoom().
    console.info('🧹 ListenerRoom: Component cleanup - full teardown of user service')
    try {
      // Stop recovery coordinator before tearing down (sets terminal=true internally)
      if (recoveryCleanup) {
        recoveryCleanup()
        recoveryCleanup = null
      }
      unregisterPagehideLeave()
      await userService.teardownOnUnmount().pipe(Effect.runPromise)
    } catch (error) {
      console.warn('⚠️ ListenerRoom: Error during cleanup:', error)
    }
  })

  // Ensure this return block replaces your current broken return
  return (
    <div class="h-screen w-full bg-hush-main text-gruvbox-fg flex flex-col items-center justify-center p-4 sm:p-6">

      {/* Connection Error Handler */}
      <WebRTCErrorHandler 
        error={connectionError()}
        show={hasConnectionError()}
        onDismiss={() => connectionAdapter.clearError()}
        onCancel={() => navigate('/')}
      />

      <div class="card card-glass shadow-xl max-w-sm sm:max-w-md w-full mx-4 relative">
        <div class="card-body flex flex-col items-center gap-6 sm:gap-8 p-4 sm:p-6">

          {/* Join operation errors — B3: friendly copy only, raw error to console.
              The exact exception text used to leak here; now it's suppressed. */}
          <Show when={joinRoomOperation.error}>
            {(_err) => {
              console.error('ListenerRoom: join failed:', joinRoomOperation.error)
              return (
            <div class="w-full space-y-4">
              <div class="error-panel px-4 py-3 rounded-lg w-full">
                <div class="flex justify-between items-center">
                  <span class="text-sm">Couldn't join — please try again</span>
                  <button
                    class="text-gruvbox-red-bright hover:text-gruvbox-fg ml-4"
                    onClick={() => navigate('/')}
                  >
                    ✕
                  </button>
                </div>
              </div>
              
              <div class="text-center">
                <button
                  onClick={() => navigate('/')}
                  class="btn btn-outline btn-sm sm:btn-md w-36 sm:w-40 border-gruvbox-fg-2 text-gruvbox-fg-1 hover:bg-gruvbox-fg-2 hover:text-gruvbox-bg-hard"
                >
                  <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                  Back
                </button>
              </div>
            </div>
              )
            }}
          </Show>

          {/* B1+B2 — Terminal in-room card (DJ closed the room / session expired).
              Calm, not red: a neutral card explaining the set has ended, with the
              room/DJ name when available and a single "Back to rooms" primary
              action. Takes over the whole card body when present. */}
          <Show when={terminalState()}>
            {(term) => (
              <div class="w-full text-center space-y-5 py-4">
                <div class="w-16 h-16 mx-auto bg-gruvbox-bg-2 rounded-full flex items-center justify-center">
                  <svg class="w-8 h-8 text-gruvbox-fg-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
                  </svg>
                </div>
                <div>
                  <h3 class="text-xl sm:text-2xl font-bold text-gruvbox-fg mb-1">
                    {term().message}
                  </h3>
                  <Show when={navigationState.roomInfo?.djName || navigationState.roomInfo?.name}>
                    <p class="text-sm text-gruvbox-fg-3">
                      {navigationState.roomInfo?.djName
                        ? `${navigationState.roomInfo?.djName} · ${roomName()}`
                        : roomName()}
                    </p>
                  </Show>
                </div>
                <button
                  onClick={() => navigate('/')}
                  class="btn btn-hush w-full sm:w-auto sm:px-8 py-3"
                >
                  Back to rooms
                </button>
              </div>
            )}
          </Show>

          <Show when={!terminalState() && (isConnecting() || joinRoomOperation.loading)}>
            <div class="text-center py-8">
              <div class="loading loading-spinner loading-lg mx-auto mb-4"></div>
              {/* L11 — swap copy after ~5 s so a slow first-connect / #11 retry
                  doesn't read as frozen. */}
              <div class="text-lg sm:text-xl font-bold">
                {connectingSlow() ? 'Still connecting — hang tight…' : 'Connecting…'}
              </div>
            </div>
          </Show>

          <Show when={!terminalState() && !isConnecting() && !joinRoomOperation.loading && !joinRoomOperation.error}>
            
            {/* Room Header */}
            <RoomHeader 
              roomName={roomName}
              variant="center"
            />

            {/* Status Indicator - single source of truth from connection state */}
            <ConnectionStatusGroup
              webrtcState={getWebrtcState}
              dotSize="lg"
              layout="vertical"
            />

            {/* Live listener count — minimal, unobtrusive, top-right corner of
                the card. The status (Live/Paused/Connecting) is already shown by
                the dot above, so there's no separate "Listening live" line. */}
            <ListenerCountBadge count={listenerCount} />

            {/* Audio Oscilloscope - only show when stream exists AND user interaction is available */}
            <Show when={!audioAdapter.requiresUserGesture() && Option.getOrNull(audioClient.currentStream())} fallback={null}>
              {(stream) => (
                <div class="w-full">
                  <Oscilloscope
                    stream={stream()}
                    height={60}
                    class="mb-0"
                    // #9 — When the producer is paused (join-while-paused, or a
                    // live DJ pause), swap the dead/flat waveform for a ⏸ glyph
                    // attributed to the DJ. Derived from the same PAUSED webrtc
                    // state ConnectionStatusDot reads — the streamResumed
                    // broadcast flips it back to STREAMING automatically.
                    paused={() => getWebrtcState() === WebrtcConnectionState.PAUSED}
                    djName={navigationState.roomInfo?.djName}
                  />
                </div>
              )}
            </Show>

            {/* User Interaction Modal */}
            <UserInteractionModal
              requiresUserInteraction={audioAdapter.requiresUserGesture()}
              roomName={roomName()}
              djName={navigationState.roomInfo?.djName}
              onEnableAudio={async () => {
                try {
                  // Resume the ALREADY-connected stream inside this user gesture.
                  // Never connectRemoteStream here (X1): re-connecting the same
                  // stream would stop its own tracks (irreversible on iOS) or
                  // early-return without resuming the AudioContext.
                  const currentStream = audioClient.currentStream()
                  if (Option.isSome(currentStream)) {
                    console.info('🔊 ListenerRoom: Attempting to resume audio after user interaction')
                    await audioClient.resumePlayback({
                      roomName: roomName(),
                      djName: navigationState.roomInfo?.djName ?? 'HushFM DJ'
                    }).pipe(
                      Effect.provideService(AudioAdapter, audioAdapter),
                      Effect.runPromise
                    )
                    // Clear the gesture flag only AFTER resumePlayback resolved
                    // successfully (trust the tap — no re-verify loop). On failure
                    // the catch below leaves the modal up for another attempt.
                    audioAdapter.updateStreamState({ requiresUserGesture: false })
                  }
                } catch (error) {
                  console.error('❌ Failed to enable audio after user interaction:', error)
                }
              }}
              onCancel={() => navigate('/')}
            />


            {/* Leave Button */}
            <button
                onClick={leaveRoom}
                class="btn btn-outline btn-sm sm:btn-md mt-4 w-36 sm:w-40 border-gruvbox-red-bright text-gruvbox-red-bright hover:bg-gruvbox-red-bright hover:text-gruvbox-bg-hard gap-2"
                disabled={leaveRoomOperation.loading}
            >
                {leaveRoomOperation.loading ? (
                  <>
                    <span class="loading loading-spinner loading-sm"></span>
                    <span class="text-sm sm:text-base">Leaving...</span>
                  </>
                ) : (
                  <>
                    <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    <span class="text-sm sm:text-base">Leave</span>
                  </>
                )}
            </button>
            
            {/* Show leave operation errors */}
            <Show when={leaveRoomOperation.error}>
              <div class="text-red-400 text-sm text-center mt-2">
                Failed to leave room: {leaveRoomOperation.error.message}
              </div>
            </Show>

          </Show>
        </div>
      </div>
    </div>
  )
}

export default function ListenerRoom() {
  return (
    <UserFeatureProvider>
      <ListenerRoomContent />
    </UserFeatureProvider>
  )
}
