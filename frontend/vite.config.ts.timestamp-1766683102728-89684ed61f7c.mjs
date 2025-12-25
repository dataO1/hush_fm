// vite.config.ts
import { defineConfig } from "file:///home/data01/Projects/hushfm/frontend/node_modules/vite/dist/node/index.js";
import solid from "file:///home/data01/Projects/hushfm/frontend/node_modules/vite-plugin-solid/dist/esm/index.mjs";
import tailwindcss from "file:///home/data01/Projects/hushfm/frontend/node_modules/tailwindcss/lib/index.js";
import autoprefixer from "file:///home/data01/Projects/hushfm/frontend/node_modules/autoprefixer/lib/autoprefixer.js";
import devtools from "file:///home/data01/Projects/hushfm/frontend/node_modules/solid-devtools/dist/vite.js";
var vite_config_default = defineConfig({
  plugins: [
    devtools({ autoname: true }),
    solid()
  ],
  envPrefix: ["VITE_", "HUSHFM_"],
  // Allow both VITE_ and HUSHFM_ prefixed env vars
  css: {
    postcss: {
      plugins: [tailwindcss, autoprefixer]
    }
  },
  resolve: {
    alias: { "@": "/src" }
  },
  optimizeDeps: {
    include: ["mediasoup-client"]
  },
  server: {
    port: parseInt(process.env.HUSHFM_FRONTEND_PORT || "8080"),
    host: true,
    // This listens on 0.0.0.0 (ALL interfaces)
    strictPort: true,
    // Fail if port is taken
    proxy: {
      "/api": {
        target: `http://localhost:${process.env.HUSHFM_BACKEND_PORT || "3000"}`,
        changeOrigin: true,
        secure: false
        // Allow self-signed certificates in development
      },
      "/ws": {
        target: `http://localhost:${process.env.HUSHFM_BACKEND_PORT || "3000"}`,
        ws: true,
        // Enable WebSocket proxying
        changeOrigin: true,
        secure: false
      }
    }
  },
  build: {
    target: "esnext",
    chunkSizeWarningLimit: 1e3,
    // Increase limit to 1MB to reduce warnings
    rollupOptions: {
      output: {
        manualChunks: {
          // Split vendor dependencies
          "vendor-effect": ["effect", "@effect/experimental", "@effect/platform-browser"],
          "vendor-solid": ["solid-js", "@solidjs/router"],
          "vendor-mediasoup": ["mediasoup-client"]
        }
      }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS9kYXRhMDEvUHJvamVjdHMvaHVzaGZtL2Zyb250ZW5kXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvaG9tZS9kYXRhMDEvUHJvamVjdHMvaHVzaGZtL2Zyb250ZW5kL3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9ob21lL2RhdGEwMS9Qcm9qZWN0cy9odXNoZm0vZnJvbnRlbmQvdml0ZS5jb25maWcudHNcIjsvLyB2aXRlLmNvbmZpZy50c1xuaW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSdcbmltcG9ydCBzb2xpZCBmcm9tICd2aXRlLXBsdWdpbi1zb2xpZCdcbmltcG9ydCB0YWlsd2luZGNzcyBmcm9tICd0YWlsd2luZGNzcydcbmltcG9ydCBhdXRvcHJlZml4ZXIgZnJvbSAnYXV0b3ByZWZpeGVyJ1xuaW1wb3J0IGRldnRvb2xzIGZyb20gJ3NvbGlkLWRldnRvb2xzL3ZpdGUnXG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIHBsdWdpbnM6IFtcbiAgICBkZXZ0b29scyh7IGF1dG9uYW1lOiB0cnVlIH0pLFxuICAgIHNvbGlkKClcbiAgXSxcbiAgZW52UHJlZml4OiBbJ1ZJVEVfJywgJ0hVU0hGTV8nXSwgLy8gQWxsb3cgYm90aCBWSVRFXyBhbmQgSFVTSEZNXyBwcmVmaXhlZCBlbnYgdmFyc1xuICBjc3M6IHtcbiAgICBwb3N0Y3NzOiB7XG4gICAgICBwbHVnaW5zOiBbdGFpbHdpbmRjc3MsIGF1dG9wcmVmaXhlcl0sXG4gICAgfSxcbiAgfSxcbiAgcmVzb2x2ZToge1xuICAgIGFsaWFzOiB7ICdAJzogJy9zcmMnIH0sXG4gIH0sXG4gIG9wdGltaXplRGVwczoge1xuICAgIGluY2x1ZGU6IFsnbWVkaWFzb3VwLWNsaWVudCddXG4gIH0sXG4gIHNlcnZlcjoge1xuICAgIHBvcnQ6IHBhcnNlSW50KHByb2Nlc3MuZW52LkhVU0hGTV9GUk9OVEVORF9QT1JUIHx8ICc4MDgwJyksXG4gICAgaG9zdDogdHJ1ZSwgLy8gVGhpcyBsaXN0ZW5zIG9uIDAuMC4wLjAgKEFMTCBpbnRlcmZhY2VzKVxuICAgIHN0cmljdFBvcnQ6IHRydWUsIC8vIEZhaWwgaWYgcG9ydCBpcyB0YWtlblxuICAgIHByb3h5OiB7XG4gICAgICAnL2FwaSc6IHtcbiAgICAgICAgdGFyZ2V0OiBgaHR0cDovL2xvY2FsaG9zdDoke3Byb2Nlc3MuZW52LkhVU0hGTV9CQUNLRU5EX1BPUlQgfHwgJzMwMDAnfWAsXG4gICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcbiAgICAgICAgc2VjdXJlOiBmYWxzZSAvLyBBbGxvdyBzZWxmLXNpZ25lZCBjZXJ0aWZpY2F0ZXMgaW4gZGV2ZWxvcG1lbnRcbiAgICAgIH0sXG4gICAgICAnL3dzJzoge1xuICAgICAgICB0YXJnZXQ6IGBodHRwOi8vbG9jYWxob3N0OiR7cHJvY2Vzcy5lbnYuSFVTSEZNX0JBQ0tFTkRfUE9SVCB8fCAnMzAwMCd9YCxcbiAgICAgICAgd3M6IHRydWUsIC8vIEVuYWJsZSBXZWJTb2NrZXQgcHJveHlpbmdcbiAgICAgICAgY2hhbmdlT3JpZ2luOiB0cnVlLFxuICAgICAgICBzZWN1cmU6IGZhbHNlXG4gICAgICB9LFxuICAgIH0sXG4gIH0sXG4gIGJ1aWxkOiB7XG4gICAgdGFyZ2V0OiAnZXNuZXh0JyxcbiAgICBjaHVua1NpemVXYXJuaW5nTGltaXQ6IDEwMDAsIC8vIEluY3JlYXNlIGxpbWl0IHRvIDFNQiB0byByZWR1Y2Ugd2FybmluZ3NcbiAgICByb2xsdXBPcHRpb25zOiB7XG4gICAgICBvdXRwdXQ6IHtcbiAgICAgICAgbWFudWFsQ2h1bmtzOiB7XG4gICAgICAgICAgLy8gU3BsaXQgdmVuZG9yIGRlcGVuZGVuY2llc1xuICAgICAgICAgICd2ZW5kb3ItZWZmZWN0JzogWydlZmZlY3QnLCAnQGVmZmVjdC9leHBlcmltZW50YWwnLCAnQGVmZmVjdC9wbGF0Zm9ybS1icm93c2VyJ10sXG4gICAgICAgICAgJ3ZlbmRvci1zb2xpZCc6IFsnc29saWQtanMnLCAnQHNvbGlkanMvcm91dGVyJ10sXG4gICAgICAgICAgJ3ZlbmRvci1tZWRpYXNvdXAnOiBbJ21lZGlhc291cC1jbGllbnQnXVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9LFxufSlcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFDQSxTQUFTLG9CQUFvQjtBQUM3QixPQUFPLFdBQVc7QUFDbEIsT0FBTyxpQkFBaUI7QUFDeEIsT0FBTyxrQkFBa0I7QUFDekIsT0FBTyxjQUFjO0FBRXJCLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVM7QUFBQSxJQUNQLFNBQVMsRUFBRSxVQUFVLEtBQUssQ0FBQztBQUFBLElBQzNCLE1BQU07QUFBQSxFQUNSO0FBQUEsRUFDQSxXQUFXLENBQUMsU0FBUyxTQUFTO0FBQUE7QUFBQSxFQUM5QixLQUFLO0FBQUEsSUFDSCxTQUFTO0FBQUEsTUFDUCxTQUFTLENBQUMsYUFBYSxZQUFZO0FBQUEsSUFDckM7QUFBQSxFQUNGO0FBQUEsRUFDQSxTQUFTO0FBQUEsSUFDUCxPQUFPLEVBQUUsS0FBSyxPQUFPO0FBQUEsRUFDdkI7QUFBQSxFQUNBLGNBQWM7QUFBQSxJQUNaLFNBQVMsQ0FBQyxrQkFBa0I7QUFBQSxFQUM5QjtBQUFBLEVBQ0EsUUFBUTtBQUFBLElBQ04sTUFBTSxTQUFTLFFBQVEsSUFBSSx3QkFBd0IsTUFBTTtBQUFBLElBQ3pELE1BQU07QUFBQTtBQUFBLElBQ04sWUFBWTtBQUFBO0FBQUEsSUFDWixPQUFPO0FBQUEsTUFDTCxRQUFRO0FBQUEsUUFDTixRQUFRLG9CQUFvQixRQUFRLElBQUksdUJBQXVCLE1BQU07QUFBQSxRQUNyRSxjQUFjO0FBQUEsUUFDZCxRQUFRO0FBQUE7QUFBQSxNQUNWO0FBQUEsTUFDQSxPQUFPO0FBQUEsUUFDTCxRQUFRLG9CQUFvQixRQUFRLElBQUksdUJBQXVCLE1BQU07QUFBQSxRQUNyRSxJQUFJO0FBQUE7QUFBQSxRQUNKLGNBQWM7QUFBQSxRQUNkLFFBQVE7QUFBQSxNQUNWO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQSxFQUNBLE9BQU87QUFBQSxJQUNMLFFBQVE7QUFBQSxJQUNSLHVCQUF1QjtBQUFBO0FBQUEsSUFDdkIsZUFBZTtBQUFBLE1BQ2IsUUFBUTtBQUFBLFFBQ04sY0FBYztBQUFBO0FBQUEsVUFFWixpQkFBaUIsQ0FBQyxVQUFVLHdCQUF3QiwwQkFBMEI7QUFBQSxVQUM5RSxnQkFBZ0IsQ0FBQyxZQUFZLGlCQUFpQjtBQUFBLFVBQzlDLG9CQUFvQixDQUFDLGtCQUFrQjtBQUFBLFFBQ3pDO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
