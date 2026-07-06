/**
 * User Domain Service
 *
 * Pure business logic for User entity.
 * Handles session ID generation: a persistent random per-device id
 * (localStorage, X5) with a deterministic browser-fingerprint fallback
 * when storage is unavailable.
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
   * localStorage key for the persistent per-device random id (X5).
   */
  private static readonly DEVICE_ID_STORAGE_KEY = 'hushfm-device-id'

  /**
   * Generate a UUIDv4 using crypto.getRandomValues.
   *
   * Deliberately NOT crypto.randomUUID — that is iOS 15.4+ only, while
   * getRandomValues is iOS 10+ (old-iPhone support is a project goal).
   */
  private static generateUuidV4(): string {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    // RFC 4122 §4.4: set version (4) and variant (10xx) bits
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`
  }

  /**
   * Get or create the persistent random device id (X5).
   *
   * A deterministic fingerprint hash collides across identical phone models
   * (the backend then treats guest B as guest A's reconnection and tears down
   * A's transport). "Stable AND unique per unit" can only come from
   * generate-once + persist: a random UUIDv4 frozen in localStorage.
   *
   * Returns Option.some('session-<uuid>') on success; Option.none() when
   * localStorage is unavailable/blocked (e.g. private mode) — the caller then
   * falls back to the fingerprint-based id.
   */
  private static getOrCreateDeviceId(): Effect.Effect<Option.Option<string>, never> {
    return Effect.sync(() => {
      try {
        const existing = window.localStorage.getItem(User.DEVICE_ID_STORAGE_KEY)
        if (existing !== null && existing.trim() !== '') {
          return Option.some(`session-${existing}`)
        }

        const uuid = User.generateUuidV4()
        window.localStorage.setItem(User.DEVICE_ID_STORAGE_KEY, uuid)

        // Read back: some storage-restricted modes accept setItem without
        // persisting. If it did not stick, a fresh id would be generated on
        // every load (permanent churn) — prefer the stable fallback instead.
        if (window.localStorage.getItem(User.DEVICE_ID_STORAGE_KEY) !== uuid) {
          return Option.none()
        }

        return Option.some(`session-${uuid}`)
      } catch {
        // localStorage blocked (private mode / storage policy / quota) —
        // fall back to the fingerprint-based id (rare-collision edge case).
        return Option.none()
      }
    })
  }

  /**
   * Convert browser fingerprint to session ID
   *
   * FALLBACK path only (X5): deterministic device-attribute hash — two
   * identical phone models produce the SAME id. Used only when localStorage
   * is unavailable and the random per-device id cannot be persisted.
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
   * Compute session ID
   *
   * Primary source (X5): persistent random per-device id from localStorage —
   * stable across reloads AND unique per unit (identical phone models no
   * longer collide). Fallback when localStorage is unavailable: the legacy
   * deterministic fingerprint hash.
   *
   * Public static method that can be called from anywhere
   * Returns Effect with session computation result
   */
  public static computeSessionId(): Effect.Effect<SessionIdComputationType, UserServiceError> {
    return pipe(
      Effect.gen(function* (_) {
        console.info('🔐 Computing session ID...')

        // The fingerprint is still computed: it is part of the result shape
        // (SessionIdComputationType) and the fallback id source.
        const fingerprint = yield* _(User.computeBrowserFingerprint())

        const deviceId = yield* _(User.getOrCreateDeviceId())
        const sessionId = yield* _(
          pipe(
            deviceId,
            Option.match({
              onNone: () => {
                console.warn('🔐 localStorage unavailable — falling back to fingerprint-based session ID')
                return User.fingerprintToSessionId(fingerprint)
              },
              onSome: (id) => Effect.succeed(id)
            })
          )
        )
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