/// <reference types="vite/client" />

interface ImportMetaEnv {
  // HushFM service configuration variables
  readonly HUSHFM_BACKEND_PORT?: string
  readonly HUSHFM_FRONTEND_PORT?: string
  readonly HUSHFM_HOST_NAME?: string
  
  // Vite built-in
  readonly DEV: boolean
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}