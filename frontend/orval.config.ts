import { defineConfig } from 'orval'

// Get API base URL from environment variable
const apiBaseUrl = process.env.VITE_API_BASE_URL || 'http://localhost:3000'

export default defineConfig({
  api: {
    input: { target: './openapi.yaml' },
    output: {
      target: './src/services/generated',
      client: 'fetch',
      mode: 'tags-split',
      override: {
        mutator: {
          path: './src/config.ts',
          name: 'apiMutator'
        }
      }
    },
    query: { useQuery: false, useMutation: false }
  }
})
