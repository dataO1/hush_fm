import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import devtools from 'solid-devtools/vite'

export default defineConfig({
  plugins: [
    devtools({
      /* features options - all disabled by default */
      autoname: true, // e.g. enable autoname
    }),
      solid()
  ],
  css: {
    postcss: {
      plugins: [
        tailwindcss,
        autoprefixer,
      ],
    },
  },
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
