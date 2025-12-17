import { onMount, onCleanup, createEffect } from 'solid-js'

interface OscilloscopeProps {
  stream?: MediaStream
  class?: string
  height?: number
  userGestureAvailable?: boolean // Pass this from parent component
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
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      
      // Handle suspended audio context (no user gesture)
      if (audioContext.state === 'suspended') {
        console.info('AudioContext suspended - waiting for user gesture to resume')
        // Don't try to resume automatically - wait for user interaction
        return
      }
      
      analyser = audioContext.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.3
      
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
    
    // Frame rate limiting - cap at 60fps
    if (currentTime && currentTime - lastFrameTime < 16.67) {
      animationId = requestAnimationFrame(draw)
      return
    }
    lastFrameTime = currentTime || performance.now()
    
    // Get waveform data
    analyser.getByteTimeDomainData(dataArray)
    
    const canvas = canvasRef
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    
    // Draw waveform with enhanced styling
    ctx.lineWidth = Math.max(2, 3 * window.devicePixelRatio)
    ctx.strokeStyle = '#ec4899'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    
    const sliceWidth = canvas.width / dataArray.length
    let x = 0
    
    for (let i = 0; i < dataArray.length; i++) {
      // Convert byte data (0-255) to normalized range
      const normalized = (dataArray[i] - 128) / 128.0
      
      // Amplify small variations by 10x for better visibility
      const amplified = normalized * 10.0
      
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

  // React to stream changes and user gesture availability
  createEffect(() => {
    if (props.stream) {
      cleanup() // Clean up previous instance
      
      if (props.userGestureAvailable !== false) {
        // User gesture available or not specified, setup oscilloscope
        setupOscilloscope()
      } else {
        // No user gesture available, skip oscilloscope setup
        console.info('Oscilloscope setup deferred - no user gesture available')
      }
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
    
    if (props.stream && canvasRef && props.userGestureAvailable !== false) {
      setupOscilloscope()
    }
  })

  onCleanup(() => {
    cleanup()
  })

  return (
    <div class={`bg-white/5 backdrop-blur-sm border border-white/10 rounded-lg p-3 ${props.class || ''}`}>
      <canvas
        ref={canvasRef}
        class="w-full"
        style={`height: ${props.height || 60}px; background: transparent;`}
      />
    </div>
  )
}