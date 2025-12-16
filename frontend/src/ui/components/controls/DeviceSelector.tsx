import { createSignal, For, Show, onMount } from 'solid-js'
import type { RoomStore } from '../../../stores/room.store'

type AudioDevice = {
  deviceId: string
  label: string
  groupId: string
}

type Props = {
  disabled?: boolean
  roomStore: RoomStore
  onDeviceSelected?: (deviceId: string) => void
}

export function DeviceSelector(props: Props) {
  const [devices, setDevices] = createSignal<AudioDevice[]>([])
  const [isLoading, setIsLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [selectedDevice, setSelectedDevice] = createSignal<string>('')

  onMount(() => {
    loadAudioDevices()
  })

  const loadAudioDevices = async () => {
    setIsLoading(true)
    setError(null)

    try {
      // Request microphone permission first
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      
      // Stop the temporary stream
      stream.getTracks().forEach(track => track.stop())

      // Enumerate devices
      const deviceList = await navigator.mediaDevices.enumerateDevices()
      const audioInputs = deviceList
        .filter(device => device.kind === 'audioinput' && device.deviceId !== 'default')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${device.deviceId.slice(0, 5)}`,
          groupId: device.groupId,
        }))

      setDevices(audioInputs)

      // Auto-select first device if none selected
      if (audioInputs.length > 0 && !selectedDevice()) {
        const firstDevice = audioInputs[0].deviceId
        setSelectedDevice(firstDevice)
        console.log('Auto-selecting first device:', firstDevice)
        
        // Notify parent component
        props.onDeviceSelected?.(firstDevice)
      }
    } catch (err) {
      setError('Microphone access denied')
      console.error('Error loading audio devices:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDeviceChange = (event: Event) => {
    const target = event.target as HTMLSelectElement
    const deviceId = target.value
    
    setSelectedDevice(deviceId)
    console.log('Device selected:', deviceId)
    
    // Notify parent component of device selection
    props.onDeviceSelected?.(deviceId)
  }

  return (
    <div class="form-control w-full">
      <label class="label">
        <span class="label-text">Microphone</span>
      </label>
      
      <Show
        when={!isLoading()}
        fallback={
          <div class="flex items-center gap-2">
            <span class="loading loading-spinner loading-sm"></span>
            <span class="text-sm">Loading devices...</span>
          </div>
        }
      >
        <Show
          when={!error()}
          fallback={
            <div class="alert alert-error">
              <span>{error()}</span>
              <button 
                class="btn btn-sm" 
                onClick={loadAudioDevices}
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
            disabled={props.disabled || isLoading()}
          >
            <option disabled value="">
              Select microphone
            </option>
            <For each={devices()}>
              {(device) => (
                <option value={device.deviceId}>
                  {device.label}
                </option>
              )}
            </For>
          </select>
        </Show>
      </Show>
    </div>
  )
}