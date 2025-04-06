import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['stockfish'] // Keep this if it helped before, shouldn't hurt
  },
  // --- Add this 'server' section ---
  server: {
    headers: {
      // Enable SharedArrayBuffer
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  // --- End of added section ---
})