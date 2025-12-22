import { createSignal, For, Show, createResource } from 'solid-js'
import type { DJStore } from '../../../stores/dj.store'
import { useDJService } from '../../hooks/useEffectService'


type Props = {
  disabled?: boolean
  djStore: DJStore
  onDeviceSelected?: (deviceId: string) => void
}

export function DeviceSelector(props: Props) {
  // SolidJS 2025: Use Application Service via Context
  const djService = useDJService()
  
  const [selectedDevice, setSelectedDevice] = createSignal<string>('')
  const [devicePreviewRequest, setDevicePreviewRequest] = createSignal<string | null>(null)
  const [deviceLoadTrigger, setDeviceLoadTrigger] = createSignal(0)

  // SolidJS 2025: Use createResource for device loading
  const [audioDevices] = createResource(deviceLoadTrigger, async () => {
    try {
      console.info('🎤 Loading audio devices...')
      
      // Request audio input permission first
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      
      // Stop the temporary stream
      stream.getTracks().forEach(track => track.stop())

      // Enumerate devices
      const deviceList = await navigator.mediaDevices.enumerateDevices()
      const audioInputs = deviceList
        .filter(device => device.kind === 'audioinput' && device.deviceId !== 'default')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Audio Source ${device.deviceId.slice(0, 5)}`,
          groupId: device.groupId,
        }))

      // Auto-select first device if none selected and devices are available
      if (audioInputs.length > 0 && !selectedDevice()) {
        const firstDevice = audioInputs[0].deviceId
        setSelectedDevice(firstDevice)
        
        // Start preview for first device and notify parent
        setDevicePreviewRequest(firstDevice)
        props.onDeviceSelected?.(firstDevice)
      }
      
      console.info('✅ Audio devices loaded successfully')
      return audioInputs
    } catch (err) {
      console.error('Error loading audio devices:', err)
      throw new Error('Audio input access denied')
    }
  })

  // SolidJS 2025: Use createResource for device preview
  const [devicePreviewOperation] = createResource(devicePreviewRequest, async (deviceId) => {
    if (!deviceId || props.djStore.isStreaming()) {
      return null // Skip preview if DJ is already streaming
    }
    
    try {
      console.info(`🎤 Starting preview for device: ${deviceId}`)
      
      const result = await djService.previewAudioDevice(deviceId)
      
      console.info('✅ Device preview started successfully')
      return result
    } catch (err) {
      console.error('Failed to preview device:', err)
      throw new Error(`Failed to preview device: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  })


  const handleDeviceSelection = (deviceId: string) => {
    // Always notify parent component of device selection
    props.onDeviceSelected?.(deviceId)
    
    // Start preview only if DJ is not streaming
    if (!props.djStore.isStreaming()) {
      setDevicePreviewRequest(deviceId)
    }
  }
  
  const handleDeviceChange = (event: Event) => {
    const target = event.target as HTMLSelectElement
    const deviceId = target.value
    
    setSelectedDevice(deviceId)
    handleDeviceSelection(deviceId)
  }
  
  // Retry function for device loading
  const retryDeviceLoading = () => {
    // Trigger refetch by incrementing the trigger signal
    setDeviceLoadTrigger(prev => prev + 1)
  }

  return (
    <div class="form-control w-full">
      <label class="label">
        <span class="label-text">Audio Source</span>
      </label>
      
      <Show
        when={!audioDevices.loading}
        fallback={
          <div class="flex items-center gap-2">
            <span class="loading loading-spinner loading-sm"></span>
            <span class="text-sm">Loading devices...</span>
          </div>
        }
      >
        <Show
          when={!audioDevices.error}
          fallback={
            <div class="alert alert-error">
              <span>{audioDevices.error?.message || 'Failed to load devices'}</span>
              <button 
                class="btn btn-sm" 
                onClick={retryDeviceLoading}
                disabled={props.disabled}
              >
                Retry
              </button>
            </div>
          }
        >
          <select
            class="select select-bordered w-full"
            value={selectedDevice()}
            onChange={handleDeviceChange}
            disabled={props.disabled || audioDevices.loading || devicePreviewOperation.loading}
          >
            <option disabled value="">
              Select audio source
            </option>
            <For each={audioDevices() || []}>
              {(device) => (
                <option value={device.deviceId}>
                  {device.label}
                </option>
              )}
            </For>
          </select>
          
          {/* Show device preview loading state */}
          <Show when={devicePreviewOperation.loading}>
            <div class="flex items-center gap-2 mt-2">
              <span class="loading loading-spinner loading-sm"></span>
              <span class="text-sm text-white/70">Starting preview...</span>
            </div>
          </Show>
          
          {/* Show device preview errors */}
          <Show when={devicePreviewOperation.error}>
            <div class="alert alert-warning mt-2">
              <span class="text-sm">{devicePreviewOperation.error.message}</span>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  )
}