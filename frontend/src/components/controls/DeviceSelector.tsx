import { createSignal, For, Show, onMount } from 'solid-js'
import { Option } from 'effect'
import { useWebRTC } from '../../providers/WebRTCProvider'

type AudioDevice = {
  deviceId: string
  label: string
  groupId: string
}

export function DeviceSelector() {
  const { selectedDeviceId, setSelectedDeviceId } = useWebRTC()
  const [devices, setDevices] = createSignal<AudioDevice[]>([])
  const [isLoading, setIsLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

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
      if (audioInputs.length > 0 && Option.isNone(selectedDeviceId())) {
        setSelectedDeviceId(Option.some(audioInputs[0].deviceId))
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
    setSelectedDeviceId(Option.some(target.value))
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
              <button class="btn btn-sm" onClick={loadAudioDevices}>
                Retry
              </button>
            </div>
          }
        >
          <select
            class="select select-bordered w-full"
            value={Option.getOrElse(selectedDeviceId(), () => '')}
            onChange={handleDeviceChange}
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