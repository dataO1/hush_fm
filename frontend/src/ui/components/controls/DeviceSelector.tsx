import { For, Show, createSignal, onMount } from 'solid-js'

type Props = {
  getAudioDevices: () => Promise<ReadonlyArray<MediaDeviceInfo>>
  selectDevice: (deviceId: string) => Promise<MediaStream>
}

export function DeviceSelector(props: Props) {
  // Local component state
  const [devices, setDevices] = createSignal<ReadonlyArray<MediaDeviceInfo>>([])
  const [selectedDeviceId, setSelectedDeviceId] = createSignal<string>('')
  const [isLoading, setIsLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [isSelecting, setIsSelecting] = createSignal(false)
  const [permissionStatus, setPermissionStatus] = createSignal<'checking' | 'granted' | 'denied' | 'prompt'>('checking')

  // Enumerate devices on mount
  onMount(async () => {
    try {
      setIsLoading(true)
      setError(null)
      setPermissionStatus('checking')
      console.info('🎧 DeviceSelector: Enumerating audio devices...')
      
      const audioDevices = await props.getAudioDevices()
      console.info('🎧 DeviceSelector: Found devices:', audioDevices.map(d => ({
        deviceId: d.deviceId.slice(0, 8) + '...',
        label: d.label || 'Unnamed device',
        kind: d.kind
      })))
      
      // Check if we got device labels (indicates permission was granted)
      const hasLabels = audioDevices.some(device => device.label && device.label.trim() !== '')
      setPermissionStatus(hasLabels ? 'granted' : 'denied')
      
      setDevices(audioDevices)
      
      if (!hasLabels && audioDevices.length > 0) {
        console.warn('🎧 DeviceSelector: Devices found but no labels - permission may be denied')
        setError('Microphone permission required to see device names. Please allow access when prompted.')
      }
    } catch (err) {
      const errorMessage = `Failed to enumerate audio devices: ${err}`
      setError(errorMessage)
      setPermissionStatus('denied')
      console.error('❌ DeviceSelector: Failed to enumerate audio devices:', err)
    } finally {
      setIsLoading(false)
    }
  })

  const handleDeviceChange = async (event: Event) => {
    const target = event.target as HTMLSelectElement
    const deviceId = target.value
    
    if (!deviceId) return

    const selectedDevice = devices().find(d => d.deviceId === deviceId)
    console.info('🎧 DeviceSelector: User selected device:', {
      deviceId: deviceId.slice(0, 8) + '...',
      label: selectedDevice?.label || 'Unknown device'
    })

    try {
      setIsSelecting(true)
      setError(null)
      await props.selectDevice(deviceId)
      setSelectedDeviceId(deviceId)
      console.info('✅ DeviceSelector: Device selection successful')
    } catch (err) {
      setError(`Failed to select audio device: ${err}`)
      console.error('❌ DeviceSelector: Failed to select audio device:', err)
      // Reset selection on error
      setSelectedDeviceId('')
      target.value = ''
    } finally {
      setIsSelecting(false)
    }
  }

  return (
    <div class="form-control w-full">
      <label class="label">
        <span class="label-text">Audio Source</span>
      </label>
      
      <select
        class="select select-bordered w-full"
        value={selectedDeviceId()}
        onChange={handleDeviceChange}
        disabled={isLoading() || isSelecting()}
      >
        <option disabled value="">
          {isLoading() 
            ? 'Loading devices...' 
            : permissionStatus() === 'denied' && devices().length > 0
            ? 'Select audio source (names hidden - permission required)'
            : 'Select audio source'
          }
        </option>
        <For each={devices()}>
          {(device) => (
            <option value={device.deviceId}>
              {device.label || `Audio Source ${device.deviceId.slice(0, 8)}...`}
            </option>
          )}
        </For>
      </select>
      
      
      {/* Show selection loading state */}
      <Show when={isSelecting()}>
        <div class="flex items-center text-sm text-white/70 mt-2">
          <span class="loading loading-spinner loading-xs mr-2"></span>
          Selecting device...
        </div>
      </Show>
      
      {/* Show permission status info */}
      <Show when={permissionStatus() === 'checking'}>
        <div class="flex items-center text-sm text-white/70 mt-2">
          <span class="loading loading-spinner loading-xs mr-2"></span>
          Checking microphone permissions...
        </div>
      </Show>
      
      <Show when={permissionStatus() === 'denied' && devices().length > 0 && !error()}>
        <div class="alert alert-info mt-2">
          <span class="text-sm">
            🎤 Microphone access needed to show device names. Device selection still works with generic names.
          </span>
        </div>
      </Show>
      
      {/* Show error if any */}
      <Show when={error()}>
        <div class="alert alert-warning mt-2">
          <span class="text-sm">{error()}</span>
        </div>
      </Show>
    </div>
  )
}