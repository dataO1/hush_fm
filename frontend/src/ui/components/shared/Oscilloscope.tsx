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
  let dataArray: Uint8Array | null = null

  const setupOscilloscope = () => {
    if (!props.stream || !canvasRef) return

    try {
      // Create audio context and analyser
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      analyser = audioContext.createAnalyser()
      
      // Connect stream to analyser
      source = audioContext.createMediaStreamSource(props.stream)
      source.connect(analyser)
      
      // Configure analyser for time domain (oscilloscope) data
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.8
      
      // Create data array for waveform data
      const bufferLength = analyser.frequencyBinCount
      dataArray = new Uint8Array(bufferLength) as Uint8Array
      
      // Set canvas dimensions
      const canvas = canvasRef
      canvas.width = canvas.offsetWidth * window.devicePixelRatio || 400
      canvas.height = (props.height || 60) * window.devicePixelRatio
      canvas.style.width = `${canvas.offsetWidth}px`
      canvas.style.height = `${props.height || 60}px`
      
      // Start drawing
      draw()
      console.log('🌊 Native oscilloscope started successfully')
      
    } catch (error) {
      console.error('Error setting up native oscilloscope:', error)
    }
  }

  const draw = () => {
    if (!canvasRef || !analyser || !dataArray) return
    
    // Get waveform data
    analyser.getByteTimeDomainData(dataArray as any)
    
    const canvas = canvasRef
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    // Clear canvas completely
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    
    // Draw waveform
    ctx.lineWidth = 2 * window.devicePixelRatio
    ctx.strokeStyle = 'hsl(var(--p))' // DaisyUI primary color
    ctx.lineCap = 'round'
    ctx.beginPath()
    
    const sliceWidth = canvas.width / dataArray.length
    let x = 0
    
    for (let i = 0; i < dataArray.length; i++) {
      // Convert byte data (0-255) to canvas coordinate
      const v = dataArray[i] / 128.0 // Convert to 0-2 range
      const y = (v * canvas.height) / 2 // Scale to canvas height
      
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
    console.log('🌊 Native oscilloscope cleaned up')
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
    <div class={`bg-base-300 rounded-lg p-3 ${props.class || ''}`}>
      <canvas
        ref={canvasRef}
        class="w-full"
        style={`height: ${props.height || 60}px; background: transparent;`}
      />
    </div>
  )
}