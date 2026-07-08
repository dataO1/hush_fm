import { onMount, onCleanup, createEffect, createMemo, Show } from 'solid-js'

interface OscilloscopeProps {
  stream?: MediaStream
  class?: string
  height?: number
  /**
   * #9 — Reactive getter: true while the DJ's producer is paused (no media
   * flowing). When set, the waveform is replaced by a centered ⏸ glyph + a
   * DJ-attributed caption instead of showing a fake "live" flat line.
   */
  paused?: () => boolean
  /** DJ display name for the paused caption ("{djName} paused"). */
  djName?: string
}

export function Oscilloscope(props: OscilloscopeProps) {
  let canvasRef: HTMLCanvasElement | undefined
  let audioContext: AudioContext | null = null
  let analyser: AnalyserNode | null = null
  let source: MediaStreamAudioSourceNode | null = null
  let animationId: number | null = null
  let dataArray: Uint8Array<ArrayBuffer> | null = null
  let setupInProgress = false
  let lastFrameTime = 0

  const setupOscilloscope = async () => {
    if (!props.stream || !canvasRef || setupInProgress) return

    setupInProgress = true
    try {
      // Validate that we don't already have an active AudioContext
      if (audioContext && audioContext.state !== 'closed') {
        console.warn('AudioContext already exists, cleaning up first')
        audioContext.close()
        audioContext = null
      }

      // Create audio context and analyser
      audioContext = new AudioContext({
          latencyHint: 'interactive',
          sampleRate: 48000 // Match your hardware exactly
        });

      // Handle suspended audio context - try to resume for Firefox compatibility
      if (audioContext.state === 'suspended') {
        console.info('AudioContext suspended - attempting to resume for Firefox compatibility')
        try {
          await audioContext.resume()
          console.info('✅ AudioContext resumed successfully')
        } catch (error) {
          console.warn('⚠️ Failed to resume AudioContext:', error)
          console.info('AudioContext suspended - waiting for user gesture to resume')
          return
        }
      }

      analyser = audioContext.createAnalyser()
      analyser.fftSize = 2048 // Decreased for better performance while keeping good history
      analyser.smoothingTimeConstant = 0.6

      // Connect stream to analyser
      source = audioContext.createMediaStreamSource(props.stream)
      source.connect(analyser)

      // Create data array for waveform data
      const bufferLength = analyser.frequencyBinCount
      dataArray = new Uint8Array(new ArrayBuffer(bufferLength))

      // Start drawing
      draw()

    } catch (error) {
      console.error('Oscilloscope setup error:', error)
      setupInProgress = false
    } finally {
      setupInProgress = false
    }
  }

  const draw = (currentTime?: number) => {
    if (!canvasRef || !analyser || !dataArray) return

    // Frame rate limiting - cap at 30fps (33ms per frame) for smooth visualization
    if (currentTime && currentTime - lastFrameTime < 33) {
      animationId = requestAnimationFrame(draw)
      return
    }
    lastFrameTime = currentTime || performance.now()

    const canvas = canvasRef
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // #9 — While paused, keep the canvas cleared (no flat "dead" line under the
    // glyph overlay) but keep the RAF loop alive so it resumes instantly on
    // unpause. The ⏸ glyph + caption are rendered as a DOM overlay below.
    if (props.paused?.()) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      animationId = requestAnimationFrame(draw)
      return
    }

    // Get waveform data
    analyser.getByteTimeDomainData(dataArray)

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Draw waveform with enhanced styling
    ctx.lineWidth = Math.max(2, 3 * window.devicePixelRatio)
    ctx.strokeStyle = '#ec4899'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()

    // Process every point for better quality now that performance issues are fixed
    const sliceWidth = canvas.width / dataArray.length
    let x = 0

    for (let i = 0; i < dataArray.length; i++) {
      // Convert byte data (0-255) to normalized range
      const normalized = (dataArray[i] - 128) / 128.0

      // Further reduced amplification from 5x to 2.5x for calmer visualization
      const amplified = normalized * 2.5

      // Scale to canvas and clamp to bounds
      let y = (canvas.height / 2) - (amplified * canvas.height * 0.4)
      y = Math.max(0, Math.min(canvas.height, y))

      if (i === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }

      x += sliceWidth
    }

    ctx.stroke()

    // Continue animation
    animationId = requestAnimationFrame(draw)
  }

  const cleanup = () => {
    // Stop animation
    if (animationId !== null) {
      cancelAnimationFrame(animationId)
      animationId = null
    }

    // Disconnect audio nodes
    if (source) {
      source.disconnect()
      source = null
    }

    if (analyser) {
      analyser.disconnect()
      analyser = null
    }

    // Close audio context
    if (audioContext && audioContext.state !== 'closed') {
      audioContext.close()
      audioContext = null
    }

    dataArray = null
    setupInProgress = false
    lastFrameTime = 0
  }

  // React to stream changes
  createEffect(() => {
    if (props.stream) {
      cleanup() // Clean up previous instance
      setupOscilloscope()
    } else {
      cleanup()
    }
  })

  onMount(() => {
    // Set canvas dimensions once on mount
    if (canvasRef) {
      const canvas = canvasRef
      canvas.width = canvas.offsetWidth * window.devicePixelRatio || 400
      canvas.height = (props.height || 60) * window.devicePixelRatio
      canvas.style.width = `${canvas.offsetWidth}px`
      canvas.style.height = `${props.height || 60}px`
    }

    if (props.stream && canvasRef) {
      setupOscilloscope()
    }
  })

  onCleanup(() => {
    cleanup()
  })

  // #9 — DJ-attributed caption. NEVER phrase as the user's own action; falls
  // back to a neutral DJ-side message when the DJ name is unknown.
  const pausedCaption = createMemo(() => {
    const name = props.djName?.trim()
    return name ? `${name} paused` : 'Stream paused'
  })

  return (
    <div class={`card-glass rounded-lg p-3 relative ${props.class || ''}`}>
      <canvas
        ref={canvasRef}
        class="w-full"
        style={`height: ${props.height || 60}px; background: transparent;`}
      />
      {/* #9 — Paused affordance, kept inside the visualization area only. Reuses
          the PAUSED palette (gruvbox yellow) that ConnectionStatusDot uses. */}
      <Show when={props.paused?.()}>
        <div
          class="absolute inset-0 flex flex-col items-center justify-center gap-1 text-gruvbox-yellow-bright pointer-events-none"
          role="status"
          aria-label={pausedCaption()}
        >
          <span class="text-2xl leading-none" aria-hidden="true">⏸</span>
          <span class="text-sm font-medium">{pausedCaption()}</span>
        </div>
      </Show>
    </div>
  )
}
