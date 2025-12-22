/**
 * Connection Domain Service
 * 
 * Pure business logic for WebRTC and network connections.
 * Stateless functions that contain connection-related business rules and validations.
 * No side effects, no API calls, no store updates.
 * 
 * Responsibilities:
 * - WebRTC connection validation
 * - Connection state determination
 * - Network quality assessment
 * - Connection retry logic
 * - Transport health evaluation
 */

import { types } from 'mediasoup-client'

/**
 * Connection state types
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'closed'

/**
 * Network quality levels
 */
export type NetworkQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'critical'

/**
 * Connection type
 */
export type ConnectionType = 'webrtc' | 'websocket' | 'http'

/**
 * Connection health metrics
 */
export interface ConnectionHealth {
  quality: NetworkQuality
  score: number // 0-100
  latency: number // ms
  packetLoss: number // percentage
  jitter: number // ms
  bandwidth: number // bps
  stability: 'stable' | 'unstable' | 'critical'
}

/**
 * Connection validation result
 */
export interface ConnectionValidationResult {
  isValid: boolean
  canConnect: boolean
  issues: string[]
  recommendations: string[]
}

/**
 * Retry strategy configuration
 */
export interface RetryStrategy {
  maxAttempts: number
  baseDelay: number // ms
  maxDelay: number // ms
  backoffFactor: number
  jitter: boolean
}

/**
 * Connection business rules constants
 */
export const CONNECTION_BUSINESS_RULES = {
  TIMEOUTS: {
    connection: 15000, // 15 seconds
    transport: 10000, // 10 seconds
    response: 5000, // 5 seconds
    keepalive: 30000 // 30 seconds
  },
  
  THRESHOLDS: {
    latency: {
      excellent: 50, // < 50ms
      good: 100, // < 100ms
      fair: 200, // < 200ms
      poor: 500 // < 500ms
    },
    packetLoss: {
      excellent: 0.1, // < 0.1%
      good: 0.5, // < 0.5%
      fair: 2.0, // < 2.0%
      poor: 5.0 // < 5.0%
    },
    jitter: {
      excellent: 10, // < 10ms
      good: 25, // < 25ms
      fair: 50, // < 50ms
      poor: 100 // < 100ms
    }
  },
  
  RETRY_STRATEGIES: {
    webrtc: {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      backoffFactor: 2,
      jitter: true
    },
    websocket: {
      maxAttempts: 5,
      baseDelay: 500,
      maxDelay: 5000,
      backoffFactor: 1.5,
      jitter: true
    },
    http: {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 8000,
      backoffFactor: 2,
      jitter: false
    }
  },
  
  STABILITY_WINDOW: 60000, // 1 minute for stability assessment
  MIN_SAMPLES_FOR_QUALITY: 5 // minimum samples to determine quality
} as const

/**
 * Connection Domain Service
 * 
 * All methods are pure functions that return validation/calculation results.
 * No external dependencies or side effects.
 */
export class Connection {
  /**
   * Validate WebRTC transport for connection
   */
  static validateTransport(transport: types.Transport | null): ConnectionValidationResult {
    const issues: string[] = []
    const recommendations: string[] = []

    if (!transport) {
      issues.push('Transport not available')
      recommendations.push('Create transport before attempting connection')
      return { isValid: false, canConnect: false, issues, recommendations }
    }

    // Check transport state
    if (transport.closed) {
      issues.push('Transport is closed')
      recommendations.push('Create new transport')
    }

    // Check connection state
    if (transport.connectionState === 'failed') {
      issues.push('Transport connection failed')
      recommendations.push('Retry with new transport')
    }

    if (transport.connectionState === 'disconnected') {
      issues.push('Transport is disconnected')
      recommendations.push('Re-establish transport connection')
    }

    // Note: ICE connection state and DTLS state are not directly accessible on MediaSoup Transport
    // These would need to be tracked separately if needed

    const canConnect = transport.connectionState === 'connected' || 
                      transport.connectionState === 'connecting'

    return {
      isValid: issues.length === 0,
      canConnect,
      issues,
      recommendations
    }
  }

  /**
   * Determine connection state from transport states
   */
  static determineConnectionState(
    transportState: RTCPeerConnectionState,
    iceState: RTCIceConnectionState,
    dtlsState: RTCDtlsTransportState
  ): ConnectionState {
    // Check for failed states first
    if (transportState === 'failed' || iceState === 'failed' || dtlsState === 'failed') {
      return 'failed'
    }

    if (transportState === 'closed' || iceState === 'closed' || dtlsState === 'closed') {
      return 'closed'
    }

    if (transportState === 'disconnected' || iceState === 'disconnected') {
      return 'reconnecting'
    }

    // Check for connecting states
    if (transportState === 'connecting' || iceState === 'checking' || iceState === 'new') {
      return 'connecting'
    }

    // Connected state requires all components to be connected
    if (transportState === 'connected' && 
        (iceState === 'connected' || iceState === 'completed') && 
        dtlsState === 'connected') {
      return 'connected'
    }

    return 'disconnected'
  }

