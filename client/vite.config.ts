import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  worker: {
    // face.worker.ts is loaded with { type: 'module' }
    format: 'es',
  },
  build: {
    // face-api bundles TensorFlow.js; keep it in its own lazily loaded chunk
    chunkSizeWarningLimit: 1600,
  },
})
