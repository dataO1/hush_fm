/**
 * Multi-Step Flow Schema Patterns
 * 
 * Common patterns for flow state management across DJ (18-step) and Listener (10-step) domains.
 * Eliminates duplication while maintaining domain-specific flow steps.
 */

import { Schema as S } from 'effect'

/**
 * Multi-Step Flow State Foundation
 * 
 * Common structure for flow tracking with timestamps and error handling.
 */
export const MultiStepFlowState = S.Struct({
  currentStep: S.String, // Domain-specific steps extend this
  stepStartedAt: S.Option(S.DateFromString), // Transform: ISO string → Date
  stepError: S.Option(S.String),
  flowStartedAt: S.Option(S.DateFromString),
  flowCompletedAt: S.Option(S.DateFromString),
  lastError: S.Option(S.Struct({
    step: S.String,
    error: S.String,
    timestamp: S.DateFromString, // Transform: ISO string → Date
    recoverable: S.Boolean
  }))
})
export type MultiStepFlowStateType = S.Schema.Type<typeof MultiStepFlowState>
export type MultiStepFlowStateEncoded = S.Schema.Encoded<typeof MultiStepFlowState>

/**
 * DJ/Listener Flow Progress Metrics
 * 
 * Tracks timing and performance across complex multi-step flows.
 */
export const MultiStepFlowProgress = S.Struct({
  totalSteps: S.Number,
  completedSteps: S.Number,
  estimatedTimeRemaining: S.Option(S.Number), // milliseconds
  averageStepDuration: S.Option(S.Number),     // milliseconds
  flowStartTime: S.DateFromString,
  lastStepTime: S.DateFromString
})
export type MultiStepFlowProgressType = S.Schema.Type<typeof MultiStepFlowProgress>
export type MultiStepFlowProgressEncoded = S.Schema.Encoded<typeof MultiStepFlowProgress>

/**
 * WebRTC Flow Retry Configuration
 * 
 * Standard retry patterns for recoverable WebRTC flow failures.
 */
export const WebRTCFlowRetry = S.Struct({
  maxRetries: S.Number,
  currentRetries: S.Number,
  retryDelayMs: S.Number,
  backoffMultiplier: S.Number,
  lastRetryAt: S.Option(S.DateFromString),
  nextRetryAt: S.Option(S.DateFromString)
})
export type WebRTCFlowRetryType = S.Schema.Type<typeof WebRTCFlowRetry>
export type WebRTCFlowRetryEncoded = S.Schema.Encoded<typeof WebRTCFlowRetry>

/**
 * Consolidated Multi-Step Flow Schemas for easy import
 */
export const MultiStepFlowSchemas = {
  State: MultiStepFlowState,
  Progress: MultiStepFlowProgress,
  Retry: WebRTCFlowRetry
}

/**
 * Consolidated Multi-Step Flow Types for easy import
 */
export type MultiStepFlowTypes = {
  State: MultiStepFlowStateType
  Progress: MultiStepFlowProgressType
  Retry: WebRTCFlowRetryType
}