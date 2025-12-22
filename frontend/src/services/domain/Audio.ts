/**
 * Audio Domain Service
 * 
 * Pure business logic for audio processing and validation.
 * Stateless functions that contain audio-related business rules and validations.
 * No side effects, no API calls, no store updates.
 * 
 * Responsibilities:
 * - Audio track validation
 * - Audio level processing
 * - Audio format validation
 * - Audio device compatibility
 * - Audio quality assessment
 */


/**
 * Audio level metrics
 */
export interface AudioLevel {
  peak: number // 0-1 scale
  rms: number // Root mean square
  average: number // Recent average
  clipping: boolean // Whether audio is clipping
}

/**
 * Audio device information
 */
export interface AudioDeviceInfo {
  deviceId: string
  label: string
  kind: MediaDeviceKind
  capabilities?: MediaTrackCapabilities
}

/**
 * Audio validation result
 */
export interface AudioValidationResult {
  isValid: boolean
  canUse: boolean
  issues: string[]
  recommendations: string[]
}

/**
 * Audio quality assessment
 */
export interface AudioQuality {
  level: 'excellent' | 'good' | 'fair' | 'poor' | 'silent'
  score: number // 0-100
  characteristics: {
    volume: 'silent' | 'quiet' | 'normal' | 'loud' | 'clipping'
    consistency: 'stable' | 'variable' | 'unstable'
    noise: 'none' | 'low' | 'moderate' | 'high'
  }
  recommendations: string[]
}

/**
 * Audio processing settings
 */
export interface AudioProcessingSettings {
  echoCancellation: boolean
  noiseSuppression: boolean
  autoGainControl: boolean
  voiceActivityDetection?: boolean
  sampleRate: 16000 | 22050 | 44100 | 48000 | 96000
  channelCount: number
}

/**
 * Audio business rules constants
 */
export const AUDIO_BUSINESS_RULES = {
  LEVELS: {
    silent: 0.001,
    quiet: 0.1,
    normal: 0.3,
    loud: 0.8,
    clipping: 0.95
  },
  
  SAMPLE_RATES: {
    minimum: 16000,
    recommended: 48000,
    maximum: 96000,
    standard: [16000, 22050, 44100, 48000, 96000] as const
  },
  
  QUALITY_THRESHOLDS: {
    excellent: { minLevel: 0.2, maxLevel: 0.8, consistency: 0.9 },
    good: { minLevel: 0.15, maxLevel: 0.85, consistency: 0.7 },
    fair: { minLevel: 0.1, maxLevel: 0.9, consistency: 0.5 },
    poor: { minLevel: 0.05, maxLevel: 0.95, consistency: 0.3 }
  },
  
  ANALYSIS_WINDOW: 1000, // 1 second for quality analysis
  SILENCE_THRESHOLD: 0.01,
  CLIPPING_THRESHOLD: 0.98,
  
  CONSTRAINTS: {
    defaultEchoCancellation: true,
    defaultNoiseSuppression: true,
    defaultAutoGainControl: true,
    preferredChannelCount: 1, // Mono for streaming efficiency
    fallbackChannelCount: 2 // Stereo fallback
  }
} as const

/**
 * Audio Domain Service
 * 
 * All methods are pure functions that return validation/calculation results.
 * No external dependencies or side effects.
 */
export class Audio {
  /**
   * Validate audio track for streaming use
   */
  static validateTrack(track: MediaStreamTrack): AudioValidationResult {
    const issues: string[] = []
    const recommendations: string[] = []

    // Basic track validation
    if (track.kind !== 'audio') {
      issues.push('Track is not an audio track')
      return { isValid: false, canUse: false, issues, recommendations }
    }

    if (track.readyState !== 'live') {
      issues.push('Audio track is not live')
      recommendations.push('Restart audio capture')
    }

    if (track.muted) {
      issues.push('Audio track is muted')
      recommendations.push('Unmute microphone')
    }

    if (!track.enabled) {
      issues.push('Audio track is disabled')
      recommendations.push('Enable audio track')
    }

    // Validate track settings
    const settings = track.getSettings()
    const validation = this.validateTrackSettings(settings)
    if (!validation.isValid) {
      issues.push(...validation.issues)
      recommendations.push(...validation.recommendations)
    }

    return {
      isValid: issues.length === 0,
      canUse: track.readyState === 'live' && !track.muted && track.enabled,
      issues,
      recommendations
    }
  }

