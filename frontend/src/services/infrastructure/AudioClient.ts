/**
 * Audio Infrastructure Client
 *
 * Infrastructure service that manages MediaStream and audio devices.
 * State is managed via AudioAdapter/Store.
 */

import { Effect, Layer, Option as O, Context, pipe } from 'effect'
import { createSignal } from 'solid-js'
import { AudioAdapter } from '../../stores'
import {
  AudioDeviceError,
  AudioTrackError,
  AudioPlaybackError,
  type AudioServiceError,
  type StreamStateType
} from '../../domain/schemas/audio.schema'

// ---------------------------------------------------------------------------
// Module-internal: Media Session helpers
// ---------------------------------------------------------------------------

/**
 * Registers Media Session metadata + action handlers.
 * Feature-detected — no-ops on browsers without Media Session API.
 * Must be called AFTER elem.play() resolves successfully.
 *
 * @param onUserPause - called when the user explicitly pauses via Media Session
 * @param onUserPlay  - called when the user explicitly resumes via Media Session
 */
const setupMediaSession = (
  elem: HTMLAudioElement,
  updateStreamState: (updates: Partial<StreamStateType>) => void,
  onUserPause: () => void,
  onUserPlay: () => void,
  meta?: { roomName: string; djName: string },
  anchor?: HTMLAudioElement | null,
  webAudio?: { suspend: () => void; resume: () => void } | null
): void => {
  if (!('mediaSession' in navigator)) return

  navigator.mediaSession.metadata = new MediaMetadata({
    title: meta?.roomName ?? 'HushFM',
    artist: meta?.djName ?? 'HushFM DJ',
    album: 'HushFM'
  })
  navigator.mediaSession.playbackState = 'playing'

  // Android-Chromium anchor path only: present as LIVE media (Infinity) so the
  // notification shows no misleading seek bar. Some builds may reject Infinity —
  // in that case we silently skip (never pass a finite fake duration).
  if (anchor) {
    try {
      navigator.mediaSession.setPositionState({ duration: Infinity, position: 0, playbackRate: 1 })
    } catch { /* unsupported value/build — position state is cosmetic */ }
  }

  // 'play' handler: clear intent flag, resume playback, update state.
  // Anchor mode: sound flows through WebAudio (the stream element is a muted
  // RTP pump) — resume the AudioContext; keep anchor + pump playing throughout.
  navigator.mediaSession.setActionHandler('play', () => {
    onUserPlay()
    // Anchor first: it owns the full audio focus the stream element rides under
    anchor?.play().catch(() => {})
    elem.play().catch(() => {})
    webAudio?.resume()
    navigator.mediaSession.playbackState = 'playing'
    updateStreamState({ playing: true })
  })

  // 'pause' handler: record user intent; never cleanup/null srcObject, and
  // never pause the anchor: the anchor's playback is what holds the tab's full
  // audio focus / background exemption. Pausing it would drop focus and let
  // Android suspend the tab ~60 s later, so resume from the lock screen would
  // silently die. The anchor bed is inaudible (-46 dBFS).
  // Anchor mode: silence = suspend the AudioContext; the muted pump element
  // must KEEP PLAYING or RTP stops flowing and resume would need a re-join.
  navigator.mediaSession.setActionHandler('pause', () => {
    onUserPause()
    if (webAudio) {
      webAudio.suspend()
    } else {
      elem.pause()
    }
    navigator.mediaSession.playbackState = 'paused'
    updateStreamState({ playing: false })
  })
}

/**
 * Clears Media Session state on full stream stop.
 * Feature-detected — no-ops on browsers without Media Session API.
 */
const clearMediaSession = (): void => {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.metadata = null
  navigator.mediaSession.playbackState = 'none'
  try { navigator.mediaSession.setActionHandler('play', null) } catch { }
  try { navigator.mediaSession.setActionHandler('pause', null) } catch { }
  try { navigator.mediaSession.setPositionState() } catch { }
}

