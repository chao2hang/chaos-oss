import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev: proxy API/download traffic to the Go backend on :5244.
// Build: emit straight into the repo's public/dist so the Go binary can
// embed / serve it exactly like the old downloaded OpenList-Frontend dist.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': { target: 'http://127.0.0.1:5244', changeOrigin: false },
      '/d': { target: 'http://127.0.0.1:5244', changeOrigin: false },
      '/p': { target: 'http://127.0.0.1:5244', changeOrigin: false },
      '/ping': { target: 'http://127.0.0.1:5244', changeOrigin: false },
      '/manifest.json': { target: 'http://127.0.0.1:5244', changeOrigin: false },
      '/favicon.ico': { target: 'http://127.0.0.1:5244', changeOrigin: false },
    },
  },
  build: {
    outDir: '../public/dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
})
