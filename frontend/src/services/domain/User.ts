/**
 * User Domain Service
 *
 * Pure business logic for User entity.
 * Handles browser fingerprint computation and session ID generation.
 * Provides deterministic session identification without persistence.
 * 
 * All methods are static and have no external dependencies.
 */

import { Effect, pipe, Option } from 'effect'
import type {
  BrowserFingerprintType,
  SessionIdComputationType
} from '../../domain/schemas/user.schema'
import { UserServiceError } from '../../domain/schemas/user.schema'

/**
 * User Domain Service - Pure Static Methods
 */
export class User {
  /**
   * Compute browser fingerprint from available browser APIs
   */
  private static computeBrowserFingerprint(): Effect.Effect<BrowserFingerprintType, UserServiceError> {
    return pipe(
      Effect.gen(function* (_) {
        try {
          // Screen information
          const screenWidth = window.screen.width
          const screenHeight = window.screen.height
          const colorDepth = window.screen.colorDepth
          
          // Navigator information
          const userAgent = navigator.userAgent
          const platform = navigator.platform
          const language = navigator.language
          const languages = navigator.languages ? Array.from(navigator.languages) : [language]
          const hardwareConcurrency = navigator.hardwareConcurrency || 1
          
          // Timezone information
          const timezoneOffset = new Date().getTimezoneOffset()
          
          // Device memory (if available)
          const deviceMemory = (navigator as any).deviceMemory
          
          // Canvas fingerprint
          const canvasFingerprint = yield* _(User.generateCanvasFingerprint())
          
          // WebGL fingerprint
          const webglFingerprint = yield* _(User.generateWebGLFingerprint())
          
          const fingerprint: BrowserFingerprintType = {
            screenWidth,
            screenHeight,
            colorDepth,
            userAgent,
            timezoneOffset,
            language,
            languages,
            hardwareConcurrency,
            deviceMemory: deviceMemory ? Option.some(deviceMemory) : Option.none(),
            platform,
            canvasFingerprint,
            webglFingerprint
          }
          
          return fingerprint
          
        } catch (error) {
          return yield* _(Effect.fail(new UserServiceError({
            cause: 'Failed to compute browser fingerprint',
            operation: 'computeBrowserFingerprint',
            role: 'dj', // Default role for fingerprinting
            timestamp: new Date()
          })))
        }
      })
    )
  }

  /**
   * Generate canvas-based fingerprint
   */
  private static generateCanvasFingerprint(): Effect.Effect<string, UserServiceError> {
    return pipe(
      Effect.gen(function* (_) {
        try {
          const canvas = document.createElement('canvas')
          const ctx = canvas.getContext('2d')
          
          if (!ctx) {
            return 'no-canvas'
          }
          
          // Draw some text and shapes for fingerprinting
          ctx.textBaseline = 'top'
          ctx.font = '14px Arial'
          ctx.fillStyle = '#f60'
          ctx.fillRect(125, 1, 62, 20)
          ctx.fillStyle = '#069'
          ctx.fillText('HushFM fingerprint 🎵', 2, 15)
          ctx.fillStyle = 'rgba(102, 204, 0, 0.7)'
          ctx.fillText('Audio streaming platform', 4, 17)
          
          // Add some geometric shapes
          ctx.globalCompositeOperation = 'multiply'
          ctx.fillStyle = 'rgb(255,0,255)'
          ctx.beginPath()
          ctx.arc(50, 50, 50, 0, Math.PI * 2, true)
          ctx.closePath()
          ctx.fill()
          
          // Get the data URL
          const dataURL = canvas.toDataURL()
          
          // Generate hash from data URL
          return yield* _(User.generateHash(dataURL))
          
        } catch (error) {
          return 'canvas-error'
        }
      })
    )
  }

  /**
   * Generate WebGL-based fingerprint
   */
  private static generateWebGLFingerprint(): Effect.Effect<string, UserServiceError> {
    return pipe(
      Effect.gen(function* (_) {
        try {
          const canvas = document.createElement('canvas')
          const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
          
          if (!gl) {
            return 'no-webgl'
          }
          
          // Get WebGL parameters (cast to WebGLRenderingContext)
          const webGL = gl as WebGLRenderingContext
          const renderer = webGL.getParameter(webGL.RENDERER) || 'unknown'
          const vendor = webGL.getParameter(webGL.VENDOR) || 'unknown'
          const version = webGL.getParameter(webGL.VERSION) || 'unknown'
          const shadingLanguageVersion = webGL.getParameter(webGL.SHADING_LANGUAGE_VERSION) || 'unknown'
          
          // Get supported extensions
          const extensions = webGL.getSupportedExtensions() || []
          
          const webglInfo = {
            renderer,
            vendor,
            version,
            shadingLanguageVersion,
            extensions: extensions.sort()
          }
          
          return yield* _(User.generateHash(JSON.stringify(webglInfo)))
          
        } catch (error) {
          return 'webgl-error'
        }
      })
    )
  }

  /**
   * Generate a simple hash from a string (deterministic)
   */
  private static generateHash(str: string): Effect.Effect<string, UserServiceError> {
    return pipe(
      Effect.gen(function* (_) {
        // Simple djb2 hash algorithm for deterministic results
        let hash = 5381
        for (let i = 0; i < str.length; i++) {
          hash = ((hash << 5) + hash) + str.charCodeAt(i)
          hash = hash & hash // Convert to 32bit integer
        }
        
        // Convert to positive hex string
        return Math.abs(hash).toString(16)
      })
    )
  }

  /**
   * Convert browser fingerprint to session ID
   */
  private static fingerprintToSessionId(fingerprint: BrowserFingerprintType): Effect.Effect<string, UserServiceError> {
    return pipe(
      Effect.gen(function* (_) {
        // Combine all fingerprint data into a single string
        const fingerprintString = [
          fingerprint.screenWidth,
          fingerprint.screenHeight,
          fingerprint.colorDepth,
          fingerprint.userAgent,
          fingerprint.timezoneOffset,
          fingerprint.language,
          fingerprint.languages.join(','),
          fingerprint.hardwareConcurrency,
          Option.getOrElse(fingerprint.deviceMemory, () => 'unknown'),
          fingerprint.platform,
          fingerprint.canvasFingerprint,
          fingerprint.webglFingerprint
        ].join('|')
        
        // Generate hash from combined fingerprint
        const hash = yield* _(User.generateHash(fingerprintString))
        
        // Encode hash as base64 for URL safety and consistency
        const sessionId = btoa(hash)
        
        return `session-${sessionId}`
      })
    )
  }

  /**
   * Compute session ID from browser fingerprint
   * 
   * Public static method that can be called from anywhere
   * Returns Effect with session computation result
   */
  public static computeSessionId(): Effect.Effect<SessionIdComputationType, UserServiceError> {
    return pipe(
      Effect.gen(function* (_) {
        console.info('🔐 Computing session ID from browser fingerprint...')
        
        const fingerprint = yield* _(User.computeBrowserFingerprint())
        const sessionId = yield* _(User.fingerprintToSessionId(fingerprint))
        const computedAt = new Date()
        
        console.info('✅ Session ID computed successfully:', { 
          sessionId,
          fingerprintSummary: {
            screen: `${fingerprint.screenWidth}x${fingerprint.screenHeight}`,
            platform: fingerprint.platform,
            language: fingerprint.language,
            hardwareConcurrency: fingerprint.hardwareConcurrency
          }
        })
        
        return {
          sessionId,
          fingerprint,
          computedAt
        }
      })
    )
  }
}