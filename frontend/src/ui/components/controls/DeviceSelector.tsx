import { For, Show } from 'solid-js'
import type { AudioAdapter } from '../../../stores/audio/audio.adapter'
import type { Context } from 'effect'

type Props = {
  disabled?: boolean
  audioAdapter: Context.Tag.Service<AudioAdapter>
  onDeviceSelected?: (deviceId: string) => void
}

export function DeviceSelector(props: Props) {
  // Get device list from AudioAdapter
  const audioDevices = () => props.audioAdapter.getAvailableDevices()
  
  // Get current device ID from AudioAdapter
  const currentDeviceId = () => props.audioAdapter.getCurrentDeviceId()
  
  // Check if currently playing/streaming
  const isPlaying = () => props.audioAdapter.isPlaying()

  const handleDeviceChange = (event: Event) => {
    const target = event.target as HTMLSelectElement
    const deviceId = target.value
    
    // Notify parent component of device selection
    props.onDeviceSelected?.(deviceId)
  }

  return (
    <div class="form-control w-full">
      <label class="label">
        <span class="label-text">Audio Source</span>
      </label>
      
      <select
        class="select select-bordered w-full"
        value={currentDeviceId() || ''}
        onChange={handleDeviceChange}
        disabled={props.disabled || isPlaying()}
      >
        <option disabled value="">
          Select audio source
        </option>
        <For each={audioDevices()}>
          {(device) => (
            <option value={device.deviceId}>
              {device.label || `Audio Source ${device.deviceId.slice(0, 5)}`}
            </option>
          )}
        </For>
      </select>
      
      {/* Show error if any */}
      <Show when={props.audioAdapter.hasError()}>
        <div class="alert alert-warning mt-2">
          <span class="text-sm">{props.audioAdapter.getError()}</span>
        </div>
      </Show>
      
      {/* Show if user gesture is required */}
      <Show when={props.audioAdapter.requiresUserGesture()}>
        <div class="text-sm text-yellow-400 mt-2">
          User interaction required to start audio
        </div>
      </Show>
    </div>
  )
}