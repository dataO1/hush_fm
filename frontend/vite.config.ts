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
  },
  resolve: {
    alias: { '@': '/src' },
  },
  optimizeDeps: {
    include: ['mediasoup-client']
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
    rollupOptions: {
      output: {
        manualChunks: {
          // Split vendor dependencies
          'vendor-effect': ['effect', '@effect/experimental', '@effect/platform-browser'],
          'vendor-solid': ['solid-js', '@solidjs/router'],
          'vendor-mediasoup': ['mediasoup-client']
        }
      }
    }
  },
})
