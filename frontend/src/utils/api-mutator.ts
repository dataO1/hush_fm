import { Effect, pipe } from 'effect'

/**
 * API Error class for Effect-TS integration
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public response?: Response
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Effect-TS fetch mutator for Orval
 * Wraps fetch operations in Effect for composable error handling
 */
export const effectFetch = <T>(
  url: string,
  config?: RequestInit
): Effect.Effect<T, ApiError, never> =>
  pipe(
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(url, {
          headers: {
            'Content-Type': 'application/json',
            ...config?.headers,
          },
          ...config,
        })

        if (!response.ok) {
          throw new ApiError(
            response.status,
            response.statusText,
            response
          )
        }

        // Handle empty responses (204 No Content)
        if (response.status === 204) {
          return {} as T
        }

        const contentType = response.headers.get('content-type')
        if (contentType?.includes('application/json')) {
          return response.json()
        }

        return response.text() as T
      },
      catch: (error) => {
        if (error instanceof ApiError) {
          return error
        }

        // Network or other errors
        return new ApiError(
          0,
          error instanceof Error ? error.message : String(error)
        )
      },
    }),
    Effect.tap(() =>
      Effect.logDebug(`API Request: ${config?.method || 'GET'} ${url}`)
    )
  )

/**
 * Retry strategy for API calls
 */
export const retryApiCall = <T>(
  effect: Effect.Effect<T, ApiError, never>,
  maxRetries: number = 3
): Effect.Effect<T, ApiError, never> =>
  pipe(
    effect,
    Effect.retry({ times: maxRetries })
  )

/**
 * Helper to add authentication headers when needed
 */
export const withAuth = (token: string) => (config?: RequestInit): RequestInit => ({
  ...config,
  headers: {
    ...config?.headers,
    Authorization: `Bearer ${token}`,
  },
})

/**
 * Effect-based timeout wrapper
 */
export const withTimeout = <T>(
  effect: Effect.Effect<T, ApiError>,
  timeoutMs: number = 10000
): Effect.Effect<T, ApiError> =>
  pipe(
    effect,
    Effect.timeout(timeoutMs),
    Effect.catchTag('TimeoutException', () =>
      Effect.fail(new ApiError(408, 'Request timeout'))
    )
  )

/**
 * Type-safe query parameter builder
 */
export const buildQueryString = (params: Record<string, unknown>): string => {
  const searchParams = new URLSearchParams()
  
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      searchParams.append(key, String(value))
    }
  })

  const queryString = searchParams.toString()
  return queryString ? `?${queryString}` : ''
}