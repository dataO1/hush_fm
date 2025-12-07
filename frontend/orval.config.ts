import { defineConfig } from 'orval'

// orval.config.ts - SIMPLIFIED
export default defineConfig({
  api: {
    input: { target: 'http://localhost:3000/api-docs/openapi.json' },
    output: {
      target: './src/generated/api.ts',
      client: 'fetch',  // ✅ Native fetch, NO mutator
      mode: 'tags-split',
      // Remove ALL mutator config
    },
    query: { useQuery: false, useMutation: false }
  }
})