/**
 * Android-Chromium detection for the anchor-audio workaround.
 *
 * Chromium never grants "full" audio focus (media notification + background-
 * playback exemption) to srcObject/MediaStream-backed elements: full focus
 * requires a finite duration >= ~5 s, and a live stream reports NaN/Infinity
 * (w3c/mediasession#261, crbug 41452188). Without it, Android suspends the
 * tab's audio output ~60 s after screen lock. The workaround is a parallel
 * DOM <audio> looping a real file (public/anchor.ogg — 20 s brown noise at
 * -46 dBFS RMS: above Chromium's -72.25 dBFS silence threshold, inaudible
 * under music) that legitimately earns full focus; the stream element rides
 * under it. The level is baked into the FILE and played at volume 1.0 —
 * element.volume is applied BEFORE Chromium's audibility measurement, so
 * attenuating via volume would reclassify the anchor as silent.
 *
 * Gated to Android only. Chromium family ("Chrome/" covers Chrome, Brave,
 * Ecosia, Samsung Internet) is confirmed affected AND confirmed fixed by the
 * anchor mechanism (device test 2026-07-04). Firefox/Gecko on Android showed
 * the SAME failure (no controls, ~1 min death) on its plain path, so the
 * anchor mechanism is extended to it experimentally — Gecko also grants
 * media notifications to audible file-backed elements, so the same shelter
 * logic plausibly applies. iOS Safari stays excluded: it already works and
 * a second Now-Playing element could regress it.
 */