  /**
   * Validate audio track settings
   */
  static validateTrackSettings(settings: MediaTrackSettings): AudioValidationResult {
    const issues: string[] = []
    const recommendations: string[] = []

    // Validate sample rate
    if (settings.sampleRate) {
      if (settings.sampleRate < AUDIO_BUSINESS_RULES.SAMPLE_RATES.minimum) {
        issues.push(`Sample rate too low: ${settings.sampleRate}Hz`)
        recommendations.push(`Use minimum ${AUDIO_BUSINESS_RULES.SAMPLE_RATES.minimum}Hz`)
      }
      
      if (settings.sampleRate > AUDIO_BUSINESS_RULES.SAMPLE_RATES.maximum) {
        issues.push(`Sample rate too high: ${settings.sampleRate}Hz`)
        recommendations.push(`Use maximum ${AUDIO_BUSINESS_RULES.SAMPLE_RATES.maximum}Hz`)
      }
      
      if (!(AUDIO_BUSINESS_RULES.SAMPLE_RATES.standard as readonly number[]).includes(settings.sampleRate)) {
        recommendations.push('Consider using standard sample rate for better compatibility')
      }
    }

    // Validate channel count
    if (settings.channelCount) {
      if (settings.channelCount < 1) {
        issues.push('Invalid channel count: must be at least 1')
      }
      
      if (settings.channelCount > 2) {
        issues.push('Too many channels: maximum 2 supported for streaming')
        recommendations.push('Use mono or stereo audio')
      }
    }

    return {
      isValid: issues.length === 0,
      canUse: true,
      issues,
      recommendations
    }
  }

  /**
   * Calculate audio level from samples
   */
  static calculateAudioLevel(samples: Float32Array): AudioLevel {
    let peak = 0
    let sum = 0
    let clipping = false

    for (let i = 0; i < samples.length; i++) {
      const abs = Math.abs(samples[i])
      peak = Math.max(peak, abs)
      sum += abs * abs
      
      if (abs >= AUDIO_BUSINESS_RULES.CLIPPING_THRESHOLD) {
        clipping = true
      }
    }

    const rms = Math.sqrt(sum / samples.length)
    const average = sum / samples.length

    return { peak, rms, average, clipping }
  }

  /**
   * Assess audio quality from level history
   */
  static assessAudioQuality(levelHistory: AudioLevel[]): AudioQuality {
    if (levelHistory.length === 0) {
      return {
        level: 'silent',
        score: 0,
        characteristics: {
          volume: 'silent',
          consistency: 'stable',
          noise: 'none'
        },
        recommendations: ['Start audio input']
      }
    }

    const recent = levelHistory.slice(-10) // Last 10 samples
    const avgLevel = recent.reduce((sum, level) => sum + level.average, 0) / recent.length
    const peakLevel = Math.max(...recent.map(l => l.peak))
    const hasClipping = recent.some(l => l.clipping)

    // Calculate consistency (standard deviation)
    const variance = recent.reduce((sum, level) => 
      sum + Math.pow(level.average - avgLevel, 2), 0) / recent.length
    const consistency = Math.max(0, 1 - Math.sqrt(variance))

    // Determine volume level
    const volume = this.determineVolumeLevel(avgLevel, peakLevel, hasClipping)
    
    // Assess consistency
    const consistencyLevel = consistency > 0.8 ? 'stable' : 
                           consistency > 0.5 ? 'variable' : 'unstable'
    
    // Assess noise (simplified - based on variance and baseline)
    const noiseLevel = variance > 0.1 ? 'high' : 
                      variance > 0.05 ? 'moderate' : 
                      variance > 0.01 ? 'low' : 'none'

    // Calculate overall score
    let score = 100
    
    // Volume penalties
    if (volume === 'silent') score = 0
    else if (volume === 'quiet') score -= 30
    else if (volume === 'loud') score -= 15
    else if (volume === 'clipping') score -= 40

    // Consistency bonus/penalty
    score += (consistency - 0.5) * 40

    // Noise penalty
    if (noiseLevel === 'high') score -= 25
    else if (noiseLevel === 'moderate') score -= 15
    else if (noiseLevel === 'low') score -= 5

    score = Math.max(0, Math.min(100, score))

    // Determine overall level
    const level = score >= 80 ? 'excellent' :
                  score >= 65 ? 'good' :
                  score >= 45 ? 'fair' :
                  score > 0 ? 'poor' : 'silent'

    // Generate recommendations
    const recommendations = this.generateAudioRecommendations(volume, consistencyLevel, noiseLevel)

    return {
      level,
      score,
      characteristics: {
        volume,
        consistency: consistencyLevel,
        noise: noiseLevel
      },
      recommendations
    }
  }

