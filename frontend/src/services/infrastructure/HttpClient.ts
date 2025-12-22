/**
 * HTTP Infrastructure Client
 * 
 * Pure technical layer for HTTP API communications.
 * No business logic - only handles HTTP operations.
 * 
 * Responsibilities:
 * - HTTP request execution
 * - Response parsing
 * - Technical error handling
 * - Request/response transformation
 * - Network-level concerns
 */

import { Effect, pipe, Context, Layer } from 'effect'

/**
 * HTTP method types
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

/**
 * HTTP request configuration
 */
export interface HttpRequest {
  url: string
  method: HttpMethod
  headers?: Record<string, string>
  body?: any
  timeout?: number
  credentials?: RequestCredentials
}

/**
 * HTTP response envelope
 */
export interface HttpResponse<T = any> {
  data: T
  status: number
  statusText: string
  headers: Record<string, string>
  url: string
}

/**
 * HTTP Infrastructure Error
 */
export class HttpInfrastructureError extends Error {
  constructor(
    message: string,
    public status: number,
    public operation: string,
    public url?: string,
    public cause?: unknown
  ) {
    super(message)
    this.name = 'HttpInfrastructureError'
  }
}

/**
 * HTTP Client Interface
 */
export interface HttpClient {
  /**
   * Execute HTTP request
   */
  readonly request: <T = any>(config: HttpRequest) => Effect.Effect<HttpResponse<T>, HttpInfrastructureError>
  
  /**
   * GET request
   */
  readonly get: <T = any>(url: string, headers?: Record<string, string>) => Effect.Effect<HttpResponse<T>, HttpInfrastructureError>
  
  /**
   * POST request
   */
  readonly post: <T = any>(url: string, body?: any, headers?: Record<string, string>) => Effect.Effect<HttpResponse<T>, HttpInfrastructureError>
  
  /**
   * PUT request
   */
  readonly put: <T = any>(url: string, body?: any, headers?: Record<string, string>) => Effect.Effect<HttpResponse<T>, HttpInfrastructureError>
  
  /**
   * DELETE request
   */
  readonly delete: <T = any>(url: string, headers?: Record<string, string>) => Effect.Effect<HttpResponse<T>, HttpInfrastructureError>
}

/**
 * Default headers for JSON API
 */
const defaultHeaders = {
  'Content-Type': 'application/json',
  'Accept': 'application/json'
}

/**
 * HTTP Client Implementation
 */
/**
 * HTTP Client Context Tag
 * 
 * Services import and use this tag for dependency injection.
 * Uses the same name as the interface for clean imports.
 */
export class HttpClient extends Context.Tag("@app/infrastructure/HttpClient")<
  HttpClient,
  HttpClient
>() {}

/**
 * HTTP Client Implementation
 */
