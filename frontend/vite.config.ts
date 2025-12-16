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
    port: 5173,
    host: true, // This listens on 0.0.0.0 (ALL interfaces)
    strictPort: true, // Fail if port 5173 is taken
    https: {
      key: '../tls/server.key',
      cert: '../tls/server.crt',
    },
    proxy: {
      '/api': {
        target: 'https://localhost:3443', // Updated to use HTTPS backend
        changeOrigin: true,
        secure: false // Allow self-signed certificates in development
      },
    },
  },
  build: {
    target: 'esnext',
  },
})
