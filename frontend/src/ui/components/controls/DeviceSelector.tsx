import { createSignal, For, Show, onMount } from 'solid-js'
import { Effect } from 'effect'
import type { RoomStore } from '../../../stores/room.store'
import { previewAudioDevice } from '../../../services/flows/dj-flows.service'

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

  // DISABLED: Component-level cleanup to preserve streams during navigation
  // This should only be called as part of explicit session cleanup, not route changes
  /*
  onCleanup(() => {
    // Stop preview stream when component unmounts
    Effect.runPromise(stopDevicePreview(props.roomStore))
      .catch(err => console.error('Error stopping device preview:', err))
  })
  */

  const loadAudioDevices = async () => {
    setIsLoading(true)
    setError(null)

    try {
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

      setDevices(audioInputs)

      // Auto-select first device if none selected
      if (audioInputs.length > 0 && !selectedDevice()) {
        const firstDevice = audioInputs[0].deviceId
        setSelectedDevice(firstDevice)
        
        // Start preview for first device and notify parent
        await handleDeviceSelection(firstDevice)
      }
    } catch (err) {
      setError('Audio input access denied')
      console.error('Error loading audio devices:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDeviceSelection = async (deviceId: string) => {
    try {
      // Only start preview if DJ is not currently streaming
      if (!props.roomStore.isDJStreaming) {
        // Start preview stream for the selected device
        await Effect.runPromise(previewAudioDevice(props.roomStore, deviceId))
      }
      
      // Always notify parent component of device selection
      props.onDeviceSelected?.(deviceId)
    } catch (err) {
      console.error('Failed to preview device:', err)
      setError(`Failed to preview device: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }
  
  const handleDeviceChange = (event: Event) => {
    const target = event.target as HTMLSelectElement
    const deviceId = target.value
    
    setSelectedDevice(deviceId)
    handleDeviceSelection(deviceId)
  }

  return (
    <div class="form-control w-full">
      <label class="label">
        <span class="label-text">Audio Source</span>
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
              Select audio source
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