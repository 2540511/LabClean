import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' 让产物可以直接用相对路径部署（Tauri / 局域网静态站都能用）
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    host: '127.0.0.1',
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4096,
  },
  worker: {
    format: 'es',
  },
})
