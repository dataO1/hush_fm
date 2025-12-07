import { defineConfig } from 'orval'

export default defineConfig({
  api: {
    input: {
      target: 'http://localhost:3000/api/openapi.json',
      // Fallback to local file if server is not running
      fallback: '../backend/openapi.json',
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
        operations: {
          // Use Effect-TS for all operations
          'createRoom': {
            mutator: './src/utils/api-mutator.ts',
          },
          'listRooms': {
            mutator: './src/utils/api-mutator.ts',
          },
          'joinRoom': {
            mutator: './src/utils/api-mutator.ts',
          },
        },
      },
    },
  },
})