import { createSignal, onMount, onCleanup } from 'solid-js'

interface AudioLevelMeterProps {
  stream?: MediaStream
  class?: string
}

export function AudioLevelMeter(props: AudioLevelMeterProps) {
  const [level, setLevel] = createSignal(0)
  let audioContext: AudioContext | undefined
  let analyser: AnalyserNode | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let animationFrame: number | undefined

  const startMonitoring = () => {
    if (!props.stream) return

    try {
      audioContext = new AudioContext()
      analyser = audioContext.createAnalyser()
      source = audioContext.createMediaStreamSource(props.stream)
      
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.8
      
      source.connect(analyser)
      
      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      
      const updateLevel = () => {
        if (!analyser) return
        
        analyser.getByteFrequencyData(dataArray)
        const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length
        setLevel(average / 255) // Normalize to 0-1
        
        animationFrame = requestAnimationFrame(updateLevel)
      }
      
      updateLevel()
    } catch (error) {
      console.error('Error setting up audio level monitoring:', error)
    }
  }

  const stopMonitoring = () => {
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
    setLevel(0)
  }

  onMount(() => {
    if (props.stream) {
      startMonitoring()
    }
  })

  onCleanup(() => {
    stopMonitoring()
  })

  // Restart monitoring when stream changes
  const currentStream = () => props.stream
  let previousStream: MediaStream | undefined
  
  const checkStreamChange = () => {
    const stream = currentStream()
    if (stream !== previousStream) {
      stopMonitoring()
      if (stream) {
        startMonitoring()
      }
      previousStream = stream
    }
    requestAnimationFrame(checkStreamChange)
  }
  
  onMount(() => {
    checkStreamChange()
  })

  return (
    <div class={`flex items-center gap-2 ${props.class || ''}`}>
      <span class="text-sm text-gray-600 font-medium">Input Level:</span>
      <div class="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
        <div 
          class={`h-full rounded-full transition-all duration-100 ${
            level() > 0.8 ? 'bg-red-500' :
            level() > 0.5 ? 'bg-yellow-500' :
            level() > 0.1 ? 'bg-green-500' :
            'bg-gray-400'
          }`}
          style={{ width: `${Math.max(level() * 100, 2)}%` }}
        ></div>
      </div>
      <span class="text-xs text-gray-500 w-8 text-right">
        {Math.round(level() * 100)}%
      </span>
    </div>
  )
}