const HttpClientImpl: HttpClient = {
  /**
   * Execute HTTP request
   */
  request: <T = any>(config: HttpRequest): Effect.Effect<HttpResponse<T>, HttpInfrastructureError> =>
    pipe(
      Effect.tryPromise({
        try: async () => {
          const controller = new AbortController()
          
          // Set timeout if specified
          let timeoutId: NodeJS.Timeout | null = null
          if (config.timeout) {
            timeoutId = setTimeout(() => controller.abort(), config.timeout)
          }
          
          try {
            // Prepare request
            const requestInit: RequestInit = {
              method: config.method,
              headers: {
                ...defaultHeaders,
                ...config.headers
              },
              signal: controller.signal,
              credentials: config.credentials
            }
            
            // Add body for non-GET requests
            if (config.body && config.method !== 'GET') {
              requestInit.body = typeof config.body === 'string' 
                ? config.body 
                : JSON.stringify(config.body)
            }
            
            // Execute request
            const response = await fetch(config.url, requestInit)
            
            // Clear timeout
            if (timeoutId) clearTimeout(timeoutId)
            
            // Parse response headers
            const headers: Record<string, string> = {}
            response.headers.forEach((value, key) => {
              headers[key] = value
            })
            
            // Parse response body
            let data: T
            const contentType = response.headers.get('content-type')
            
            if (contentType?.includes('application/json')) {
              data = await response.json()
            } else if (contentType?.includes('text/')) {
              data = await response.text() as T
            } else {
              data = await response.arrayBuffer() as T
            }
            
            // Check for HTTP errors
            if (!response.ok) {
              throw new HttpInfrastructureError(
                `HTTP ${response.status}: ${response.statusText}`,
                response.status,
                'request',
                config.url,
                data
              )
            }
            
            return {
              data,
              status: response.status,
              statusText: response.statusText,
              headers,
              url: response.url
            } as HttpResponse<T>
            
          } finally {
            if (timeoutId) clearTimeout(timeoutId)
          }
        },
        catch: error => {
          if (error instanceof HttpInfrastructureError) {
            return error
          }
          
          // Handle different error types
          if (error instanceof DOMException && error.name === 'AbortError') {
            return new HttpInfrastructureError(
              'Request timeout',
              408,
              'request',
              config.url,
              error
            )
          }
          
          if (error instanceof TypeError) {
            return new HttpInfrastructureError(
              'Network error or CORS issue',
              0,
              'request',
              config.url,
              error
            )
          }
          
          return new HttpInfrastructureError(
            'Unknown network error',
            0,
            'request',
            config.url,
            error
          )
        }
      })
    ),

  /**
   * GET request
   */
  get: <T = any>(url: string, headers?: Record<string, string>): Effect.Effect<HttpResponse<T>, HttpInfrastructureError> =>
    HttpClientLive.request<T>({
      url,
      method: 'GET',
      headers
    }),

  /**
   * POST request
   */
  post: <T = any>(url: string, body?: any, headers?: Record<string, string>): Effect.Effect<HttpResponse<T>, HttpInfrastructureError> =>
    HttpClientLive.request<T>({
      url,
      method: 'POST',
      body,
      headers
    }),

  /**
   * PUT request
   */
  put: <T = any>(url: string, body?: any, headers?: Record<string, string>): Effect.Effect<HttpResponse<T>, HttpInfrastructureError> =>
    HttpClientLive.request<T>({
      url,
      method: 'PUT',
      body,
      headers
    }),

  /**
   * DELETE request
   */
  delete: <T = any>(url: string, headers?: Record<string, string>): Effect.Effect<HttpResponse<T>, HttpInfrastructureError> =>
    HttpClientLive.request<T>({
      url,
      method: 'DELETE',
      headers
    })
}

/**
 * HTTP Client Service Layer
 */
/**
 * HTTP Client Layer
 * 
 * Live implementation layer that provides the HttpClient.
 * Use this in your app's main Layer composition.
 */
export const HttpClientLive = Layer.succeed(
  HttpClient,
  HttpClientImpl
)

/**
 * Convenience functions for common HTTP operations
 */
export namespace HttpAPI {
  /**
   * Create base URL helper
   */
  export const createBaseUrlHelper = (baseUrl: string) => ({
    get: <T>(path: string, headers?: Record<string, string>) =>
      HttpClientLive.get<T>(`${baseUrl}${path}`, headers),
    
    post: <T>(path: string, body?: any, headers?: Record<string, string>) =>
      HttpClientLive.post<T>(`${baseUrl}${path}`, body, headers),
    
    put: <T>(path: string, body?: any, headers?: Record<string, string>) =>
      HttpClientLive.put<T>(`${baseUrl}${path}`, body, headers),
    
    delete: <T>(path: string, headers?: Record<string, string>) =>
      HttpClientLive.delete<T>(`${baseUrl}${path}`, headers)
  })

  /**
   * Parse error response
   */
  export const parseErrorResponse = (error: HttpInfrastructureError) => ({
    message: error.message,
    status: error.status,
    url: error.url,
    cause: error.cause
  })

  /**
   * Check if error is network-related
   */
  export const isNetworkError = (error: HttpInfrastructureError) =>
    error.status === 0 || error.status === 408

  /**
   * Check if error is client-side
   */
  export const isClientError = (error: HttpInfrastructureError) =>
    error.status >= 400 && error.status < 500

  /**
   * Check if error is server-side
   */
  export const isServerError = (error: HttpInfrastructureError) =>
    error.status >= 500 && error.status < 600
}