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
  css: {
    postcss: {
      plugins: [tailwindcss, autoprefixer],
    },
  },
  resolve: {
    alias: { '@': '/src' },
  },
  server: {
    port: parseInt(process.env.HUSHFM_FRONTEND_PORT || '8080'),
    host: true, // This listens on 0.0.0.0 (ALL interfaces)
    strictPort: true, // Fail if port is taken
    https: process.env.HUSHFM_TLS_ENABLED === 'true' ? {
      key: process.env.HUSHFM_KEY_FILE,
      cert: process.env.HUSHFM_CERT_FILE,
    } : undefined,
    proxy: {
      '/api': {
        target: `${process.env.HUSHFM_TLS_ENABLED === 'true' ? 'https' : 'http'}://localhost:${process.env.HUSHFM_BACKEND_PORT || '3000'}`,
        changeOrigin: true,
        secure: false // Allow self-signed certificates in development
      },
    },
  },
  build: {
    target: 'esnext',
  },
})
