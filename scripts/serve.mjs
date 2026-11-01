// 零依赖静态预览服务器：只读 dist/ 目录，用于本地看效果或局域网共享。
// 用法：node scripts/serve.mjs   （默认 http://127.0.0.1:5173）
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(dirname(fileURLToPath(import.meta.url))), 'dist')
const port = Number(process.env.PORT ?? 5173)
const host = process.env.HOST ?? '127.0.0.1'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
}

const server = createServer(async (req, res) => {
  try {
    const rawPath = decodeURIComponent((req.url ?? '/').split('?')[0])
    const relPath = rawPath === '/' || rawPath === '' ? '/index.html' : rawPath
    const filePath = normalize(join(root, relPath))
    if (!filePath.startsWith(root + sep) && filePath !== join(root, 'index.html')) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('403 Forbidden')
      return
    }
    const data = await readFile(filePath)
    res.writeHead(200, {
      'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    })
    res.end(data)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('404 Not Found')
  }
})

server.listen(port, host, () => {
  console.log(`LabClean 预览已启动: http://${host}:${port}`)
  console.log('按 Ctrl+C 结束')
})
