// src/config.ts - Environment-aware configuration
export interface Config {
  api: {
    baseUrl: string
  }
  websocket: {
    protocol: 'ws' | 'wss'
    baseUrl: string
  }
  development: {
    enableDevtools: boolean
  }
}

// Read configuration from environment variables (build-time)
const getEnvVar = (key: string, defaultValue: string): string => {
  // In Vite, environment variables are available via import.meta.env
  return (import.meta.env[key as keyof ImportMetaEnv] as string) || defaultValue
}

// Parse boolean environment variables
const getEnvBool = (key: string, defaultValue: boolean): boolean => {
  const value = getEnvVar(key, defaultValue.toString())
  return value.toLowerCase() === 'true'
}

// Create configuration from environment variables
export const config: Config = {
  api: {
    baseUrl: getEnvVar('VITE_API_BASE_URL', 'http://localhost:3000')
  },
  websocket: {
    protocol: getEnvVar('VITE_WS_PROTOCOL', 'ws') as 'ws' | 'wss',
    baseUrl: (() => {
      const apiUrl = getEnvVar('VITE_API_BASE_URL', 'http://localhost:3000')
      const protocol = getEnvVar('VITE_WS_PROTOCOL', 'ws')
      // Convert HTTP URL to WebSocket URL
      return apiUrl.replace(/^https?/, protocol)
    })()
  },
  development: {
    enableDevtools: getEnvBool('VITE_ENABLE_DEVTOOLS', import.meta.env.DEV as boolean)
  }
}

// Export individual config sections for convenience
export const { api, websocket, development } = config

// Custom fetch mutator for Orval (automatically applies base URL)
export const apiMutator = <T>(url: string, options?: RequestInit): Promise<T> => {
  const fullUrl = url.startsWith('http') ? url : `${config.api.baseUrl}${url}`
  
  return fetch(fullUrl, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    return response.json()
  })
}