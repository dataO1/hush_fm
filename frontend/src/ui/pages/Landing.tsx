import { For, Show, createResource, createSignal, onCleanup, onMount, createContext, useContext, ParentComponent } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { Option as O, Effect, Context, ManagedRuntime, Layer } from 'effect'
import { useConnectionAdapter, useLobbyAdapter, useUserAdapter } from '../../App'
import { LobbyService, LobbyServiceLive } from '../../services/application/LobbyService'
import { LobbyAdapter, ConnectionAdapter } from '../../stores'
import ConnectionStatusDot from '../components/ConnectionStatusDot'
import { RoomCard } from '../components/room/RoomCard'
import type { LobbyRoomInfoType } from '../../domain/schemas/lobby.schema'
import { WebrtcConnectionState } from '../../domain/schemas/connection.schema'

// Lobby Feature Service Context
interface LobbyFeatureContextValue {
  lobbyService: Context.Tag.Service<LobbyService>
}

const LobbyFeatureContext = createContext<LobbyFeatureContextValue>()

const LobbyFeatureProvider: ParentComponent = (props) => {
  // Create lobby service using scoped runtime to keep it alive for component lifecycle
  // Provide all necessary adapter dependencies
  const lobbyAdapter = useLobbyAdapter()
  const connectionAdapter = useConnectionAdapter()
  const lobbyServiceRuntime = ManagedRuntime.make(
    LobbyServiceLive.pipe(
      Layer.provide(Layer.mergeAll(
        Layer.succeed(LobbyAdapter, lobbyAdapter),
        Layer.succeed(ConnectionAdapter, connectionAdapter)
      ))
    )
  )
  const lobbyService = lobbyServiceRuntime.runSync(LobbyService)
  
  const services: LobbyFeatureContextValue = {
    lobbyService
  }
  
  // Cleanup on unmount
  onCleanup(async () => {
    console.info('🏠 LobbyFeatureProvider: Cleaning up on unmount')
    try {
      await lobbyService.disconnectFromLobby().pipe(Effect.runPromise)
      await lobbyServiceRuntime.dispose()
    } catch (error) {
      console.warn('⚠️ LobbyFeatureProvider: Error during cleanup:', error)
    }
  })
  
  return (
    <LobbyFeatureContext.Provider value={services}>
      {props.children}
    </LobbyFeatureContext.Provider>
  )
}

const useLobbyFeature = () => {
  const context = useContext(LobbyFeatureContext)
  if (!context) {
    throw new Error('useLobbyFeature must be used within LobbyFeatureProvider')
  }
  return context
}

