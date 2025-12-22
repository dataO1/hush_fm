/**
 * Stream Domain Service
 * 
 * Pure business logic for audio streaming.
 * Stateless functions that contain stream-related business rules and validations.
 * No side effects, no API calls, no store updates.
 * 
 * Responsibilities:
 * - Audio stream validation
 * - Stream quality determination
 * - Bitrate calculations
 * - Stream health assessment
 * - Streaming capability checks
 */

import { pipe } from 'effect'
import { types, Device } from 'mediasoup-client'

/**
 * Stream quality levels
 */
export type StreamQuality = 'low' | 'medium' | 'high' | 'auto'

/**
 * Stream status types
 */
export type StreamStatus = 'idle' | 'starting' | 'streaming' | 'paused' | 'error' | 'stopped'

/**
 * Audio format configuration
 */
export interface AudioFormat {
  sampleRate: number
  channelCount: number
  bitDepth?: number
  codec?: string
}

/**
 * Stream constraints
 */
export interface StreamConstraints {
  quality: StreamQuality
  maxBitrate?: number
  echoCancellation: boolean
  noiseSuppression: boolean
  autoGainControl: boolean
}

/**
 * Stream health metrics
 */
export interface StreamHealth {
  status: 'excellent' | 'good' | 'fair' | 'poor' | 'critical'
  score: number // 0-100
  issues: string[]
  recommendations: string[]
}

/**
 * Stream validation result
 */
export interface StreamValidationResult {
  canStream: boolean
  issues: string[]
  requirements: string[]
}

/**
 * Stream business rules constants
 */
export const STREAM_BUSINESS_RULES = {
  MIN_SAMPLE_RATE: 16000, // 16kHz minimum
  PREFERRED_SAMPLE_RATE: 48000, // 48kHz preferred
  MAX_SAMPLE_RATE: 96000, // 96kHz maximum
  
  MIN_BITRATE: 32000, // 32kbps minimum
  DEFAULT_BITRATE: 128000, // 128kbps default
  MAX_BITRATE: 320000, // 320kbps maximum
  
  MIN_CHANNEL_COUNT: 1,
  MAX_CHANNEL_COUNT: 2,
  
  MAX_STREAM_DURATION: 8 * 60 * 60 * 1000, // 8 hours
  HEALTH_CHECK_INTERVAL: 30000, // 30 seconds
  
  QUALITY_THRESHOLDS: {
    bitrate: {
      low: 64000,
      medium: 128000,
      high: 256000
    },
    sampleRate: {
      low: 22050,
      medium: 44100,
      high: 48000
    }
  }
} as const

/**
 * Stream Domain Service
 * 
 * All methods are pure functions that return validation/calculation results.
 * No external dependencies or side effects.
 */
export class Stream {
  /**
   * Validate audio track for streaming
   */
  static validateAudioTrack(track: MediaStreamTrack): StreamValidationResult {
    const issues: string[] = []
    const requirements: string[] = []

    // Check track readiness
    if (track.readyState !== 'live') {
      issues.push('Audio track is not live')
      requirements.push('Audio track must be in live state')
    }

    // Check track kind
    if (track.kind !== 'audio') {
      issues.push('Track is not an audio track')
      requirements.push('Only audio tracks are supported for streaming')
    }

    // Check if track is enabled
    if (!track.enabled) {
      issues.push('Audio track is disabled')
      requirements.push('Audio track must be enabled')
    }

    // Check if track is muted
    if (track.muted) {
      issues.push('Audio track is muted')
      requirements.push('Audio track must not be muted')
    }

    // Validate track settings
    const settings = track.getSettings()
    if (settings.sampleRate && settings.sampleRate < STREAM_BUSINESS_RULES.MIN_SAMPLE_RATE) {
      issues.push(`Sample rate too low: ${settings.sampleRate}Hz`)
      requirements.push(`Sample rate must be at least ${STREAM_BUSINESS_RULES.MIN_SAMPLE_RATE}Hz`)
    }

    if (settings.channelCount && settings.channelCount > STREAM_BUSINESS_RULES.MAX_CHANNEL_COUNT) {
      issues.push(`Too many channels: ${settings.channelCount}`)
      requirements.push(`Channel count must not exceed ${STREAM_BUSINESS_RULES.MAX_CHANNEL_COUNT}`)
    }

    return {
      canStream: issues.length === 0,
      issues,
      requirements
    }
  }

