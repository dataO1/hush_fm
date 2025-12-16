/**
 * MediaSoup Device Service
 * 
 * Extracted service for managing MediaSoup Device lifecycle:
 * - Device creation and loading
 * - RTP capabilities management
 * - Produce/consume capability checking
 * - Device state validation
 * 
 * Pure Effect-TS service with no direct WebSocket dependencies.
 */

import { Effect, pipe, Option, Context, Layer } from 'effect'
import { Device, types } from 'mediasoup-client'

/**
 * Device Service Errors
 */
export class DeviceError extends Error {
  public readonly cause?: unknown
  
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'DeviceError'
    this.cause = cause
  }
}

export class DeviceUnsupportedError extends DeviceError {
  constructor(message: string = 'Browser does not support WebRTC') {
    super(message)
    this.name = 'DeviceUnsupportedError'
  }
}

export class DeviceLoadError extends DeviceError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'DeviceLoadError'
  }
}

/**
 * Device Information
 */
export interface DeviceInfo {
  loaded: boolean
  handlerName: string | null
  canProduceAudio: boolean
  canProduceVideo: boolean
  rtpCapabilities: Option.Option<types.RtpCapabilities>
}

/**
 * Device Service Interface
 */
export interface MediaSoupDeviceService {
  /**
   * Create new MediaSoup device
   */
  readonly createDevice: () => Effect.Effect<Device, DeviceError>
  
  /**
   * Load device with router capabilities
   */
  readonly loadDevice: (device: Device, routerRtpCapabilities: types.RtpCapabilities) => Effect.Effect<void, DeviceLoadError>
  
  /**
   * Check if device can produce audio
   */
  readonly canProduceAudio: (device: Device) => Effect.Effect<boolean, DeviceError>
  
  /**
   * Check if device can produce video
   */
  readonly canProduceVideo: (device: Device) => Effect.Effect<boolean, DeviceError>
  
  /**
   * Check if device can consume media
   */
  readonly canConsume: (device: Device, rtpParameters: types.RtpParameters) => Effect.Effect<boolean, DeviceError>
  
  /**
   * Get device information
   */
  readonly getDeviceInfo: (device: Device) => Effect.Effect<DeviceInfo, DeviceError>
  
  /**
   * Check WebRTC support
   */
  readonly checkWebRTCSupport: () => Effect.Effect<boolean, never>
  
  /**
   * Get device RTP capabilities (after loading)
   */
  readonly getDeviceRtpCapabilities: (device: Device) => Effect.Effect<types.RtpCapabilities, DeviceError>
  
  /**
   * Validate device state
   */
  readonly validateDevice: (device: Device) => Effect.Effect<void, DeviceError>
}

/**
 * Device Service Implementation
 */
class MediaSoupDeviceServiceImpl implements MediaSoupDeviceService {
  
  /**
   * Create new MediaSoup device
   */
  createDevice = (): Effect.Effect<Device, DeviceError> =>
    pipe(
      Effect.tryPromise({
        try: async () => {
          try {
            const device = new Device()
            console.info('🔧 Creating MediaSoup Device', {
              handler_name: device.handlerName,
              handler_factory: device.constructor.name
            })
            return device
          } catch (error) {
            if ((error as Error).name === 'UnsupportedError') {
              throw new DeviceUnsupportedError('Browser does not support WebRTC')
            }
            throw error
          }
        },
        catch: (error) => new DeviceError(
          error instanceof DeviceError ? error.message : `Failed to create device: ${error}`,
          error
        )
      }),
      Effect.tap(() => Effect.logInfo('MediaSoup device created successfully'))
    )