function LandingContent() {
  const navigate = useNavigate()

  // Use adapters for reactive state (read-only)
  const connectionAdapter = useConnectionAdapter()
  const lobbyAdapter = useLobbyAdapter()
  const userAdapter = useUserAdapter()
  
  
  // Get scoped lobby service
  const { lobbyService } = useLobbyFeature()
  
  // Set up cleanup when the component unmounts
  onCleanup(async () => {
    console.info('🏠 Landing: Cleaning up on component unmount')
    try {
      await lobbyService.disconnectFromLobby().pipe(Effect.runPromise)
    } catch (error) {
      console.warn('⚠️ Landing: Error during cleanup:', error)
    }
  })

  // SolidJS 2025: Use createResource for lobby initialization
  const [lobbyInitialization] = createResource(async () => {
    console.info('🏠 Landing: Checking active connections and initializing lobby...')
    
    // Check if we have active DJ streaming or listener connections
    const currentRole = userAdapter.getCurrentRole()
    const isDJStreaming = O.getOrNull(currentRole) === 'dj'
    const hasActiveListeners = connectionAdapter.isRoomConnected()
    
    console.info(`🔍 Landing: Connection state debug:`)
    console.info(`  🎤 DJ streaming: ${isDJStreaming}`)
    console.info(`  🎧 Has active listeners: ${hasActiveListeners}`)
    
    // Use scoped lobby service to connect
    console.info('🏠 Landing: Connecting to lobby')
    return await lobbyService.connectToLobby().pipe(Effect.runPromise)
  })

  // Load room list once on mount
  onMount(async () => {
    try {
      console.info('🏠 Landing: Loading initial room list...')
      await lobbyService.getRoomList().pipe(Effect.runPromise)
      console.info('✅ Landing: Room list loaded successfully')
    } catch (error) {
      console.error('❌ Landing: Failed to load room list:', error)
    }
  })

  // L1: Guard against a stuck "Connecting to lobby…" dead end. If the lobby
  // hasn't connected within the timeout, surface a retry affordance instead of
  // an infinite spinner. No store changes — pure client-side timer.
  const LOBBY_CONNECT_TIMEOUT_MS = 10_000
  const [lobbyTimedOut, setLobbyTimedOut] = createSignal(false)
  let lobbyTimeoutHandle: ReturnType<typeof setTimeout> | undefined

  const armLobbyTimeout = () => {
    if (lobbyTimeoutHandle) clearTimeout(lobbyTimeoutHandle)
    lobbyTimeoutHandle = setTimeout(() => {
      if (!connectionAdapter.isLobbyConnected()) {
        console.warn('⏱️ Landing: Lobby connect timed out — surfacing retry')
        setLobbyTimedOut(true)
      }
    }, LOBBY_CONNECT_TIMEOUT_MS)
  }

  // Re-run the same init the resource/onMount perform: connect to the lobby and
  // refetch the room list. Used by both the initial arm and the retry button.
  const retryLobbyConnection = async () => {
    setLobbyTimedOut(false)
    armLobbyTimeout()
    try {
      console.info('🔄 Landing: Retrying lobby connection...')
      await lobbyService.connectToLobby().pipe(Effect.runPromise)
      await lobbyService.getRoomList().pipe(Effect.runPromise)
      console.info('✅ Landing: Lobby retry succeeded')
    } catch (error) {
      console.error('❌ Landing: Lobby retry failed:', error)
      setLobbyTimedOut(true)
    }
  }

  onMount(() => armLobbyTimeout())
  onCleanup(() => {
    if (lobbyTimeoutHandle) clearTimeout(lobbyTimeoutHandle)
  })

  // SolidJS 2025: Use signals for form state and createResource for room creation
  const [roomCreationData, setRoomCreationData] = createSignal<{name: string, djName: string, tags: string[]} | null>(null)

  const [roomCreation] = createResource(roomCreationData, async (data) => {
    if (!data) return null

    console.info('🏠 Creating room via Lobby Application Service...')

    // DJ name is optional in the modal; fall back to the default when empty.
    const djName = data.djName || 'DJ'

    // Use scoped lobby service to announce room creation
    const result = await lobbyService.announceRoom(
      data.name,
      djName,
      O.getOrElse(userAdapter.getSessionId(), () => 'anonymous'),
      `${djName}'s room`,
      data.tags
    ).pipe(
      Effect.runPromise
    )
    
    // Close modal and navigate to DJ room
    closeModal()
    navigate(`/dj/${result.roomId}`, {
      state: { 
        djWebSocketUrl: result.djWebSocketUrl,
        roomName: result.roomName,
        djName: result.djName
      }
    })
    
    console.info('✅ Room created successfully:', result.roomId)
    return result
  })
  
  const handleCreateRoom = (e: Event) => {
    e.preventDefault()
    
    const form = e.target as HTMLFormElement
    const formData = new FormData(form)
    const name = (formData.get('roomName') as string)?.trim()
    const djName = (formData.get('djName') as string)?.trim() || ''
    const tagsInput = (formData.get('tags') as string)?.trim()

    if (!name) {
      console.error('Please enter a room name')
      return
    }

    // Parse tags from comma-separated input
    const tags = tagsInput
      ? tagsInput.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0)
      : []

    // Trigger the resource by setting the signal
    setRoomCreationData({ name, djName, tags })
  }

  // X4: Track the room whose join is in flight so the tapped card can show a
  // spinner / disable itself and a possibly-drunk guest can't double-tap.
  const [joiningRoomId, setJoiningRoomId] = createSignal<string | null>(null)

  // SolidJS 2025: Handle room interaction using Application Services
  const handleRoomAction = async (roomId: string, room: LobbyRoomInfoType, isDJRoom: boolean, isActiveListenerRoom: boolean) => {
    // Ignore repeat taps while any join is already resolving.
    if (joiningRoomId()) return
    setJoiningRoomId(roomId)
    try {
      console.info('🏠 Processing room action via Application Services...', { roomId, isDJRoom, isActiveListenerRoom })
      
      // Get session ID for both DJ and listener flows
      const currentSessionId = userAdapter.getSessionId()
      const sessionId = O.getOrNull(currentSessionId)
      
      // Check if this is an active listener room (navigation only)
      if (isActiveListenerRoom) {
        console.info('🎧 Navigating back to active listener room:', roomId)
        navigate(`/listen/${roomId}`)
        return
      }
      
      // Check if this is the user's own DJ room
      if (isDJRoom) {
        console.info('🎤 Navigating to own DJ room:', roomId)
        
        // Check if we need to reconnect or can navigate directly
        const isConnected = connectionAdapter.isConnected()
        
        if (isConnected) {
          // Already connected, navigate with computed WebSocket URL
          const djWebSocketUrl = `/ws/room/${roomId}`
          navigate(`/dj/${roomId}`, { 
            state: { djWebSocketUrl } 
          })
          return
        } else {
          // Need to reconnect via room announcement
          try {
            console.info('🔄 Reconnecting to own DJ room via room announcement:', roomId)
            const result = await lobbyService.announceRoom(
              room.name,
              room.djName,
              sessionId || '',
              O.getOrNull(room.description) || undefined,
              [...(room.tags || [])]
            ).pipe(
              Effect.runPromise
            )
            
            navigate(`/dj/${result.roomId}`, {
              state: { 
                djWebSocketUrl: result.djWebSocketUrl,
                roomName: result.roomName,
                djName: result.djName
              }
            })
            console.info('✅ DJ room reconnection successful')
            return
          } catch (error) {
            console.error('❌ Failed to reconnect to DJ room:', error)
            // Fall through to listener join if reconnection fails
          }
        }
      }
      
      // Regular listener join flow using LobbyService
      console.info('🎧 Requesting to join room as listener via LobbyService:', roomId)
      
      if (!sessionId) {
        console.error('❌ Cannot join room: No session ID available')
        return
      }
      
      try {
        // Use scoped lobby service to request join room
        const joinResult = await lobbyService.requestJoinRoom(roomId, sessionId).pipe(
          Effect.runPromise
        )
        
        if (joinResult && joinResult.listenerWebSocketUrl) {
          console.info('✅ Join request successful, navigating to listener room')
          
          navigate(`/listen/${roomId}`, {
            state: { 
              listenerWebSocketUrl: joinResult.listenerWebSocketUrl,
              sessionId: sessionId,
              roomInfo: {
                id: room.id,
                name: room.name,
                djName: room.djName,
                description: O.getOrNull(room.description),
                tags: [...room.tags], // Convert readonly array to regular array
                listenerCount: room.listenerCount,
                isPublic: room.isPublic
              }
            }
          })
        } else {
          console.error('❌ Join request failed: No result returned')
        }
      } catch (error) {
        console.error('❌ Failed to request room join:', error)
      }
      
    } catch (error) {
      console.error('❌ Failed to handle room action:', error)
    } finally {
      // Clear the loading state. On the success paths the component has already
      // navigated away (this runs post-unmount and is a harmless no-op); on
      // failure paths it re-enables the card so the guest can retry.
      setJoiningRoomId(null)
    }
  }

  // SolidJS 2025: Modal control functions
  const openModal = () => {
    const modal = document.getElementById('createRoomModal') as HTMLDialogElement
    modal?.showModal()
  }

  const closeModal = () => {
    const modal = document.getElementById('createRoomModal') as HTMLDialogElement
    modal?.close()
  }

  // Handle background click to close modal - mobile-friendly
  const handleModalClick = (e: Event) => {
    // Close if clicking directly on the dialog backdrop
    if (e.target && (e.target as HTMLElement).tagName === 'DIALOG') {
      closeModal()
    }
  }
  
  // Computed values from adapters (read-only)
  const availableRooms = () => lobbyAdapter.getRooms()
  const isLoading = () => lobbyAdapter.isLoading() || lobbyInitialization.loading
  const isCreating = () => lobbyAdapter.isCreating() || roomCreation.loading
  
  // SolidJS 2025: Use computed for Option types that return null-safe values
  const connectionError = () => O.getOrNull(connectionAdapter.getError())
  const creationError = () => lobbyAdapter.getCreationError()

  // L2: lobby capacity — keep the create button visible but disabled past this.
  const MAX_LIVE_ROOMS = 8
  const isLobbyFull = () => (sortedRooms()?.length ?? 0) > MAX_LIVE_ROOMS
  // Reason shown when a guest taps the disabled create button.
  const [createBlockedReason, setCreateBlockedReason] = createSignal<string | null>(null)
  
  // Optimized: Only re-sort when rooms actually change, not on connection status changes
  const [sortedRooms] = createResource(
    // Only trigger on rooms change - avoid re-sorting on every connection state update
    () => availableRooms(),
    // Fetcher function that calls the service
    async (rooms) => {
      const sessionId = O.getOrNull(userAdapter.getSessionId())
      const activeListenerRoomId = O.getOrNull(connectionAdapter.getCurrentRoomId()) || undefined
      // Use scoped lobby service to sort rooms with current room ID for highlighting
      return await lobbyService.sortRoomsForUser(rooms, sessionId || '', activeListenerRoomId).pipe(
        Effect.runPromise
      )
    }
  )

  // Check if user is actively engaged (DJ or listener)
  const isActivelyEngaged = () => {
    const sessionId = O.getOrNull(userAdapter.getSessionId())
    const currentRoomId = O.getOrNull(connectionAdapter.getCurrentRoomId())
    const rooms = sortedRooms()
    
    if (!sessionId || !rooms) return false
    
    // Check if user is DJ in any room
    const isDJInRoom = rooms.some(room => room.djId === sessionId)
    
    // Check if user is actively listening
    const isActiveListener = !!currentRoomId && connectionAdapter.isRoomConnected()
    
    return isDJInRoom || isActiveListener
  }

  return (
    <div class="min-h-screen bg-hush-main text-gruvbox-fg">
      <div class="container mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
        {/* Header */}
        <div class="text-center mb-6 sm:mb-8">
          <h1 class="text-3xl sm:text-4xl lg:text-5xl font-bold mb-2" style="color: #d3869b;">
            HushFM
          </h1>
          <p class="text-sm sm:text-base text-gruvbox-fg-3">Live Audio Streaming</p>
        </div>

        {/* Error Display using SolidJS Show for Option types */}
        <Show when={connectionError()}>
          {(error) => (
            <div class="error-panel px-4 py-3 rounded mb-6">
              <div class="flex justify-between items-center">
                <span>{String(error())}</span>
                <button
                  onClick={() => connectionAdapter.clearError()}
                  class="text-gruvbox-red-bright hover:text-gruvbox-fg flex items-center justify-center min-h-[44px] min-w-[44px]"
                  aria-label="Dismiss error"
                >
                  ✕
                </button>
              </div>
            </div>
          )}
        </Show>

        <Show when={creationError()}>
          {(error) => (
            <div class="error-panel px-4 py-3 rounded mb-6">
              <div class="flex justify-between items-center">
                <span>{String(error())}</span>
                <button
                  onClick={() => connectionAdapter.clearError()}
                  class="text-gruvbox-red-bright hover:text-gruvbox-fg flex items-center justify-center min-h-[44px] min-w-[44px]"
                  aria-label="Dismiss error"
                >
                  ✕
                </button>
              </div>
            </div>
          )}
        </Show>
        
        <Show when={roomCreation.error}>
          <div class="error-panel px-4 py-3 rounded mb-6">
            <div class="flex justify-between items-center">
              {/* B3: never render raw exception / WebRTC text to guests */}
              <span>Couldn't create the room — please try again</span>
              <button
                onClick={() => setRoomCreationData(null)}
                class="text-gruvbox-red-bright hover:text-gruvbox-fg flex items-center justify-center min-h-[44px] min-w-[44px]"
                aria-label="Dismiss error"
              >
                ✕
              </button>
            </div>
          </div>
        </Show>


        {/* Simplified Single Column Layout */}
        <div class="max-w-4xl mx-auto">
          {/* Live Rooms Section */}
          <div class="card-glass rounded-xl sm:rounded-2xl p-4 sm:p-6 lg:p-8">
            <div class="flex justify-between items-center mb-4 sm:mb-6">
              <div class="flex items-center gap-2 sm:gap-3">
                <ConnectionStatusDot 
                  size="sm" 
                  webrtcState={() => connectionAdapter.isLobbyConnected() ? WebrtcConnectionState.CONNECTED : WebrtcConnectionState.DISCONNECTED}
                  title="Lobby Connection Status" 
                />
                <h2 class="text-xl sm:text-2xl lg:text-3xl font-bold">Live Rooms</h2>
              </div>
              {/* L2: Never hide the primary action. When the lobby is full keep
                  the "+" visible but disabled with a clear reason (title + on-tap
                  banner). X2: min 44x44 hit area on this icon-only button. */}
              <button
                onClick={() => {
                  if (isLobbyFull()) {
                    setCreateBlockedReason('Lobby full — too many live rooms')
                    return
                  }
                  if (isActivelyEngaged()) {
                    setCreateBlockedReason('Leave your current room to create a new one')
                    return
                  }
                  setCreateBlockedReason(null)
                  openModal()
                }}
                class={`btn btn-square btn-sm sm:btn-md lg:btn-lg min-h-[44px] min-w-[44px] ${
                  isActivelyEngaged() || isLobbyFull()
                    ? 'btn-disabled opacity-50 cursor-not-allowed'
                    : 'btn-primary'
                }`}
                title={
                  isLobbyFull()
                    ? 'Lobby full — too many live rooms'
                    : isActivelyEngaged()
                      ? 'Leave current room to create a new one'
                      : 'Create New Room'
                }
                aria-disabled={isActivelyEngaged() || isLobbyFull()}
              >
                <svg class="w-4 h-4 sm:w-6 sm:h-6 lg:w-8 lg:h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>

            {/* L2: visible reason when the create button is disabled and tapped */}
            <Show when={createBlockedReason()}>
              {(reason) => (
                <div class="text-sm text-gruvbox-yellow-bright bg-gruvbox-yellow/15 rounded-lg px-4 py-2 mb-4">
                  {reason()}
                </div>
              )}
            </Show>

            <Show when={connectionAdapter.isLobbyConnected()} fallback={
              <div class="text-center text-gruvbox-fg-3 py-8">
                <Show
                  when={lobbyTimedOut()}
                  fallback={
                    <>
                      <div class="loading loading-spinner loading-lg mb-4"></div>
                      <p>Connecting to lobby...</p>
                    </>
                  }
                >
                  <p class="mb-4 text-gruvbox-fg-2">Can't reach the lobby — tap to retry</p>
                  <button
                    onClick={retryLobbyConnection}
                    class="btn btn-primary min-h-[44px] px-6"
                  >
                    Retry
                  </button>
                </Show>
              </div>
            }>
              <div class="space-y-2 sm:space-y-3">
                <Show 
                  when={sortedRooms() && sortedRooms()!.length > 0}
                  fallback={
                    <div class="text-center text-gruvbox-fg-4 py-6 sm:py-8">
                      <Show when={sortedRooms.loading || isLoading()} fallback="No rooms available. Create the first one!">
                        Loading rooms...
                      </Show>
                    </div>
                  }
                >
                  <For each={sortedRooms()}>
                    {(room) => {
                      const sessionId = O.getOrNull(userAdapter.getSessionId())
                      const currentRoomId = O.getOrNull(connectionAdapter.getCurrentRoomId())
                      
                      return (
                        <RoomCard
                          room={room}
                          onJoin={(roomId, roomInfo) => {
                            const isDJRoom = sessionId ? room.djId === sessionId : false
                            const isActiveListenerRoom = currentRoomId ? room.id === currentRoomId : false
                            handleRoomAction(roomId, roomInfo, isDJRoom, isActiveListenerRoom)
                          }}
                          isDJRoom={sessionId ? room.djId === sessionId : false}
                          isActiveListenerRoom={currentRoomId ? room.id === currentRoomId : false}
                          isJoining={joiningRoomId() === room.id}
                        />
                      )
                    }}
                  </For>
                </Show>
              </div>
            </Show>
          </div>
        </div>

        {/* Create Room Modal */}
        <dialog id="createRoomModal" class="modal" onClick={handleModalClick}>
          <div class="modal-box max-w-sm sm:max-w-md modal-glass text-gruvbox-fg p-6 sm:p-8" onClick={(e) => e.stopPropagation()}>
            <h3 class="font-bold text-xl sm:text-2xl mb-6 text-center text-brand">Start Streaming</h3>
            
            {/* Error Display in Modal using proper Show for Option types */}
            <Show when={creationError()}>
              {(error) => (
                <div class="error-panel px-4 py-3 mb-6">
                  <span class="text-sm sm:text-base">{String(error())}</span>
                </div>
              )}
            </Show>
            
            <Show when={roomCreation.error}>
              <div class="error-panel px-4 py-3 rounded-lg mb-6">
                {/* B3: friendly copy — no raw exception / WebRTC text */}
                <span class="text-sm sm:text-base">Couldn't create the room — please try again</span>
              </div>
            </Show>
            
            <form id="createRoomForm" onSubmit={handleCreateRoom} class="space-y-5 sm:space-y-6">
              <div>
                <label class="block text-sm sm:text-base font-medium mb-3 text-gruvbox-fg-1">Room Name</label>
                <input
                  type="text"
                  name="roomName"
                  placeholder="Enter room name"
                  class="input w-full input-hush px-4 py-3 text-sm sm:text-base"
                  required
                />
              </div>
              
              <div>
                <label class="block text-sm sm:text-base font-medium mb-3 text-gruvbox-fg-1">Your DJ name (optional)</label>
                <input
                  type="text"
                  name="djName"
                  placeholder="DJ"
                  class="input w-full input-hush px-4 py-3 text-sm sm:text-base"
                />
                <p class="text-xs text-gruvbox-fg-3 mt-2">Shown to listeners. Defaults to "DJ" if left blank.</p>
              </div>

              <div>
                <label class="block text-sm sm:text-base font-medium mb-3 text-gruvbox-fg-1">Tags (optional)</label>
                <input
                  type="text"
                  name="tags"
                  placeholder="house, techno, ambient (comma-separated)"
                  class="input w-full input-hush px-4 py-3 text-sm sm:text-base"
                />
                <p class="text-xs text-gruvbox-fg-3 mt-2">Add tags to help listeners find your room</p>
              </div>
            </form>

            <div class="flex justify-center mt-8">
              <button
                type="submit"
                form="createRoomForm"
                disabled={isCreating()}
                class="btn btn-hush w-full py-3 text-sm sm:text-base disabled:opacity-50"
              >
                <Show when={isCreating()} fallback="Create Room & Start Streaming">
                  <>
                    <span class="loading loading-spinner loading-sm mr-2"></span>
                    Creating Room...
                  </>
                </Show>
              </button>
            </div>
          </div>
        </dialog>
      </div>
    </div>
  )
}

export default function Landing() {
  return (
    <LobbyFeatureProvider>
      <LandingContent />
    </LobbyFeatureProvider>
  )
}