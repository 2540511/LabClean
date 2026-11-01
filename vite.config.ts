import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 桌面版（Tauri）里模块脚本带 crossorigin 会变成 CORS 模式请求，
// 自定义协议下容易拿不到资源，直接在产物里去掉这个属性。
const stripCrossorigin = {
  name: 'strip-crossorigin',
  enforce: 'post' as const,
  transformIndexHtml(html: string) {
    return html.replace(/\s+crossorigin(?=[\s>])/g, '')
  },
}

// base: './' 让产物可以直接用相对路径部署（Tauri / 局域网静态站都能用）
export default defineConfig({
  plugins: [react(), stripCrossorigin],
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