  /**
   * Load device with router capabilities
   */
  loadDevice = (device: Device, routerRtpCapabilities: types.RtpCapabilities): Effect.Effect<void, DeviceLoadError> =>
    pipe(
      Effect.tryPromise({
        try: async () => {
          // Log router capabilities before device loading
          console.info('📡 Loading device with router RTP capabilities', {
            router_capabilities: routerRtpCapabilities,
            codec_count: routerRtpCapabilities.codecs?.length || 0,
            header_extensions_count: routerRtpCapabilities.headerExtensions?.length || 0,
            device_state: {
              loaded: device.loaded,
              handler_name: device.handlerName || 'not-detected'
            }
          })

          // Check browser permissions before device loading to avoid deadlocks
          await this.checkBrowserCapabilities()

          try {
            // Load device with router capabilities
            console.info('🔄 Calling device.load() with router capabilities...')
            await device.load({ routerRtpCapabilities })
            console.info('✅ device.load() completed successfully')
          } catch (loadError) {
            // Enhanced error logging for device loading failures
            // IMPORTANT: Don't access device properties when device loading failed
            console.error('❌ device.load() failed:', {
              error_name: loadError instanceof Error ? loadError.name : 'Unknown',
              error_message: loadError instanceof Error ? loadError.message : String(loadError),
              error_stack: loadError instanceof Error ? loadError.stack : undefined,
              device_state_before_load: {
                handler_name: device.handlerName,
                loaded_before: false // Device is never loaded before load() call
              },
              router_capabilities_summary: {
                codec_count: routerRtpCapabilities.codecs?.length || 0,
                first_codec: routerRtpCapabilities.codecs?.[0]?.mimeType || 'none',
                header_ext_count: routerRtpCapabilities.headerExtensions?.length || 0
              },
              browser_info: {
                user_agent: navigator.userAgent,
                webrtc_support: 'RTCPeerConnection' in window,
                media_devices_support: 'mediaDevices' in navigator
              }
            })
            
            // Re-throw with enhanced context - don't access device.rtpCapabilities here
            if (loadError instanceof Error) {
              throw new Error(`MediaSoup device.load() failed: ${loadError.name}: ${loadError.message}`)
            }
            throw loadError
          }

          // Only access device properties after successful loading
          if (!device.loaded) {
            throw new Error('Device.load() completed but device.loaded is false')
          }

          // Log successful device loading with capabilities
          console.info('✅ MediaSoup Device loaded successfully', {
            handler_name: device.handlerName,
            device_loaded: device.loaded,
            can_produce_audio: device.canProduce('audio'),
            can_produce_video: device.canProduce('video'),
            device_rtp_capabilities: device.rtpCapabilities,
            effective_codec_count: device.rtpCapabilities.codecs?.length || 0
          })
        },
        catch: (error) => {
          // Enhanced error context for Effect error handling
          const errorMessage = error instanceof Error ? error.message : String(error)
          const errorName = error instanceof Error ? error.name : 'UnknownError'
          
          console.error('❌ Device loading failed in Effect wrapper:', {
            error_name: errorName,
            error_message: errorMessage,
            error_cause: error
          })
          
          return new DeviceLoadError(
            `Failed to load MediaSoup device: ${errorName}: ${errorMessage}`,
            error
          )
        }
      }),
      Effect.tap(() => Effect.logInfo('Device loaded with router capabilities'))
    )