  /**
   * Assess network quality from connection metrics
   */
  static assessNetworkQuality(metrics: {
    latency?: number
    packetLoss?: number
    jitter?: number
    bandwidth?: number
    samples: number
  }): NetworkQuality {
    if (metrics.samples < CONNECTION_BUSINESS_RULES.MIN_SAMPLES_FOR_QUALITY) {
      return 'fair' // Default when insufficient data
    }

    const { THRESHOLDS } = CONNECTION_BUSINESS_RULES

    // Assess each metric
    let qualityScore = 100

    if (metrics.latency !== undefined) {
      if (metrics.latency > THRESHOLDS.latency.poor) qualityScore -= 40
      else if (metrics.latency > THRESHOLDS.latency.fair) qualityScore -= 25
      else if (metrics.latency > THRESHOLDS.latency.good) qualityScore -= 15
      else if (metrics.latency > THRESHOLDS.latency.excellent) qualityScore -= 5
    }

    if (metrics.packetLoss !== undefined) {
      if (metrics.packetLoss > THRESHOLDS.packetLoss.poor) qualityScore -= 50
      else if (metrics.packetLoss > THRESHOLDS.packetLoss.fair) qualityScore -= 30
      else if (metrics.packetLoss > THRESHOLDS.packetLoss.good) qualityScore -= 15
      else if (metrics.packetLoss > THRESHOLDS.packetLoss.excellent) qualityScore -= 5
    }

    if (metrics.jitter !== undefined) {
      if (metrics.jitter > THRESHOLDS.jitter.poor) qualityScore -= 30
      else if (metrics.jitter > THRESHOLDS.jitter.fair) qualityScore -= 20
      else if (metrics.jitter > THRESHOLDS.jitter.good) qualityScore -= 10
      else if (metrics.jitter > THRESHOLDS.jitter.excellent) qualityScore -= 3
    }

    // Determine quality level
    if (qualityScore >= 85) return 'excellent'
    if (qualityScore >= 70) return 'good'
    if (qualityScore >= 50) return 'fair'
    if (qualityScore >= 25) return 'poor'
    return 'critical'
  }

  /**
   * Calculate connection health score
   */
  static calculateHealthScore(
    latency: number,
    packetLoss: number,
    jitter: number,
    stability: number // 0-1 scale
  ): ConnectionHealth {
    let score = 100

    // Latency impact (0-40 points)
    const latencyScore = Math.max(0, 40 - (latency / 10))
    score = Math.min(score, latencyScore)

    // Packet loss impact (0-30 points penalty)
    const packetLossPenalty = Math.min(30, packetLoss * 6)
    score -= packetLossPenalty

    // Jitter impact (0-20 points penalty)
    const jitterPenalty = Math.min(20, jitter / 5)
    score -= jitterPenalty

    // Stability bonus/penalty (0-10 points)
    const stabilityBonus = (stability - 0.5) * 20
    score += stabilityBonus

    score = Math.max(0, Math.min(100, score))

    // Determine quality and stability
    const quality = this.assessNetworkQuality({
      latency,
      packetLoss,
      jitter,
      samples: 10 // Assume sufficient samples
    })

    const stabilityLevel = stability >= 0.8 ? 'stable' : 
                          stability >= 0.5 ? 'unstable' : 'critical'

    return {
      quality,
      score,
      latency,
      packetLoss,
      jitter,
      bandwidth: 0, // To be filled by caller
      stability: stabilityLevel
    }
  }

  /**
   * Check if connection should retry
   */
  static shouldRetry(
    attempts: number,
    connectionType: ConnectionType,
    errorType: 'timeout' | 'network' | 'server' | 'unknown'
  ): { shouldRetry: boolean; delay: number; reason?: string } {
    const strategy = CONNECTION_BUSINESS_RULES.RETRY_STRATEGIES[connectionType]

    // Check attempt limit
    if (attempts >= strategy.maxAttempts) {
      return { 
        shouldRetry: false, 
        delay: 0, 
        reason: `Maximum attempts (${strategy.maxAttempts}) exceeded` 
      }
    }

    // Some errors should not be retried
    if (errorType === 'server' && attempts >= 1) {
      return { 
        shouldRetry: false, 
        delay: 0, 
        reason: 'Server error - no retry needed' 
      }
    }

    // Calculate delay with exponential backoff
    const baseDelay = strategy.baseDelay * Math.pow(strategy.backoffFactor, attempts - 1)
    let delay = Math.min(baseDelay, strategy.maxDelay)

    // Add jitter if configured
    if (strategy.jitter) {
      const jitterAmount = delay * 0.1 * Math.random()
      delay += jitterAmount
    }

    return { shouldRetry: true, delay }
  }

