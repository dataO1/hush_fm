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
  ports: {
    backend: number
    frontend: number
  }
  hostName: string
}

// Read configuration from environment variables (build-time)
const getEnvVar = (key: string, defaultValue: string): string => {
  // In Vite, environment variables are available via import.meta.env
  return (import.meta.env[key as keyof ImportMetaEnv] as string) || defaultValue
}

// Parse boolean environment variables (unused for now)
// const getEnvBool = (key: string, defaultValue: boolean): boolean => {
//   const value = getEnvVar(key, defaultValue.toString())
//   return value.toLowerCase() === 'true'
// }

// Parse numeric environment variables
const getEnvNumber = (key: string, defaultValue: number): number => {
  const value = getEnvVar(key, defaultValue.toString())
  const parsed = parseInt(value, 10)
  return isNaN(parsed) ? defaultValue : parsed
}

// Helper function to check if hostname is for local development
const isLocalDevelopment = (hostName: string): boolean => {
  return hostName === 'localhost' || hostName === '127.0.0.1'
}

// Create configuration from environment variables
export const config: Config = {
  api: {
    baseUrl: (() => {
      const hostName = getEnvVar('HUSHFM_HOST_NAME', 'localhost')
      // Use HTTPS for production (non-localhost), HTTP for development
      const protocol = isLocalDevelopment(hostName) ? 'http' : 'https'
      return `${protocol}://${hostName}`
    })()
  },
  websocket: {
    protocol: (() => {
      const hostName = getEnvVar('HUSHFM_HOST_NAME', 'localhost')
      // Use WSS for production (non-localhost/127.0.0.1), WS for development
      return isLocalDevelopment(hostName) ? 'ws' : 'wss'
    })() as 'ws' | 'wss',
    baseUrl: (() => {
      const hostName = getEnvVar('HUSHFM_HOST_NAME', 'localhost')
      const protocol = isLocalDevelopment(hostName) ? 'ws' : 'wss'
      
      // Include backend port for local development, exclude for production (nginx proxy)
      if (isLocalDevelopment(hostName)) {
        const backendPort = getEnvNumber('HUSHFM_BACKEND_PORT', 3000)
        return `${protocol}://${hostName}:${backendPort}`
      } else {
        return `${protocol}://${hostName}`
      }
    })()
  },
  development: {
    enableDevtools: import.meta.env.DEV as boolean
  },
  ports: {
    backend: getEnvNumber('HUSHFM_BACKEND_PORT', 3000),
    frontend: getEnvNumber('HUSHFM_FRONTEND_PORT', 8080)
  },
  hostName: getEnvVar('HUSHFM_HOST_NAME', 'localhost')
}

// Export individual config sections for convenience
export const { api, websocket, development, ports, hostName } = config

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