const needsAnchorAudio = (): boolean =>
  /Android/i.test(navigator.userAgent) &&
  (/Chrome\//.test(navigator.userAgent) || /Firefox\//.test(navigator.userAgent))

// ---------------------------------------------------------------------------
// Audio Client Interface
// ---------------------------------------------------------------------------

/**
 * Audio Client Interface
 *
 * Infrastructure layer for audio device and stream management.
 * State is persisted in AudioAdapter/Store.
 */
interface AudioClientInterface {
  // Device Management
  readonly getAudioDevices: () => Effect.Effect<
    ReadonlyArray<MediaDeviceInfo>,
    AudioServiceError,
    AudioAdapter
  >

  // Device Selection (for DJ mic input)
  // Updates state in AudioAdapter
  readonly selectDevice: (deviceId: string) => Effect.Effect<
    MediaStream,
    AudioServiceError,
    AudioAdapter
  >

  // Remote Stream (for listener playback)
  // Updates state in AudioAdapter
  // meta is used to populate the Media Session API (Android lock-screen controls)
  readonly connectRemoteStream: (stream: MediaStream, meta?: { roomName: string; djName: string }) => Effect.Effect<
    void,
    AudioPlaybackError,
    AudioAdapter
  >

  // Stop any active stream
  // Updates state in AudioAdapter
  readonly stopStream: () => Effect.Effect<
    void,
    never,
    AudioAdapter
  >

  // Toggle playing state (pause/resume) without disconnecting
  // Updates state in AudioAdapter
  readonly toggleAudioStreamPlaying: (pause: boolean) => Effect.Effect<
    void,
    AudioServiceError,
    AudioAdapter
  >

  // Reactive stream signal (for UI components)
  readonly currentStream: () => O.Option<MediaStream>
}

/**
 * Audio Client Context Tag
 */
export class AudioClient extends Context.Tag("@app/infrastructure/AudioClient")<
  AudioClient,
  AudioClientInterface
>() {}

// ---------------------------------------------------------------------------
// Audio Client Implementation
// ---------------------------------------------------------------------------

/**
 * Create Audio Client Implementation
 */
const createAudioClientImpl = (): AudioClientInterface => {
  // Internal MediaStream reference - now reactive with SolidJS signal
  const [currentStream, setCurrentStream] = createSignal<O.Option<MediaStream>>(O.none())

  // Internal audio element for playback (listener mode)
  let audioElement: O.Option<HTMLAudioElement> = O.none()

  /**
   * Anchor element (Android Chromium only, see needsAnchorAudio).
   * Lives from first connectRemoteStream until full stopStream — deliberately
   * NOT stopped in stopCurrentStream, so full audio focus survives re-joins.
   */
  let anchorElement: HTMLAudioElement | null = null

  /** Create (once) and start the anchor. No-op outside Android Chromium. */
  const startAnchor = (): void => {
    if (!needsAnchorAudio()) return
    if (anchorElement === null) {
      const anchor = new Audio('/anchor.ogg')
      anchor.loop = true
      // volume MUST stay 1.0 — the audible level is baked into the file
      anchor.volume = 1.0
      anchor.setAttribute('playsinline', '')
      anchor.style.display = 'none'
      document.body.appendChild(anchor)
      anchorElement = anchor
    }
    if (anchorElement.paused) {
      anchorElement.play().catch((err: DOMException) => {
        // NotAllowedError: retried on the next connectRemoteStream (gesture modal)
        console.info('🔊 AudioClient: Anchor play blocked/failed:', err.name)
      })
    }
  }

  /** Stop and remove the anchor (full stop only). */
  const stopAnchor = (): void => {
    if (anchorElement === null) return
    anchorElement.pause()
    anchorElement.remove()
    anchorElement = null
  }

  // ---------------------------------------------------------------------------
  // WebAudio rendering (anchor mode only)
  //
  // Round-2 device test + Chromium evidence (w3c/mediasession#261, AlexxIT/
  // WebRTC#578): an UNMUTED srcObject element claims the tab's one-per-tab
  // media-session arbitration while being ineligible for system UI, shadowing
  // the anchor → no notification at all. Fix: the stream element stays MUTED
  // (it must keep playing — Chrome only pumps WebRTC audio into a playing sink
  // element) and the actual sound is rendered via WebAudio, so the anchor is
  // the tab's only audible media element and wins the session binding.
  // ---------------------------------------------------------------------------

  let audioCtx: AudioContext | null = null
  let webAudioSource: MediaStreamAudioSourceNode | null = null

  /** Route the remote stream's audio through WebAudio to the speakers. */
  const startWebAudioRender = (stream: MediaStream): void => {
    if (audioCtx === null) {
      audioCtx = new AudioContext()
    }
    if (webAudioSource !== null) {
      try { webAudioSource.disconnect() } catch { }
    }
    webAudioSource = audioCtx.createMediaStreamSource(stream)
    webAudioSource.connect(audioCtx.destination)
    if (audioCtx.state !== 'running') {
      audioCtx.resume().catch(() => { })
    }
  }

  /** Disconnect the current source; optionally close the context (full stop). */
  const stopWebAudioRender = (full: boolean): void => {
    if (webAudioSource !== null) {
      try { webAudioSource.disconnect() } catch { }
      webAudioSource = null
    }
    if (full && audioCtx !== null) {
      audioCtx.close().catch(() => { })
      audioCtx = null
    }
  }

  // ---------------------------------------------------------------------------
  // Interruption-handling state
  // ---------------------------------------------------------------------------

  /**
   * true when the user explicitly paused via Media Session action (or future UI).
   * Prevents auto-resume from fighting an intentional pause.
   */
  let userPausedIntentionally = false

  /**
   * true when WE programmatically pause the element (stopCurrentStream / stopStream).
   * The 'pause' event listener checks this flag and ignores the event when set,
   * then consumes (clears) the flag so subsequent events are not suppressed.
   */
  let expectedPause = false

  /** Pending auto-resume timer IDs — cancelled on explicit stop or user intent pause. */
  let resumeTimer1: ReturnType<typeof setTimeout> | null = null
  let resumeTimer2: ReturnType<typeof setTimeout> | null = null

  /**
   * Reference to the devicechange listener for explicit cleanup in stopStream.
   * Element-attached listeners are automatically dropped when the element is removed.
   */
  let deviceChangeListener: (() => void) | null = null

  /**
   * Captured AudioAdapter reference for use inside browser event callbacks
   * (where Effect context is unavailable). Set in connectRemoteStream; cleared in stopStream.
   */
  let sharedAudioAdapter: {
    updateStreamState: (updates: Partial<StreamStateType>) => void
    getStreamState: () => StreamStateType
  } | null = null

  // ---------------------------------------------------------------------------
  // Interruption-handling helpers
  // ---------------------------------------------------------------------------

  /** Cancel any pending auto-resume timers. */
  const cancelResumeTimers = (): void => {
    if (resumeTimer1 !== null) { clearTimeout(resumeTimer1); resumeTimer1 = null }
    if (resumeTimer2 !== null) { clearTimeout(resumeTimer2); resumeTimer2 = null }
  }

  /**
   * Attempt a single playback resume after an OS interruption.
   *
   * Guards (all must pass or the call is a no-op):
   *   - The element must still be our active element (not replaced by a re-join or full stop).
   *   - The user must not have paused intentionally.
   *   - srcObject must still be set (if null, a re-join or full stop is in progress).
   *
   * On success: updates stream state playing=true, mediaSession playbackState='playing'.
   * On NotAllowedError: surfaces the existing UserInteractionModal via requiresUserGesture.
   * On other errors: logs a warning and does nothing (leaves recovery to re-join coordinator).
   */
  const attemptResume = (elem: HTMLAudioElement): Promise<void> => {
    if (!O.isSome(audioElement) || O.getOrThrow(audioElement) !== elem) return Promise.resolve()
    if (userPausedIntentionally) return Promise.resolve()
    if (elem.srcObject === null) return Promise.resolve()

    // OS interruptions (calls, alarms) pause the anchor too — restart it first
    // so audio focus is re-established alongside the stream element. The
    // AudioContext may also have been suspended by the OS; resume it.
    startAnchor()
    if (audioCtx !== null && audioCtx.state !== 'running' && !userPausedIntentionally) {
      audioCtx.resume().catch(() => { })
    }

    return elem.play().then(() => {
      if (sharedAudioAdapter) {
        sharedAudioAdapter.updateStreamState({ playing: true, requiresUserGesture: false })
      }
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing'
      }
      // Clear the programmatic-pause guard: play() succeeded, so any flag set by
      // a prior stopCurrentStream() that never generated a 'pause' event (because
      // the element was already paused) is stale and must be consumed here.
      expectedPause = false
      console.info('🔊 AudioClient: Auto-resume succeeded after interruption')
    }).catch((err: unknown) => {
      const domErr = err as DOMException
      if (domErr.name === 'NotAllowedError') {
        // Browser requires a user gesture — surface the existing UserInteractionModal
        console.info('🔊 AudioClient: Auto-resume blocked (NotAllowedError) — surfacing user-gesture modal')
        if (sharedAudioAdapter) {
          sharedAudioAdapter.updateStreamState({ requiresUserGesture: true })
        }
        if ('mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'paused'
        }
      } else {
        // Any other error: log and leave recovery to the re-join coordinator (card 6)
        console.warn('🔊 AudioClient: Auto-resume attempt failed:', domErr.name, domErr.message)
      }
    })
  }

  /**
   * Schedule two auto-resume attempts after an OS interruption is detected:
   *   - ~1 s delay:  covers short alarms / notification sounds that end quickly
   *   - ~3 s delay:  covers typical call-reject / call-end sequences
   *
   * Both timers are set upfront; if the first attempt succeeds (element unpaused)
   * the second timer is cancelled. The guard in scheduleAutoResume ensures we do
   * not create timers after the element has been removed (full stop).
   */
  const scheduleAutoResume = (elem: HTMLAudioElement): void => {
    // Guard: only schedule if this element is still the active one
    if (!O.isSome(audioElement) || O.getOrThrow(audioElement) !== elem) return

    cancelResumeTimers()

    resumeTimer1 = setTimeout(() => {
      resumeTimer1 = null
      attemptResume(elem).then(() => {
        // If the element recovered, cancel the later retry
        if (!elem.paused) cancelResumeTimers()
      })
    }, 1000)

    resumeTimer2 = setTimeout(() => {
      resumeTimer2 = null
      attemptResume(elem)
    }, 3000)
  }

  /**
   * Attach interruption-detection listeners to a newly created audio element.
   * Called exactly once per element lifetime (when the element is first created).
   *
   * Three event sources are monitored:
   *   1. 'pause'        — unexpected pauses from OS interruptions (calls, alarms, …)
   *   2. 'ended'        — track death or element reaching end-of-stream
   *   3. devicechange   — wired-headphone unplug / replug
   */
  const attachInterruptionListeners = (elem: HTMLAudioElement): void => {
    // --- 'pause' event ---
    elem.addEventListener('pause', () => {
      if (expectedPause) {
        // Programmatic pause by stopCurrentStream / stopStream: consume flag and ignore
        expectedPause = false
        return
      }
      if (userPausedIntentionally) {
        // User explicitly paused via Media Session: respect it
        return
      }
      // OS-level interruption — schedule auto-resume attempts
      console.info('🔊 AudioClient: Unexpected pause — scheduling auto-resume')
      scheduleAutoResume(elem)
    })

    // --- 'ended' event ---
    elem.addEventListener('ended', () => {
      const srcObj = elem.srcObject as MediaStream | null
      const allTracksEnded =
        srcObj !== null &&
        srcObj.getTracks().length > 0 &&
        srcObj.getTracks().every(t => t.readyState === 'ended')

      if (allTracksEnded) {
        // MediaStream tracks are permanently dead — resuming is futile.
        // Clear playing state; leave full re-join recovery to the coordinator (card 6).
        console.info('🔊 AudioClient: All tracks ended — clearing playing state, awaiting coordinator')
        if (sharedAudioAdapter) {
          sharedAudioAdapter.updateStreamState({ playing: false, requiresUserGesture: false })
        }
        if ('mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'paused'
        }
      } else {
        // Element reached end while tracks are still live (rare) — attempt a single resume
        console.info('🔊 AudioClient: ended event with live tracks — attempting single resume')
        attemptResume(elem)
      }
    })

    // --- navigator.mediaDevices.devicechange (headphone unplug / replug) ---
    // Feature-detected: not available in all environments.
    if ('mediaDevices' in navigator && typeof navigator.mediaDevices.addEventListener === 'function') {
      deviceChangeListener = () => {
        if (!sharedAudioAdapter) return
        const state = sharedAudioAdapter.getStreamState()
        // Act only when we believe playback should be active but the element is paused
        if (state.playing && elem.paused && !userPausedIntentionally) {
          console.info('🔊 AudioClient: devicechange while paused — scheduling auto-resume')
          scheduleAutoResume(elem)
        }
      }
      navigator.mediaDevices.addEventListener('devicechange', deviceChangeListener)
    }
  }

  // ---------------------------------------------------------------------------
  // Core stream helpers
  // ---------------------------------------------------------------------------

  /**
   * Stop the current stream tracks and reset element srcObject.
   * Keeps the audio element alive for re-use on the next connectRemoteStream call.
   * Sets expectedPause so the 'pause' listener ignores the programmatic pause.
   */
  const stopCurrentStream = (): Effect.Effect<void, never, never> =>
    Effect.sync(() => {
      pipe(
        currentStream(),
        O.match({
          onNone: () => {},
          onSome: (stream) => {
            stream.getTracks().forEach(track => track.stop())
          }
        })
      )

      pipe(
        audioElement,
        O.match({
          onNone: () => {},
          onSome: (elem) => {
            // Mark as programmatic pause so interruption listener ignores it
            expectedPause = true
            elem.pause()
            elem.srcObject = null
          }
        })
      )

      // Anchor mode: disconnect the old stream's WebAudio source but KEEP the
      // AudioContext and the anchor alive — full audio focus survives re-joins.
      stopWebAudioRender(false)

      setCurrentStream(O.none())
    })

  // ---------------------------------------------------------------------------
  // Permission helpers
  // ---------------------------------------------------------------------------

  /** Update microphone permission in AudioAdapter (no-op if Permissions API absent). */
  const updatePermissions = (): Effect.Effect<void, never, AudioAdapter> =>
    Effect.gen(function* () {
      const audioAdapter = yield* AudioAdapter

      const state: PermissionState = yield* Effect.promise(async () => {
        try {
          const permission = await navigator.permissions.query({ name: 'microphone' as PermissionName })
          return permission.state as PermissionState
        } catch {
          return 'prompt' as PermissionState
        }
      })

      audioAdapter.setPermission(state)
    })

  /** Request microphone permission for device enumeration. */
  const requestMicrophonePermission = (): Effect.Effect<boolean, AudioDeviceError, never> =>
    Effect.tryPromise({
      try: async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false
            }
          })
          stream.getTracks().forEach(track => track.stop())
          console.info('🎧 AudioClient: Microphone permission granted for device enumeration')
          return true
        } catch (error) {
          console.warn('🎧 AudioClient: Microphone permission denied:', error)
          return false
        }
      },
      catch: (error) => new AudioDeviceError({
        cause: String(error),
        operation: 'requestPermission',
        timestamp: new Date()
      })
    })

  // ---------------------------------------------------------------------------
  // Public interface
  // ---------------------------------------------------------------------------

  return {
    getAudioDevices: () =>
      Effect.gen(function* () {
        const audioAdapter = yield* AudioAdapter

        yield* updatePermissions()

        console.info('🎧 AudioClient: Attempting device enumeration...')
        const initialDevices = yield* Effect.tryPromise({
          try: async () => {
            const devices = await navigator.mediaDevices.enumerateDevices()
            return devices.filter(device => device.kind === 'audioinput')
          },
          catch: (error) => new AudioDeviceError({
            cause: String(error),
            operation: 'enumerate',
            timestamp: new Date()
          })
        })

        const hasLabels = initialDevices.some(device => device.label && device.label.trim() !== '')

        if (hasLabels) {
          console.info('🎧 AudioClient: Device labels available, permission already granted')
          audioAdapter.setAvailableDevices(initialDevices)
          return initialDevices
        }

        console.info('🎧 AudioClient: No device labels found, requesting microphone permission...')
        const permissionGranted = yield* requestMicrophonePermission()

        if (!permissionGranted) {
          console.warn('🎧 AudioClient: Permission denied, returning devices without labels')
          audioAdapter.setAvailableDevices(initialDevices)
          return initialDevices
        }

        console.info('🎧 AudioClient: Permission granted, re-enumerating devices...')
        const devicesWithLabels = yield* Effect.tryPromise({
          try: async () => {
            const devices = await navigator.mediaDevices.enumerateDevices()
            const audioInputs = devices.filter(device => device.kind === 'audioinput')
            audioAdapter.setAvailableDevices(audioInputs)
            return audioInputs
          },
          catch: (error) => new AudioDeviceError({
            cause: String(error),
            operation: 'enumerate',
            timestamp: new Date()
          })
        })

        return devicesWithLabels
      }),

    selectDevice: (deviceId: string) =>
      Effect.gen(function* () {
        const audioAdapter = yield* AudioAdapter

        yield* stopCurrentStream()
        yield* updatePermissions()

        const storedConstraints = audioAdapter.getMediaTrackConstraints()

        const audioConstraints = pipe(
          storedConstraints,
          O.getOrElse(() => ({
            deviceId: { exact: deviceId },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            latency: 0,
            sampleRate: 48000,
            channelCount: 2,
          }))
        )

        const constraints: MediaStreamConstraints = {
          audio: audioConstraints,
          video: false
        }

        const newStream = yield* Effect.tryPromise({
          try: async () => {
            const stream = await navigator.mediaDevices.getUserMedia(constraints)

            setCurrentStream(O.some(stream))

            audioAdapter.setStreamState({
              playing: true,
              deviceId: O.some(deviceId),
              constraints: O.some(audioConstraints as any),
              acquiredAt: O.some(new Date()),
              error: O.none(),
              requiresUserGesture: false,
              permission: audioAdapter.getPermission()
            })

            return stream
          },
          catch: (error) => new AudioTrackError({
            cause: String(error),
            operation: 'getUserMedia',
            timestamp: new Date()
          })
        })

        return newStream
      }),

    connectRemoteStream: (remoteStream: MediaStream, meta?: { roomName: string; djName: string }) =>
      Effect.gen(function* () {
        const audioAdapter = yield* AudioAdapter

        // Idempotence: skip only if the exact same stream is ALREADY PLAYING.
        // If the element is paused (e.g. after a NotAllowedError) we must fall
        // through so that elem.play() is retried and setupMediaSession fires.
        const existing = currentStream()
        if (
          O.isSome(existing) &&
          existing.value === remoteStream &&
          O.isSome(audioElement) &&
          !O.getOrThrow(audioElement).paused &&
          !O.getOrThrow(audioElement).ended
        ) {
          console.info('🔊 AudioClient: Stream already playing, skipping (idempotent)')
          return
        }

        // Cancel any pending auto-resume attempts from a prior interruption before
        // we stop the old stream and start a new one.
        cancelResumeTimers()

        // Stop any existing stream (pauses + nulls srcObject; keeps element alive).
        // stopCurrentStream sets expectedPause=true before the programmatic pause.
        yield* stopCurrentStream()

        // Capture adapter for use in browser event callbacks (outside Effect context)
        sharedAudioAdapter = audioAdapter

        // Clear user-pause intent: this is a fresh (re-)connect
        userPausedIntentionally = false

        // Create audio element for playback on first call only.
        // The same element instance is reused across srcObject swaps so that the
        // autoplay unlock (user gesture) remains bound to the element.
        audioElement = pipe(
          audioElement,
          O.orElse(() => {
            const elem = new Audio()
            elem.autoplay = true
            // Inline playback on iOS / Android (prevents fullscreen takeover)
            elem.setAttribute('playsinline', '')
            ;(elem as any).playsInline = true
            // Hidden but DOM-attached: required for Chrome/Android to grant audio focus
            elem.style.display = 'none'
            document.body.appendChild(elem)
            // Attach interruption-detection listeners (once per element lifetime)
            attachInterruptionListeners(elem)
            return O.some(elem)
          })
        )

        const elem = O.getOrThrow(audioElement)
        elem.srcObject = remoteStream

        // Anchor mode (Android Chromium): the stream element is a muted RTP
        // pump; sound is rendered via WebAudio; the anchor is the only audible
        // media element (see WebAudio section above). iOS/Firefox: unmuted
        // element playback, unchanged.
        const anchorMode = needsAnchorAudio()
        elem.muted = anchorMode

        // Anchor FIRST (Android Chromium): it must own full audio focus before/
        // with the stream element. Same gesture context unlocks both play() calls.
        startAnchor()

        // Use standard Promise-based autoplay detection
        yield* Effect.tryPromise({
          try: () => elem.play(),
          catch: (error: any) => error
        }).pipe(
          Effect.andThen(() => {
            console.info('🔊 AudioClient: Audio playback started successfully')
            // Playback started — clear intent flags.
            // expectedPause is also reset here: a successful play() means no
            // programmatic-pause guard from a prior stopCurrentStream() call can
            // still be outstanding.  Without this reset the flag would absorb the
            // NEXT real OS-interruption pause event as "programmatic", preventing
            // auto-resume (the stuck-flag bug).
            userPausedIntentionally = false
            expectedPause = false

            // Anchor mode: engage WebAudio rendering. A MUTED element's play()
            // always succeeds regardless of autoplay policy, so the gesture
            // requirement surfaces through the anchor/AudioContext instead:
            // if either is still blocked after this tick, raise the modal.
            if (anchorMode) {
              startWebAudioRender(remoteStream)
              setTimeout(() => {
                const anchorBlocked = anchorElement !== null && anchorElement.paused
                const ctxBlocked = audioCtx !== null && audioCtx.state !== 'running'
                if ((anchorBlocked || ctxBlocked) && sharedAudioAdapter) {
                  console.info('🔊 AudioClient: Anchor/AudioContext blocked — surfacing user-gesture modal', { anchorBlocked, ctxBlocked })
                  sharedAudioAdapter.updateStreamState({ playing: false, requiresUserGesture: true })
                }
              }, 500)
            }

            // Update state for successful playback
            setCurrentStream(O.some(remoteStream))
            audioAdapter.setStreamState({
              playing: true,
              deviceId: O.none(),
              constraints: O.none(),
              acquiredAt: O.some(new Date()),
              error: O.none(),
              requiresUserGesture: false,
              permission: audioAdapter.getPermission()
            })
            // Register Media Session for lock-screen controls (Android/Chrome).
            // Pass intent callbacks so the 'pause' listener can distinguish
            // user-initiated pauses from OS interruptions.
            setupMediaSession(
              elem,
              audioAdapter.updateStreamState,
              () => { userPausedIntentionally = true; cancelResumeTimers() },
              () => { userPausedIntentionally = false },
              meta,
              anchorElement,
              anchorMode
                ? {
                    suspend: () => { audioCtx?.suspend().catch(() => { }) },
                    resume: () => { audioCtx?.resume().catch(() => { }) }
                  }
                : null
            )
          }),
          Effect.catchAll((error) => {
            // Standard autoplay detection: check for NotAllowedError
            const isAutoplayBlocked = error.name === "NotAllowedError"

            console.info('🔊 AudioClient: Play failed:', {
              errorName: error.name,
              isAutoplayBlocked,
              message: String(error)
            })

            // Always set the stream (we have the media, just can't play yet)
            setCurrentStream(O.some(remoteStream))
            audioAdapter.setStreamState({
              playing: false,
              deviceId: O.none(),
              constraints: O.none(),
              acquiredAt: O.some(new Date()),
              error: isAutoplayBlocked ? O.none() : O.some(String(error)),
              requiresUserGesture: isAutoplayBlocked,
              permission: audioAdapter.getPermission()
            })

            if (isAutoplayBlocked) {
              // Autoplay blocked is expected behavior — succeed but UI will show modal.
              // Media Session will be applied once the user unlocks via the modal
              // (modal calls connectRemoteStream again, which reaches the success path).
              console.info('🔊 AudioClient: Autoplay blocked by browser, user interaction required')
              return Effect.succeed(undefined)
            } else {
              // Real error — fail the operation
              return Effect.fail(new AudioPlaybackError({
                cause: String(error),
                operation: 'play',
                autoplayBlocked: false,
                timestamp: new Date()
              }))
            }
          })
        )
      }),

    toggleAudioStreamPlaying: (pause: boolean) =>
      Effect.gen(function* () {
        const audioAdapter = yield* AudioAdapter

        // Only for DJ mode — pause/resume MediaStream tracks
        yield* pipe(
          currentStream(),
          O.match({
            onNone: () =>
              Effect.fail(new AudioPlaybackError({
                cause: 'No active audio stream to toggle',
                operation: pause ? 'pause' : 'play',
                autoplayBlocked: false,
                timestamp: new Date()
              })),
            onSome: (stream) =>
              Effect.sync(() => {
                stream.getAudioTracks().forEach(track => {
                  track.enabled = !pause
                })

                audioAdapter.updateStreamState({
                  playing: !pause
                })
              })
          })
        )
      }),

    stopStream: () =>
      Effect.gen(function* () {
        const audioAdapter = yield* AudioAdapter

        // Cancel any pending auto-resume attempts before tearing down
        cancelResumeTimers()

        // Stop MediaStream tracks
        pipe(
          currentStream(),
          O.match({
            onNone: () => {},
            onSome: (stream) => {
              stream.getTracks().forEach(track => track.stop())
            }
          })
        )
        setCurrentStream(O.none())

        // Cleanup audio element: pause, null srcObject, and remove from DOM.
        // Set expectedPause so the interruption listener ignores the programmatic pause.
        pipe(
          audioElement,
          O.match({
            onNone: () => {},
            onSome: (elem) => {
              expectedPause = true
              elem.pause()
              elem.srcObject = null
              elem.remove()
            }
          })
        )
        // Allow fresh element creation on the next join
        audioElement = O.none()

        // Full stop: tear down the anchor and WebAudio too (re-joins keep them)
        stopAnchor()
        stopWebAudioRender(true)

        // Remove devicechange listener explicitly (element listeners drop with the element,
        // but devicechange is on navigator.mediaDevices — must be removed manually).
        if (
          deviceChangeListener !== null &&
          'mediaDevices' in navigator &&
          typeof navigator.mediaDevices.removeEventListener === 'function'
        ) {
          navigator.mediaDevices.removeEventListener('devicechange', deviceChangeListener)
          deviceChangeListener = null
        }

        // Reset all interruption-handling state for the next session
        userPausedIntentionally = false
        expectedPause = false        // reset in case there was no element to consume the flag
        sharedAudioAdapter = null

        // Clear Media Session state (metadata + action handlers)
        clearMediaSession()

        // Update state in adapter
        audioAdapter.setStreamState({
          playing: false,
          deviceId: O.none(),
          constraints: O.none(),
          acquiredAt: O.none(),
          error: O.none(),
          requiresUserGesture: false,
          permission: audioAdapter.getPermission()
        })
      }),

    currentStream: currentStream
  }
}

// ---------------------------------------------------------------------------
// Audio Client Layer
// ---------------------------------------------------------------------------

/**
 * Audio Client Layer
 *
 * Live implementation that creates the client.
 */
export const AudioClientLive = Layer.succeed(
  AudioClient,
  createAudioClientImpl()
)
