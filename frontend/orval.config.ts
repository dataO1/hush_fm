import { defineConfig } from 'orval'

export default defineConfig({
  api: {
    input: {
      target: 'http://localhost:3000/api-docs/openapi.json',
    },
    output: {
      target: './src/generated/api.ts',
      client: 'fetch',
      mode: 'tags-split',
      override: {
        mutator: {
          path: './src/utils/api-mutator.ts',
          name: 'effectFetch',
        },
      },
    },
  },
})