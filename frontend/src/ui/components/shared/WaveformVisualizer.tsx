import { onMount, onCleanup } from 'solid-js'

// Import with any type to avoid type checking issues
const { MediaStreamOscilloscope } = require('webaudio-oscilloscope')

interface WaveformVisualizerProps {
  stream?: MediaStream
  class?: string
}

export function WaveformVisualizer(props: WaveformVisualizerProps) {
  let canvasRef: HTMLCanvasElement | undefined
  let oscilloscope: any = null

  onMount(() => {
    if (props.stream && canvasRef) {
      try {
        // Set canvas size
        canvasRef.width = canvasRef.offsetWidth || 400
        canvasRef.height = canvasRef.offsetHeight || 48
        
        // Create oscilloscope with MediaStreamOscilloscope for simplicity
        oscilloscope = new MediaStreamOscilloscope(
          props.stream,
          canvasRef,
          null, // audioDestination - not needed for visualization only
          2048, // fftSize
          (context: CanvasRenderingContext2D) => {
            // Initialize canvas styling
            context.strokeStyle = 'currentColor'
            context.lineWidth = 2
            context.lineCap = 'round'
            context.fillStyle = 'transparent'
          }
        )
        
        // Start the oscilloscope
        oscilloscope.start()
        
      } catch (error) {
        console.error('Error setting up waveform visualization:', error)
      }
    }
  })

  onCleanup(() => {
    if (oscilloscope) {
      oscilloscope.reset()
      oscilloscope = null
    }
  })

  return (
    <canvas
      ref={canvasRef}
      class={`w-full h-12 ${props.class || ''}`}
      style="color: hsl(var(--bc))"
    />
  )
}