  /**
   * Determine optimal stream quality based on constraints
   */
  static determineOptimalQuality(
    listenerCount: number,
    networkCondition: 'excellent' | 'good' | 'fair' | 'poor',
    deviceCapability: 'high' | 'medium' | 'low'
  ): StreamQuality {
    // Business rule: balance quality with performance
    
    // High listener count = reduce quality to ensure stability
    if (listenerCount > 100) {
      return 'low'
    }
    
    if (listenerCount > 50) {
      return networkCondition === 'excellent' ? 'medium' : 'low'
    }
    
    // Consider network conditions
    if (networkCondition === 'poor') {
      return 'low'
    }
    
    if (networkCondition === 'fair') {
      return deviceCapability === 'high' ? 'medium' : 'low'
    }
    
    // Good network + small audience = high quality possible
    if (networkCondition === 'excellent' && deviceCapability === 'high') {
      return 'high'
    }
    
    return 'medium' // Safe default
  }

  /**
   * Calculate optimal bitrate for quality level
   */
  static calculateBitrate(quality: StreamQuality, listenerCount: number = 1): number {
    const baseBitrates = {
      low: STREAM_BUSINESS_RULES.QUALITY_THRESHOLDS.bitrate.low,
      medium: STREAM_BUSINESS_RULES.QUALITY_THRESHOLDS.bitrate.medium,
      high: STREAM_BUSINESS_RULES.QUALITY_THRESHOLDS.bitrate.high,
      auto: STREAM_BUSINESS_RULES.DEFAULT_BITRATE
    }
    
    let bitrate = baseBitrates[quality]
    
    // Business rule: reduce bitrate for many listeners to prevent overload
    if (listenerCount > 50) {
      const reducedBitrate = Math.max(
        Math.round(bitrate * 0.7), // 30% reduction
        STREAM_BUSINESS_RULES.MIN_BITRATE
      )
      // Map to closest valid bitrate
      if (reducedBitrate <= 64000) bitrate = 64000
      else if (reducedBitrate <= 128000) bitrate = 128000
      else bitrate = 256000
    }
    
    const finalBitrate = Math.min(bitrate, STREAM_BUSINESS_RULES.MAX_BITRATE)
    // Ensure return value matches expected literal types
    if (finalBitrate <= 64000) return 64000
    if (finalBitrate <= 128000) return 128000
    return 256000
  }

  /**
   * Validate stream constraints
   */
  static validateConstraints(constraints: StreamConstraints): StreamValidationResult {
    const issues: string[] = []
    const requirements: string[] = []

    // Validate bitrate if specified
    if (constraints.maxBitrate) {
      if (constraints.maxBitrate < STREAM_BUSINESS_RULES.MIN_BITRATE) {
        issues.push(`Bitrate too low: ${constraints.maxBitrate}`)
        requirements.push(`Bitrate must be at least ${STREAM_BUSINESS_RULES.MIN_BITRATE}`)
      }
      
      if (constraints.maxBitrate > STREAM_BUSINESS_RULES.MAX_BITRATE) {
        issues.push(`Bitrate too high: ${constraints.maxBitrate}`)
        requirements.push(`Bitrate must not exceed ${STREAM_BUSINESS_RULES.MAX_BITRATE}`)
      }
    }

    // Validate quality level
    if (!['low', 'medium', 'high', 'auto'].includes(constraints.quality)) {
      issues.push('Invalid quality level')
      requirements.push('Quality must be one of: low, medium, high, auto')
    }

    return {
      canStream: issues.length === 0,
      issues,
      requirements
    }
  }

  /**
   * Check if device can start streaming
   */
  static canStartStream(
    device: Device | null,
    audioTrack: MediaStreamTrack | null,
    producer: types.Producer | null = null
  ): boolean {
    // Device must be loaded
    if (!device || !device.loaded) {
      return false
    }
    
    // Must have audio track
    if (!audioTrack) {
      return false
    }
    
    // Audio track must be valid
    const trackValidation = this.validateAudioTrack(audioTrack)
    if (!trackValidation.canStream) {
      return false
    }
    
    // Device must support audio production
    if (!device.canProduce('audio')) {
      return false
    }
    
    // Must not already have an active producer
    if (producer && !producer.closed) {
      return false
    }
    
    return true
  }

  /**
   * Determine stream status from producer state
   */
  static determineStreamStatus(
    producer: types.Producer | null,
    audioTrack: MediaStreamTrack | null
  ): StreamStatus {
    if (!producer || producer.closed) {
      return audioTrack ? 'idle' : 'stopped'
    }
    
    if (producer.paused) {
      return 'paused'
    }
    
    // Check if track is still live
    if (audioTrack && audioTrack.readyState !== 'live') {
      return 'error'
    }
    
    return 'streaming'
  }

