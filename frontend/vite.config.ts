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
    proxy: {
      '/api': {
        target: 'http://localhost:3000', // Only relevant if you use /api/... locally
        changeOrigin: true,
        secure: false
      },
    },
  },
  build: {
    target: 'esnext',
  },
})