  /**
   * Determine volume level classification
   */
  private static determineVolumeLevel(
    average: number, 
    peak: number, 
    hasClipping: boolean
  ): AudioQuality['characteristics']['volume'] {
    if (hasClipping || peak >= AUDIO_BUSINESS_RULES.LEVELS.clipping) {
      return 'clipping'
    }
    
    if (average >= AUDIO_BUSINESS_RULES.LEVELS.loud) {
      return 'loud'
    }
    
    if (average >= AUDIO_BUSINESS_RULES.LEVELS.normal) {
      return 'normal'
    }
    
    if (average >= AUDIO_BUSINESS_RULES.LEVELS.quiet) {
      return 'quiet'
    }
    
    return 'silent'
  }

  /**
   * Generate audio recommendations based on characteristics
   */
  private static generateAudioRecommendations(
    volume: AudioQuality['characteristics']['volume'],
    consistency: AudioQuality['characteristics']['consistency'],
    noise: AudioQuality['characteristics']['noise']
  ): string[] {
    const recommendations: string[] = []

    // Volume recommendations
    switch (volume) {
      case 'silent':
        recommendations.push('Check microphone connection and permissions')
        recommendations.push('Increase microphone gain or speak closer to microphone')
        break
      case 'quiet':
        recommendations.push('Increase microphone gain or speak louder')
        break
      case 'loud':
        recommendations.push('Reduce microphone gain to prevent distortion')
        break
      case 'clipping':
        recommendations.push('Reduce microphone gain immediately - audio is distorting')
        recommendations.push('Move further from microphone or speak quieter')
        break
    }

    // Consistency recommendations
    if (consistency === 'unstable') {
      recommendations.push('Maintain consistent distance from microphone')
      recommendations.push('Speak at consistent volume')
    } else if (consistency === 'variable') {
      recommendations.push('Try to maintain more consistent audio levels')
    }

    // Noise recommendations
    switch (noise) {
      case 'high':
        recommendations.push('Enable noise suppression')
        recommendations.push('Reduce background noise in environment')
        break
      case 'moderate':
        recommendations.push('Consider enabling noise suppression')
        break
      case 'low':
        recommendations.push('Consider using a better microphone or quieter environment')
        break
    }

    return recommendations
  }

  /**
   * Validate audio processing settings
   */
  static validateProcessingSettings(settings: AudioProcessingSettings): AudioValidationResult {
    const issues: string[] = []
    const recommendations: string[] = []

    // Validate sample rate
    if (!AUDIO_BUSINESS_RULES.SAMPLE_RATES.standard.includes(settings.sampleRate)) {
      issues.push(`Non-standard sample rate: ${settings.sampleRate}Hz`)
      recommendations.push(`Use standard sample rate: ${AUDIO_BUSINESS_RULES.SAMPLE_RATES.recommended}Hz`)
    }

    // Validate channel count
    if (settings.channelCount < 1 || settings.channelCount > 2) {
      issues.push(`Invalid channel count: ${settings.channelCount}`)
      recommendations.push('Use 1 (mono) or 2 (stereo) channels')
    }

    // Recommendations for processing options
    if (!settings.echoCancellation) {
      recommendations.push('Consider enabling echo cancellation for better quality')
    }

    if (!settings.noiseSuppression) {
      recommendations.push('Consider enabling noise suppression for cleaner audio')
    }

    if (!settings.autoGainControl) {
      recommendations.push('Consider enabling auto gain control for consistent levels')
    }

    return {
      isValid: issues.length === 0,
      canUse: true,
      issues,
      recommendations
    }
  }

