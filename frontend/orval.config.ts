import { defineConfig } from 'orval'

// orval.config.ts - SIMPLIFIED
export default defineConfig({
  api: {
    input: { target: './openapi.yaml' },
    output: {
      target: './src/services/generated',
      client: 'fetch',  // ✅ Native fetch, NO mutator
      mode: 'tags-split',
      // Remove ALL mutator config
    },
    query: { useQuery: false, useMutation: false }
  }
})