  /**
   * Check browser capabilities without triggering permission requests that could deadlock
   */
  private checkBrowserCapabilities = async (): Promise<void> => {
    console.info('🔍 Checking browser capabilities before device loading...')
    
    // Check basic WebRTC support
    if (!('RTCPeerConnection' in window)) {
      throw new Error('Browser does not support WebRTC (RTCPeerConnection not available)')
    }
    
    if (!('mediaDevices' in navigator)) {
      throw new Error('Browser does not support MediaDevices API')
    }
    
    if (!('getUserMedia' in navigator.mediaDevices)) {
      throw new Error('Browser does not support getUserMedia')
    }
    
    // Smart permission check - only query if browser supports it and won't deadlock
    try {
      if ('permissions' in navigator && 'query' in navigator.permissions) {
        console.info('🔍 Checking microphone permission status...')
        const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName })
        console.info('🎤 Microphone permission status:', {
          state: permissionStatus.state,
          supported: true
        })
        
        // Only warn if explicitly denied - 'prompt' state is fine for MediaSoup
        if (permissionStatus.state === 'denied') {
          console.warn('⚠️ Microphone permission denied - device loading may fail')
          // Don't throw here - let MediaSoup handle permission request during device.load()
        }
      } else {
        console.info('📋 Permission API not supported - will rely on MediaSoup permission handling')
      }
    } catch (permissionError) {
      // Permission query failed - just log and continue
      console.warn('⚠️ Permission check failed (non-fatal):', permissionError)
    }
    
    console.info('✅ Browser capabilities check completed')
  }

  /**
   * Check if device can produce audio
   */
  canProduceAudio = (device: Device): Effect.Effect<boolean, DeviceError> =>
    pipe(
      Effect.sync(() => {
        if (!device.loaded) {
          throw new DeviceError('Device not loaded')
        }
        return device.canProduce('audio')
      }),
      Effect.tap(canProduce =>
        Effect.logDebug(`Device can produce audio: ${canProduce}`)
      )
    )

  /**
   * Check if device can produce video
   */
  canProduceVideo = (device: Device): Effect.Effect<boolean, DeviceError> =>
    pipe(
      Effect.sync(() => {
        if (!device.loaded) {
          throw new DeviceError('Device not loaded')
        }
        return device.canProduce('video')
      }),
      Effect.tap(canProduce =>
        Effect.logDebug(`Device can produce video: ${canProduce}`)
      )
    )

  /**
   * Check if device can consume media
   */
  canConsume = (device: Device, _rtpParameters: types.RtpParameters): Effect.Effect<boolean, DeviceError> =>
    pipe(
      Effect.sync(() => {
        if (!device.loaded) {
          throw new DeviceError('Device not loaded')
        }
        // Note: Device.canConsume method may not be available in all mediasoup-client versions
        // For now, return true if device is loaded and has capabilities
        return device.loaded && !!device.rtpCapabilities
      }),
      Effect.tap(canConsume =>
        Effect.logDebug(`Device can consume: ${canConsume}`)
      )
    )

  /**
   * Get device information
   */
  getDeviceInfo = (device: Device): Effect.Effect<DeviceInfo, DeviceError> =>
    pipe(
      Effect.all({
        canProduceAudio: this.canProduceAudio(device).pipe(
          Effect.catchAll(() => Effect.succeed(false))
        ),
        canProduceVideo: this.canProduceVideo(device).pipe(
          Effect.catchAll(() => Effect.succeed(false))
        )
      }),
      Effect.map(({ canProduceAudio, canProduceVideo }) => ({
        loaded: device.loaded,
        handlerName: device.handlerName,
        canProduceAudio,
        canProduceVideo,
        rtpCapabilities: device.loaded ? Option.some(device.rtpCapabilities) : Option.none()
      }))
    )

  /**
   * Check WebRTC support
   */
  checkWebRTCSupport = (): Effect.Effect<boolean, never> =>
    Effect.sync(() => {
      try {
        new Device()
        return true
      } catch (error) {
        return false
      }
    })

  /**
   * Get device RTP capabilities (after loading)
   */
  getDeviceRtpCapabilities = (device: Device): Effect.Effect<types.RtpCapabilities, DeviceError> =>
    pipe(
      Effect.sync(() => {
        if (!device.loaded) {
          throw new DeviceError('Device not loaded - cannot get RTP capabilities')
        }
        return device.rtpCapabilities
      })
    )

  /**
   * Validate device state
   */
  validateDevice = (device: Device): Effect.Effect<void, DeviceError> =>
    pipe(
      Effect.sync(() => {
        if (!device) {
          throw new DeviceError('Device is null or undefined')
        }
        if (!device.loaded) {
          throw new DeviceError('Device not loaded')
        }
        if (!device.rtpCapabilities) {
          throw new DeviceError('Device has no RTP capabilities')
        }
        if (!device.handlerName) {
          throw new DeviceError('Device has no handler name')
        }
      })
    )
}

/**
 * Service Context and Layer
 */
export const MediaSoupDeviceService = Context.GenericTag<MediaSoupDeviceService>('MediaSoupDeviceService')

export const MediaSoupDeviceServiceLive = Layer.succeed(
  MediaSoupDeviceService,
  new MediaSoupDeviceServiceImpl()
)

/**
 * Helper functions for working with device service
 */

/**
 * Create and load device in one operation
 */
export const createAndLoadDevice = (routerRtpCapabilities: types.RtpCapabilities): Effect.Effect<Device, DeviceError, never> =>
  pipe(
    MediaSoupDeviceService,
    Effect.andThen(service => 
      pipe(
        service.createDevice(),
        Effect.andThen(device => 
          pipe(
            service.loadDevice(device, routerRtpCapabilities),
            Effect.andThen(() => Effect.succeed(device))
          )
        )
      )
    ),
    Effect.provide(MediaSoupDeviceServiceLive)
  )

/**
 * Check comprehensive device capabilities
 */
export const checkDeviceCapabilities = (device: Device): Effect.Effect<{
  audio: boolean
  video: boolean
  info: DeviceInfo
}, DeviceError, never> =>
  pipe(
    MediaSoupDeviceService,
    Effect.andThen(service =>
      pipe(
        Effect.all({
          audio: service.canProduceAudio(device),
          video: service.canProduceVideo(device),
          info: service.getDeviceInfo(device)
        })
      )
    ),
    Effect.provide(MediaSoupDeviceServiceLive)
  )

/**
 * Validate and get device capabilities
 */
export const validateAndGetCapabilities = (device: Device): Effect.Effect<types.RtpCapabilities, DeviceError, never> =>
  pipe(
    MediaSoupDeviceService,
    Effect.andThen(service =>
      pipe(
        service.validateDevice(device),
        Effect.andThen(() => service.getDeviceRtpCapabilities(device))
      )
    ),
    Effect.provide(MediaSoupDeviceServiceLive)
  )