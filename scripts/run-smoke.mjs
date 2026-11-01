// 用 esbuild 把核心逻辑打成单文件，再用 node 跑断言。
// esbuild 由 vite 自带，不需要额外安装。
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

/** 项目内 .tmp 写不进去时（某些受限目录），退到上一级目录，保证冒烟测试总能跑 */
function pickTmpDir() {
  const candidates = [join(root, '.tmp'), join(dirname(root), '.labclean-tmp')]
  for (const dir of candidates) {
    try {
      mkdirSync(dir, { recursive: true })
      const probe = join(dir, '.write-test')
      writeFileSync(probe, 'x')
      unlinkSync(probe)
      return dir
    } catch {
      // 这个目录不可写，试下一个
    }
  }
  throw new Error('找不到可写的临时目录')
}

const outFile = join(pickTmpDir(), 'smoke.cjs')

const esbuild = join(root, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe')
if (!existsSync(esbuild)) {
  console.error('找不到 esbuild 可执行文件，请先运行 npm install')
  process.exit(1)
}

const build = spawnSync(
  esbuild,
  [join(root, 'scripts', 'smoke.ts'), '--bundle', '--platform=node', '--format=cjs', `--outfile=${outFile}`],
  { stdio: 'inherit', cwd: root },
)
if (build.status !== 0) process.exit(build.status ?? 1)

const run = spawnSync(process.execPath, [outFile], { stdio: 'inherit', cwd: root })
process.exit(run.status ?? 1)
