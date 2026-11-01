import { writeFileSync } from 'node:fs'
const url = 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe'
const res = await fetch(url)
if (!res.ok) { console.error('download failed', res.status); process.exit(1) }
const buf = Buffer.from(await res.arrayBuffer())
writeFileSync(process.argv[2], buf)
console.log('downloaded', buf.length, 'bytes')
