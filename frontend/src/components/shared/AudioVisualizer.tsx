import { createSignal, onMount, onCleanup, For } from 'solid-js'

interface AudioVisualizerProps {
  stream?: MediaStream
  isActive?: boolean
  class?: string
  barCount?: number
}

export function AudioVisualizer(props: AudioVisualizerProps) {
  const [levels, setLevels] = createSignal<number[]>([])
  const barCount = () => props.barCount || 20
  
  let audioContext: AudioContext | undefined
  let analyser: AnalyserNode | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let animationFrame: number | undefined

  const startVisualization = () => {
    if (!props.stream) return

    try {
      audioContext = new AudioContext()
      analyser = audioContext.createAnalyser()
      source = audioContext.createMediaStreamSource(props.stream)
      
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.8
      
      source.connect(analyser)
      
      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      const bars = barCount()
      
      const updateVisualization = () => {
        if (!analyser || !props.isActive) {
          // Show flat bars when not active
          setLevels(new Array(bars).fill(0.1))
          animationFrame = requestAnimationFrame(updateVisualization)
          return
        }
        
        analyser.getByteFrequencyData(dataArray)
        
        // Group frequency data into bars
        const barWidth = Math.floor(dataArray.length / bars)
        const barLevels: number[] = []
        
        for (let i = 0; i < bars; i++) {
          const start = i * barWidth
          const end = start + barWidth
          const slice = dataArray.slice(start, end)
          const average = slice.reduce((sum, value) => sum + value, 0) / slice.length
          barLevels.push(Math.max(0.1, average / 255)) // Normalize and ensure minimum height
        }
        
        setLevels(barLevels)
        animationFrame = requestAnimationFrame(updateVisualization)
      }
      
      updateVisualization()
    } catch (error) {
      console.error('Error setting up audio visualization:', error)
      // Fallback to animated bars
      startFallbackAnimation()
    }
  }

  const startFallbackAnimation = () => {
    const bars = barCount()
    let frame = 0
    
    const animate = () => {
      const barLevels = new Array(bars).fill(0).map((_, i) => {
        if (!props.isActive) return 0.1
        return 0.3 + Math.sin((frame + i * 0.5) * 0.1) * 0.3
      })
      
      setLevels(barLevels)
      frame++
      animationFrame = requestAnimationFrame(animate)
    }
    
    animate()
  }

  const stopVisualization = () => {
    if (animationFrame) {
      cancelAnimationFrame(animationFrame)
      animationFrame = undefined
    }
    
    if (source) {
      source.disconnect()
      source = undefined
    }
    
    if (audioContext) {
      audioContext.close()
      audioContext = undefined
    }
    
    analyser = undefined
    setLevels([])
  }

  onMount(() => {
    if (props.stream) {
      startVisualization()
    } else {
      // Start with fallback animation
      startFallbackAnimation()
    }
  })

  onCleanup(() => {
    stopVisualization()
  })

  // Restart when stream changes
  const currentStream = () => props.stream
  let previousStream: MediaStream | undefined
  
  const checkStreamChange = () => {
    const stream = currentStream()
    if (stream !== previousStream) {
      stopVisualization()
      if (stream) {
        startVisualization()
      } else {
        startFallbackAnimation()
      }
      previousStream = stream
    }
    requestAnimationFrame(checkStreamChange)
  }
  
  onMount(() => {
    checkStreamChange()
  })

  return (
    <div class={`flex items-end justify-center gap-1 h-16 ${props.class || ''}`}>
      <For each={levels()}>
        {(level, index) => (
          <div
            class="bg-gradient-to-t from-blue-500 via-purple-500 to-pink-500 rounded-t transition-all duration-75"
            style={{
              width: '4px',
              height: `${Math.max(level * 100, 10)}%`,
              'animation-delay': `${index() * 50}ms`
            }}
          ></div>
        )}
      </For>
      
      {/* Fallback when no levels */}
      {levels().length === 0 && (
        <For each={new Array(barCount()).fill(0)}>
          {(_) => (
            <div
              class="bg-gray-300 rounded-t"
              style={{
                width: '4px',
                height: '10%'
              }}
            ></div>
          )}
        </For>
      )}
    </div>
  )
}