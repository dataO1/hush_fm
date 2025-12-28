// vite.config.ts
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import devtools from 'solid-devtools/vite'

export default defineConfig({
  plugins: [
    devtools({ autoname: true }),
    solid()
  ],
  envPrefix: ['VITE_', 'HUSHFM_'], // Allow both VITE_ and HUSHFM_ prefixed env vars
  css: {
    postcss: {
      plugins: [tailwindcss, autoprefixer],
    },
    // Optimize CSS processing
    devSourcemap: false, // Disable CSS sourcemaps in dev for speed
  },
  resolve: {
    alias: { '@': '/src' },
  },
  optimizeDeps: {
    include: ['mediasoup-client'],
    // Force pre-bundle these dependencies for faster dev startup
    force: true,
    // Use esbuild for faster dependency processing
    esbuildOptions: {
      target: 'esnext',
    }
  },
  // Use esbuild for faster transpilation in development
  esbuild: {
    target: 'esnext',
    logOverride: { 'this-is-undefined-in-esm': 'silent' }
  },
  server: {
    port: parseInt(process.env.HUSHFM_FRONTEND_PORT || '8080'),
    host: true, // This listens on 0.0.0.0 (ALL interfaces)
    strictPort: true, // Fail if port is taken
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.HUSHFM_BACKEND_PORT || '3000'}`,
        changeOrigin: true,
        secure: false // Allow self-signed certificates in development
      },
      '/ws': {
        target: `http://localhost:${process.env.HUSHFM_BACKEND_PORT || '3000'}`,
        ws: true, // Enable WebSocket proxying
        changeOrigin: true,
        secure: false
      },
    },
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 1000, // Increase limit to 1MB to reduce warnings
    sourcemap: false, // Disable sourcemaps for faster builds
    rollupOptions: {
      output: {
        manualChunks: {
          // Keep working vendor splitting for Pi
          'vendor-effect': ['effect', '@effect/experimental', '@effect/platform-browser'],
          'vendor-solid': ['solid-js', '@solidjs/router'],
          'vendor-mediasoup': ['mediasoup-client']
        }
      }
    },
    minify: 'terser',
    terserOptions: {
      compress: {
        // Remove console.* calls in production
        drop_console: true,
        drop_debugger: true,
        // Additional compression optimizations for Pi
        passes: 3, // Run compression 3 times for maximum size reduction
        pure_funcs: ['console.info', 'console.debug', 'console.warn'], // Remove specific console calls
        dead_code: true, // Remove unreachable code
        hoist_funs: true, // Hoist function declarations for better compression
        hoist_vars: true, // Hoist variable declarations
        if_return: true, // Optimize if-return statements
        join_vars: true, // Join consecutive var statements
        reduce_vars: true, // Reduce variables to values when possible
        sequences: true, // Join consecutive simple statements
        booleans: true, // Optimize boolean expressions
        properties: true, // Optimize property access
        evaluate: true, // Evaluate constant expressions
        loops: true, // Optimize loops
        unused: true, // Remove unused code
        conditionals: true, // Optimize conditionals
        comparisons: true, // Optimize comparisons
      },
      mangle: {
        // Optimize variable names for smaller bundle
        safari10: true, // Support Safari 10+
      },
      format: {
        // Remove comments for smaller files
        comments: false,
      },
    }
  },
})