  /**
   * Assess stream health based on metrics
   */
  static assessStreamHealth(metrics: {
    bitrate?: number
    packetLoss?: number
    jitter?: number
    rtt?: number
    audioLevel?: number
  }): StreamHealth {
    let score = 100
    const issues: string[] = []
    const recommendations: string[] = []

    // Check bitrate
    if (metrics.bitrate) {
      if (metrics.bitrate < STREAM_BUSINESS_RULES.MIN_BITRATE) {
        score -= 30
        issues.push('Very low bitrate detected')
        recommendations.push('Check network connection')
      } else if (metrics.bitrate < STREAM_BUSINESS_RULES.DEFAULT_BITRATE) {
        score -= 15
        issues.push('Low bitrate detected')
        recommendations.push('Consider reducing stream quality')
      }
    }

    // Check packet loss
    if (metrics.packetLoss !== undefined) {
      if (metrics.packetLoss > 5) {
        score -= 40
        issues.push('High packet loss detected')
        recommendations.push('Check network stability')
      } else if (metrics.packetLoss > 1) {
        score -= 20
        issues.push('Moderate packet loss detected')
        recommendations.push('Monitor network conditions')
      }
    }

    // Check jitter
    if (metrics.jitter !== undefined) {
      if (metrics.jitter > 50) {
        score -= 25
        issues.push('High network jitter')
        recommendations.push('Improve network conditions')
      }
    }

    // Check RTT (Round Trip Time)
    if (metrics.rtt !== undefined) {
      if (metrics.rtt > 200) {
        score -= 20
        issues.push('High latency detected')
        recommendations.push('Check network latency')
      }
    }

    // Check audio level
    if (metrics.audioLevel !== undefined) {
      if (metrics.audioLevel < 0.1) {
        score -= 15
        issues.push('Very low audio level')
        recommendations.push('Increase microphone gain')
      }
    }

    // Determine overall status
    let status: StreamHealth['status']
    if (score >= 90) status = 'excellent'
    else if (score >= 75) status = 'good'
    else if (score >= 60) status = 'fair'
    else if (score >= 40) status = 'poor'
    else status = 'critical'

    return {
      status,
      score: Math.max(0, score),
      issues,
      recommendations
    }
  }

  /**
   * Calculate stream duration limit based on usage
   */
  static calculateStreamDurationLimit(
    userType: 'free' | 'premium',
    concurrentStreams: number
  ): number {
    const baseLimit = STREAM_BUSINESS_RULES.MAX_STREAM_DURATION
    
    if (userType === 'premium') {
      return baseLimit // Full duration for premium users
    }
    
    // Free users have reduced limits with concurrent streams
    const reductionFactor = Math.min(concurrentStreams * 0.5, 0.8)
    return Math.floor(baseLimit * (1 - reductionFactor))
  }

  /**
   * Validate audio format compatibility
   */
  static validateAudioFormat(format: AudioFormat): StreamValidationResult {
    const issues: string[] = []
    const requirements: string[] = []

    // Validate sample rate
    if (format.sampleRate < STREAM_BUSINESS_RULES.MIN_SAMPLE_RATE) {
      issues.push(`Sample rate too low: ${format.sampleRate}Hz`)
      requirements.push(`Minimum sample rate: ${STREAM_BUSINESS_RULES.MIN_SAMPLE_RATE}Hz`)
    }
    
    if (format.sampleRate > STREAM_BUSINESS_RULES.MAX_SAMPLE_RATE) {
      issues.push(`Sample rate too high: ${format.sampleRate}Hz`)
      requirements.push(`Maximum sample rate: ${STREAM_BUSINESS_RULES.MAX_SAMPLE_RATE}Hz`)
    }

    // Validate channel count
    if (format.channelCount < STREAM_BUSINESS_RULES.MIN_CHANNEL_COUNT) {
      issues.push('Invalid channel count: must be at least 1')
      requirements.push('Mono or stereo audio required')
    }
    
    if (format.channelCount > STREAM_BUSINESS_RULES.MAX_CHANNEL_COUNT) {
      issues.push('Too many channels: maximum 2 supported')
      requirements.push('Only mono or stereo audio supported')
    }

    // Validate bit depth if specified
    if (format.bitDepth && ![16, 24, 32].includes(format.bitDepth)) {
      issues.push(`Unsupported bit depth: ${format.bitDepth}`)
      requirements.push('Supported bit depths: 16, 24, or 32 bits')
    }

    return {
      canStream: issues.length === 0,
      issues,
      requirements
    }
  }
}