import { onMount, onCleanup, createEffect } from 'solid-js'

interface OscilloscopeProps {
  stream?: MediaStream
  class?: string
  height?: number
}

export function Oscilloscope(props: OscilloscopeProps) {
  let canvasRef: HTMLCanvasElement | undefined
  let audioContext: AudioContext | null = null
  let analyser: AnalyserNode | null = null
  let source: MediaStreamAudioSourceNode | null = null
  let animationId: number | null = null
  let dataArray: Uint8Array<ArrayBuffer> | null = null

  const setupOscilloscope = () => {
    if (!props.stream || !canvasRef) return

    try {
      // Create audio context and analyser
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      
      // Resume audio context if suspended
      if (audioContext.state === 'suspended') {
        audioContext.resume()
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
      
      // Set canvas dimensions
      const canvas = canvasRef
      canvas.width = canvas.offsetWidth * window.devicePixelRatio || 400
      canvas.height = (props.height || 60) * window.devicePixelRatio
      canvas.style.width = `${canvas.offsetWidth}px`
      canvas.style.height = `${props.height || 60}px`
      
      // Start drawing
      draw()
      
    } catch (error) {
      console.error('Oscilloscope setup error:', error)
    }
  }

  const draw = () => {
    if (!canvasRef || !analyser || !dataArray) return
    
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
  }

  // React to stream changes
  createEffect(() => {
    if (props.stream && canvasRef) {
      cleanup() // Clean up previous instance
      setupOscilloscope()
    } else {
      cleanup()
    }
  })

  onMount(() => {
    if (props.stream && canvasRef) {
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