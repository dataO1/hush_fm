import { createSignal, createResource, For, Show, onMount, createEffect } from 'solid-js'
import { Effect } from 'effect'
import { getBrowserInfo } from '../webrtc/device-manager'
import { selectedDeviceId, setSelectedDeviceId } from '../webrtc/store'

/**
 * Audio device information
 */
type AudioDevice = {
  deviceId: string
  label: string
  groupId: string
}

/**
 * Device Selector Component
 * Allows users to select audio input device for streaming
 */
export function DeviceSelector() {
  const [devices, setDevices] = createSignal<AudioDevice[]>([])
  const [isLoading, setIsLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [permissionStatus, setPermissionStatus] = createSignal<'granted' | 'denied' | 'prompt'>('prompt')

  // Get browser info for compatibility checking
  const [browserInfo] = createResource(
    () => Effect.runPromise(getBrowserInfo())
  )

  // Load available audio devices
  const loadAudioDevices = async () => {
    setIsLoading(true)
    setError(null)

    try {
      // Request microphone permission first
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      setPermissionStatus('granted')
      
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
      
      // Set default device if none selected
      if (!selectedDeviceId() && audioInputs.length > 0) {
        setSelectedDeviceId(audioInputs[0].deviceId)
      }
      
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          setPermissionStatus('denied')
          setError('Microphone access denied. Please allow microphone access to select audio devices.')
        } else if (error.name === 'NotFoundError') {
          setError('No audio input devices found.')
        } else {
          setError(`Failed to access audio devices: ${error.message}`)
        }
      } else {
        setError('Unknown error occurred while accessing audio devices.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  // Test selected audio device
  const testAudioDevice = async (deviceId: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } }
      })
      
      // Create a temporary audio context to test the device
      const audioContext = new AudioContext()
      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      
      source.connect(analyser)
      
      // Clean up after 1 second
      setTimeout(() => {
        stream.getTracks().forEach(track => track.stop())
        audioContext.close()
      }, 1000)
      
      return true
    } catch (error) {
      console.error('Device test failed:', error)
      return false
    }
  }

  // Handle device selection
  const handleDeviceSelect = async (deviceId: string) => {
    setSelectedDeviceId(deviceId)
    
    // Test the device in background
    testAudioDevice(deviceId)
  }

  // Load devices on mount
  onMount(() => {
    loadAudioDevices()
  })

  // Listen for device changes
  createEffect(() => {
    const handleDeviceChange = () => {
      loadAudioDevices()
    }

    navigator.mediaDevices?.addEventListener('devicechange', handleDeviceChange)

    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', handleDeviceChange)
    }
  })

  return (
    <div class="bg-white rounded-lg shadow-lg p-6 w-full max-w-md">
      <h2 class="text-lg font-semibold mb-4 text-gray-800">
        Audio Device
      </h2>

      {/* Browser Compatibility Info */}
      <Show when={browserInfo()}>
        <div class="mb-4 text-xs text-gray-600">
          <div class="flex items-center justify-between">
            <span>WebRTC Support:</span>
            <span class={browserInfo()?.supported ? 'text-green-600' : 'text-red-600'}>
              {browserInfo()?.supported ? '✓ Supported' : '✗ Not Supported'}
            </span>
          </div>
        </div>
      </Show>

      {/* Permission Status */}
      <Show when={permissionStatus() !== 'granted'}>
        <div class={`mb-4 p-3 rounded-lg ${
          permissionStatus() === 'denied' 
            ? 'bg-red-50 border border-red-200' 
            : 'bg-yellow-50 border border-yellow-200'
        }`}>
          <div class={`text-sm ${
            permissionStatus() === 'denied' ? 'text-red-700' : 'text-yellow-700'
          }`}>
            {permissionStatus() === 'denied' 
              ? '🚫 Microphone access denied'
              : '🎤 Microphone access needed'
            }
          </div>
          <button
            onClick={loadAudioDevices}
            disabled={isLoading()}
            class="mt-2 px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
          >
            {isLoading() ? 'Requesting...' : 'Grant Access'}
          </button>
        </div>
      </Show>

      {/* Device Selection */}
      <Show
        when={!isLoading() && permissionStatus() === 'granted'}
        fallback={
          <Show when={isLoading()}>
            <div class="flex items-center justify-center py-4 text-gray-500">
              <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500 mr-2"></div>
              Loading devices...
            </div>
          </Show>
        }
      >
        <div class="space-y-3">
          <Show
            when={devices().length > 0}
            fallback={
              <div class="text-center py-4 text-gray-500">
                No audio input devices found
              </div>
            }
          >
            <label class="block text-sm font-medium text-gray-700 mb-2">
              Select Microphone:
            </label>
            
            <div class="space-y-2">
              <For each={devices()}>
                {(device) => (
                  <div 
                    class={`p-3 border rounded-lg cursor-pointer transition-colors ${
                      selectedDeviceId() === device.deviceId
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                    onClick={() => handleDeviceSelect(device.deviceId)}
                  >
                    <div class="flex items-center justify-between">
                      <div class="flex items-center space-x-3">
                        <input
                          type="radio"
                          checked={selectedDeviceId() === device.deviceId}
                          onChange={() => handleDeviceSelect(device.deviceId)}
                          class="text-blue-500"
                        />
                        <div>
                          <div class="text-sm font-medium text-gray-800">
                            {device.label}
                          </div>
                          <div class="text-xs text-gray-500">
                            ID: {device.deviceId.slice(0, 20)}...
                          </div>
                        </div>
                      </div>
                      <Show when={selectedDeviceId() === device.deviceId}>
                        <span class="text-blue-500 text-sm">✓</span>
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          {/* Refresh Button */}
          <button
            onClick={loadAudioDevices}
            disabled={isLoading()}
            class="w-full px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded transition-colors disabled:bg-gray-50"
          >
            <span class="mr-1">🔄</span>
            Refresh Devices
          </button>
        </div>
      </Show>

      {/* Error Display */}
      <Show when={error()}>
        <div class="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <div class="text-red-700 text-sm">
            {error()}
          </div>
        </div>
      </Show>

      {/* WebRTC Capabilities Debug Info (development) */}
      <Show when={browserInfo()?.webrtcSupport}>
        <details class="mt-4">
          <summary class="text-xs text-gray-500 cursor-pointer">
            Technical Details
          </summary>
          <div class="mt-2 text-xs text-gray-600 space-y-1">
            <div>getUserMedia: {browserInfo()?.webrtcSupport.getUserMedia ? '✓' : '✗'}</div>
            <div>RTCPeerConnection: {browserInfo()?.webrtcSupport.rtcPeerConnection ? '✓' : '✗'}</div>
            <div>Web Audio API: {browserInfo()?.webrtcSupport.webAudio ? '✓' : '✗'}</div>
            <div>Selected Device: {selectedDeviceId()?.slice(0, 10) || 'None'}</div>
          </div>
        </details>
      </Show>
    </div>
  )
}