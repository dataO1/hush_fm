import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss(), solid()],
  resolve: {
    alias: {
      '@': '/src'
    }
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',  // ✅ Backend API
        changeOrigin: true,
        secure: false
      }
    }
  },
  build: {
    target: 'esnext',
  },
})
