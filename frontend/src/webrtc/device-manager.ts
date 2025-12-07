import { Effect, pipe } from 'effect'
import { Device } from 'mediasoup-client'
import { deviceActions } from './store'

/**
 * Error types for device management
 */
export class DeviceError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message)
    this.name = 'DeviceError'
  }
}

export class UnsupportedBrowserError extends DeviceError {
  constructor() {
    super('Browser does not support WebRTC')
    this.name = 'UnsupportedBrowserError'
  }
}

/**
 * Device manager with Effect-TS integration
 */
export class DeviceManager {
  private device: Device | null = null

  /**
   * Initialize mediasoup device with router capabilities
   */
  initializeDevice = (routerRtpCapabilities: any): Effect.Effect<Device, DeviceError> =>
    pipe(
      Effect.tryPromise({
        try: async () => {
          // Check browser support by creating device
          let device: Device
          try {
            device = new Device()
          } catch (error) {
            if ((error as Error).name === 'UnsupportedError') {
              throw new UnsupportedBrowserError()
            }
            throw error
          }
          
          // Load device with router capabilities
          await device.load({ routerRtpCapabilities })
          
          this.device = device
          
          // Update reactive store
          deviceActions.setDevice(device)
          deviceActions.setLoaded(true)
          deviceActions.setCapabilities(device.rtpCapabilities)
          deviceActions.setError(null)

          return device
        },
        catch: (error) => {
          const deviceError = error instanceof DeviceError 
            ? error 
            : new DeviceError(
                error instanceof Error ? error.message : String(error),
                error
              )

          // Update store with error
          deviceActions.setError(deviceError.message)
          
          return deviceError
        }
      }),
      Effect.tap(() => Effect.logInfo('Device initialized successfully'))
    )

  /**
   * Get current device or fail if not initialized
   */
  getDevice = (): Effect.Effect<Device, DeviceError> =>
    this.device 
      ? Effect.succeed(this.device)
      : Effect.fail(new DeviceError('Device not initialized'))

  /**
   * Get device RTP capabilities
   */
  getRtpCapabilities = (): Effect.Effect<any, DeviceError> =>
    pipe(
      this.getDevice(),
      Effect.map(device => device.rtpCapabilities),
      Effect.tap(() => Effect.logDebug('Retrieved RTP capabilities'))
    )

  /**
   * Check if device can produce audio
   */
  canProduceAudio = (): Effect.Effect<boolean, DeviceError> =>
    pipe(
      this.getDevice(),
      Effect.map(device => device.canProduce('audio')),
      Effect.tap(canProduce => 
        Effect.logDebug(`Device can produce audio: ${canProduce}`)
      )
    )

  /**
   * Check if device can produce video
   */
  canProduceVideo = (): Effect.Effect<boolean, DeviceError> =>
    pipe(
      this.getDevice(),
      Effect.map(device => device.canProduce('video')),
      Effect.tap(canProduce => 
        Effect.logDebug(`Device can produce video: ${canProduce}`)
      )
    )

  /**
   * Get device information for debugging
   */
  getDeviceInfo = (): Effect.Effect<{
    loaded: boolean
    canProduceAudio: boolean
    canProduceVideo: boolean
    rtpCapabilities: any
  }, DeviceError> =>
    pipe(
      Effect.all({
        device: this.getDevice(),
        canProduceAudio: this.canProduceAudio(),
        canProduceVideo: this.canProduceVideo(),
      }),
      Effect.map(({ device, canProduceAudio, canProduceVideo }) => ({
        loaded: device.loaded,
        canProduceAudio,
        canProduceVideo,
        rtpCapabilities: device.rtpCapabilities,
      }))
    )

  /**
   * Reset device state
   */
  resetDevice = (): Effect.Effect<void, never> =>
    Effect.sync(() => {
      this.device = null
      deviceActions.setDevice(null)
      deviceActions.setLoaded(false)
      deviceActions.setCapabilities(null)
      deviceActions.setError(null)
    })

  /**
   * Lazy initialization with caching
   */
  ensureDevice = (routerRtpCapabilities: any): Effect.Effect<Device, DeviceError> =>
    this.device && this.device.loaded
      ? Effect.succeed(this.device)
      : this.initializeDevice(routerRtpCapabilities)
}

/**
 * Global device manager instance
 */
export const deviceManager = new DeviceManager()

/**
 * Browser compatibility check
 */
export const checkBrowserSupport = (): Effect.Effect<boolean, DeviceError> =>
  Effect.sync(() => {
    try {
      new Device()
      return true
    } catch (error) {
      if ((error as Error).name === 'UnsupportedError') {
        deviceActions.setError('Browser does not support WebRTC')
        return false
      }
      // Other errors also indicate lack of support
      deviceActions.setError('Browser does not support WebRTC')
      return false
    }
  })

/**
 * Get browser WebRTC capabilities info
 */
export const getBrowserInfo = (): Effect.Effect<{
  supported: boolean
  userAgent: string
  webrtcSupport: {
    getUserMedia: boolean
    rtcPeerConnection: boolean
    webAudio: boolean
  }
}, never> =>
  Effect.sync(() => ({
    supported: (() => {
    try {
      new Device()
      return true
    } catch {
      return false
    }
  })(),
    userAgent: navigator.userAgent,
    webrtcSupport: {
      getUserMedia: !!(navigator.mediaDevices?.getUserMedia),
      rtcPeerConnection: !!(window.RTCPeerConnection),
      webAudio: !!(window.AudioContext || (window as any).webkitAudioContext),
    }
  }))

/**
 * Utility to format capabilities for debugging
 */
export const formatCapabilities = (capabilities: any): string => {
  if (!capabilities) return 'No capabilities'
  
  return JSON.stringify({
    codecs: capabilities.codecs?.map((c: any) => ({
      mimeType: c.mimeType,
      clockRate: c.clockRate,
      channels: c.channels,
    })) || [],
    headerExtensions: capabilities.headerExtensions?.map((h: any) => ({
      uri: h.uri,
      preferredId: h.preferredId,
    })) || [],
  }, null, 2)
}