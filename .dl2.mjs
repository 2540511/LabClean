import { createWriteStream, statSync } from 'node:fs'
const url = 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe'
const out = process.argv[2]
const res = await fetch(url)
if (!res.ok) { console.error('HTTP', res.status); process.exit(1) }
const total = Number(res.headers.get('content-length') || 0)
console.log('content-length', total)
const ws = createWriteStream(out)
const reader = res.body.getReader()
let got = 0
const t0 = Date.now()
for (;;) {
  const { done, value } = await reader.read()
  if (done) break
  got += value.length
  ws.write(Buffer.from(value))
}
ws.end()
console.log('done', got, 'bytes in', Date.now() - t0, 'ms')
