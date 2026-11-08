// 零依赖静态预览服务器：只读 dist/ 目录，用于本地看效果或局域网共享。
// 用法：node scripts/serve.mjs   （默认 http://127.0.0.1:5173）
// 端口被占用时自动向后找空闲端口；设 LAB_CLEAN_OPEN_BROWSER=1 可在启动后自动打开浏览器。
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = join(dirname(dirname(fileURLToPath(import.meta.url))), 'dist')
const basePort = Number(process.env.PORT ?? 5173)
const host = process.env.HOST ?? '127.0.0.1'
const MAX_TRIES = 10
const shouldOpen = process.env.LAB_CLEAN_OPEN_BROWSER === '1' && !process.env.LAB_CLEAN_NO_BROWSER

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

function openBrowser(url) {
  if (!shouldOpen) return
  // 用参数数组而不是拼 shell 字符串：HOST 来自环境变量，拼字符串会有注入风险。
  // Windows 必须用绝对路径：有些环境的 PATH 里没有 System32，直接写 rundll32.exe 会 ENOENT。
  const sysRoot = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows'
  const [cmd, args] =
    process.platform === 'win32'
      ? [join(sysRoot, 'System32', 'rundll32.exe'), ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
  try {
    const child = spawn(cmd, args, { windowsHide: true, stdio: 'ignore', detached: true })
    // spawn 失败走的是异步 'error' 事件，不是 try/catch：
    // 不监听的话 Node 会当成未捕获异常，把整个服务带崩（浏览器打不开不该影响访问）。
    child.on('error', () => {
      console.log(`没能自动打开浏览器，请手动访问：${url}`)
    })
    child.unref()
  } catch {
    console.log(`没能自动打开浏览器，请手动访问：${url}`)
  }
}

// 端口被占时先确认占着它的是不是本项目，避免重复开一份
async function isLabCleanOn(port) {
  try {
    const res = await fetch(`http://${host}:${port}/`, { signal: AbortSignal.timeout(1000) })
    return (await res.text()).includes('LabClean')
  } catch {
    return false
  }
}

let port = basePort

server.on('error', async (err) => {
  if (err.code !== 'EADDRINUSE') {
    console.error(`启动失败：${err.message}`)
    process.exit(1)
  }
  if (await isLabCleanOn(port)) {
    const url = `http://${host}:${port}/`
    console.log(`LabClean 已经在运行：${url}`)
    openBrowser(url)
    process.exit(0)
  }
  if (port - basePort >= MAX_TRIES) {
    console.error(`端口 ${basePort}-${basePort + MAX_TRIES} 都被占用，请用 PORT=xxxx 指定一个空闲端口`)
    process.exit(1)
  }
  console.log(`端口 ${port} 已被占用，改用 ${port + 1}`)
  port += 1
  server.listen(port, host)
})

server.listen(port, host, () => {
  const actual = server.address().port
  const url = `http://${host}:${actual}/`
  console.log(`LabClean 预览已启动: ${url}`)
  console.log('按 Ctrl+C 结束')
  openBrowser(url)
})