  /**
   * Generate optimal audio constraints for device
   */
  static generateOptimalConstraints(
    preferredDeviceId?: string,
    quality: 'low' | 'medium' | 'high' = 'medium'
  ): MediaStreamConstraints {
    const qualitySettings = {
      low: {
        sampleRate: 22050,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      medium: {
        sampleRate: 44100,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      high: {
        sampleRate: 48000,
        channelCount: 2,
        echoCancellation: false, // Preserve audio quality for high-end
        noiseSuppression: false,
        autoGainControl: false
      }
    }

    const settings = qualitySettings[quality]

    return {
      audio: {
        deviceId: preferredDeviceId ? { exact: preferredDeviceId } : undefined,
        sampleRate: { ideal: settings.sampleRate },
        channelCount: { ideal: settings.channelCount },
        echoCancellation: { ideal: settings.echoCancellation },
        noiseSuppression: { ideal: settings.noiseSuppression },
        autoGainControl: { ideal: settings.autoGainControl }
      },
      video: false
    }
  }

  /**
   * Check if audio is silent (no meaningful input)
   */
  static isSilent(level: AudioLevel): boolean {
    return level.average < AUDIO_BUSINESS_RULES.SILENCE_THRESHOLD &&
           level.peak < AUDIO_BUSINESS_RULES.SILENCE_THRESHOLD * 2
  }

  /**
   * Check if audio is clipping/distorting
   */
  static isClipping(level: AudioLevel): boolean {
    return level.clipping || level.peak >= AUDIO_BUSINESS_RULES.CLIPPING_THRESHOLD
  }

  /**
   * Calculate gain adjustment recommendation
   */
  static calculateGainAdjustment(currentLevel: number, targetLevel: number = 0.5): number {
    if (currentLevel <= 0) return 1 // No adjustment possible for silent audio
    
    const ratio = targetLevel / currentLevel
    
    // Limit gain adjustments to reasonable range
    return Math.max(0.1, Math.min(10.0, ratio))
  }

  /**
   * Determine if audio device is suitable for streaming
   */
  static isDeviceSuitable(device: AudioDeviceInfo): AudioValidationResult {
    const issues: string[] = []
    const recommendations: string[] = []

    if (device.kind !== 'audioinput') {
      issues.push('Device is not an audio input device')
      return { isValid: false, canUse: false, issues, recommendations }
    }

    if (!device.label || device.label.includes('default')) {
      recommendations.push('Consider using a dedicated microphone for better quality')
    }

    // Check capabilities if available
    if (device.capabilities) {
      const caps = device.capabilities

      if (caps.sampleRate) {
        // Note: Removed unused minRate variable - not needed for current validation
        const maxRate = Array.isArray(caps.sampleRate) ? caps.sampleRate[1] : caps.sampleRate.max || Infinity

        if (maxRate < AUDIO_BUSINESS_RULES.SAMPLE_RATES.recommended) {
          issues.push('Device does not support recommended sample rate')
          recommendations.push('Consider upgrading audio device')
        }
      }

      if (caps.channelCount) {
        const maxChannels = Array.isArray(caps.channelCount) ? caps.channelCount[1] : caps.channelCount.max || 0
        
        if (maxChannels < 1) {
          issues.push('Device does not support audio input')
          return { isValid: false, canUse: false, issues, recommendations }
        }
      }
    }

    return {
      isValid: issues.length === 0,
      canUse: true,
      issues,
      recommendations
    }
  }
}