  /**
   * Validate connection timeout settings
   */
  static validateTimeouts(timeouts: Partial<typeof CONNECTION_BUSINESS_RULES.TIMEOUTS>): ConnectionValidationResult {
    const issues: string[] = []
    const recommendations: string[] = []

    // Check connection timeout
    if (timeouts.connection !== undefined) {
      if (timeouts.connection < 5000) {
        issues.push('Connection timeout too short (minimum 5 seconds)')
        recommendations.push('Increase connection timeout for better reliability')
      }
      if (timeouts.connection > 60000) {
        issues.push('Connection timeout too long (maximum 60 seconds)')
        recommendations.push('Reduce connection timeout for better user experience')
      }
    }

    // Check transport timeout
    if (timeouts.transport !== undefined) {
      if (timeouts.transport < 3000) {
        issues.push('Transport timeout too short (minimum 3 seconds)')
      }
      if (timeouts.transport > timeouts.connection!) {
        issues.push('Transport timeout should not exceed connection timeout')
      }
    }

    return {
      isValid: issues.length === 0,
      canConnect: true,
      issues,
      recommendations
    }
  }

  /**
   * Determine optimal connection parameters based on network conditions
   */
  static optimizeConnectionParams(networkQuality: NetworkQuality): {
    timeouts: typeof CONNECTION_BUSINESS_RULES.TIMEOUTS
    retryStrategy: RetryStrategy
  } {
    const baseTimeouts = CONNECTION_BUSINESS_RULES.TIMEOUTS
    const baseRetry = CONNECTION_BUSINESS_RULES.RETRY_STRATEGIES.webrtc

    switch (networkQuality) {
      case 'excellent':
        return {
          timeouts: baseTimeouts,
          retryStrategy: baseRetry
        }

      case 'good':
        return {
          timeouts: {
            ...baseTimeouts,
            connection: Math.round(baseTimeouts.connection * 1.2) as 15000,
            transport: Math.round(baseTimeouts.transport * 1.2) as 10000
          },
          retryStrategy: baseRetry
        }

      case 'fair':
        return {
          timeouts: {
            ...baseTimeouts,
            connection: Math.round(baseTimeouts.connection * 1.5) as 15000,
            transport: Math.round(baseTimeouts.transport * 1.5) as 10000,
            response: Math.round(baseTimeouts.response * 1.3) as 5000
          },
          retryStrategy: {
            ...baseRetry,
            maxAttempts: baseRetry.maxAttempts + 1,
            baseDelay: baseRetry.baseDelay * 1.5
          }
        }

      case 'poor':
        return {
          timeouts: {
            ...baseTimeouts,
            connection: Math.round(baseTimeouts.connection * 2) as 15000,
            transport: Math.round(baseTimeouts.transport * 2) as 10000,
            response: Math.round(baseTimeouts.response * 2) as 5000
          },
          retryStrategy: {
            ...baseRetry,
            maxAttempts: baseRetry.maxAttempts + 2,
            baseDelay: baseRetry.baseDelay * 2,
            maxDelay: baseRetry.maxDelay * 2
          }
        }

      case 'critical':
        return {
          timeouts: {
            ...baseTimeouts,
            connection: Math.round(baseTimeouts.connection * 3) as 15000,
            transport: Math.round(baseTimeouts.transport * 3) as 10000,
            response: Math.round(baseTimeouts.response * 3) as 5000
          },
          retryStrategy: {
            ...baseRetry,
            maxAttempts: Math.max(1, baseRetry.maxAttempts - 1), // Fewer attempts on critical network
            baseDelay: baseRetry.baseDelay * 3,
            maxDelay: baseRetry.maxDelay * 2
          }
        }

      default:
        return {
          timeouts: baseTimeouts,
          retryStrategy: baseRetry
        }
    }
  }

  /**
   * Check if connection is stable over time
   */
  static isConnectionStable(
    connectionHistory: { timestamp: Date; state: ConnectionState }[],
    windowMs: number = CONNECTION_BUSINESS_RULES.STABILITY_WINDOW
  ): { stable: boolean; stability: number; changes: number } {
    const now = Date.now()
    const cutoff = now - windowMs

    // Filter recent history
    const recentHistory = connectionHistory.filter(entry => 
      entry.timestamp.getTime() >= cutoff
    )

    if (recentHistory.length < 2) {
      return { stable: true, stability: 1.0, changes: 0 }
    }

    // Count state changes
    let changes = 0
    for (let i = 1; i < recentHistory.length; i++) {
      if (recentHistory[i].state !== recentHistory[i - 1].state) {
        changes++
      }
    }

    // Calculate stability (fewer changes = more stable)
    const maxChanges = Math.floor(windowMs / 10000) // Expected max changes per window
    const stability = Math.max(0, 1 - (changes / maxChanges))

    return {
      stable: stability >= 0.7,
      stability,
      changes
    }
  }
}