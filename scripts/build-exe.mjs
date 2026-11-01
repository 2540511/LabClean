// 打包桌面版：把 Rust 工具链固定在项目内 .rust 目录，构建前自动设好环境变量。
// 用法：node scripts/build-exe.mjs [--bundle]
//   不带参数 -> 只产出免安装的单个 exe（src-tauri/target/release/labclean.exe）
//   带 --bundle -> 额外打 NSIS 安装包（需要联网下载 NSIS，较慢）
import { existsSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const cargoHome = join(root, '.rust', 'cargo')
const rustupHome = join(root, '.rust', 'rustup')
const cli = join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')

// 临时目录也放项目里：系统 %TEMP% 在受限环境里可能删不掉文件，esbuild 会因此失败
const tmpDir = join(root, '.tmp', 'build-tmp')
mkdirSync(tmpDir, { recursive: true })

if (!existsSync(join(cargoHome, 'bin', 'cargo.exe'))) {
  console.error('没找到 Rust 工具链，先运行：npm run rust:install')
  process.exit(1)
}
if (!existsSync(cli)) {
  console.error('没找到 @tauri-apps/cli，请先 npm install')
  process.exit(1)
}

const env = {
  ...process.env,
  CARGO_HOME: cargoHome,
  RUSTUP_HOME: rustupHome,
  PATH: `${join(cargoHome, 'bin')};${process.env.PATH ?? ''}`,
  RUSTUP_DIST_SERVER: 'https://mirrors.tuna.tsinghua.edu.cn/rustup',
  TEMP: tmpDir,
  TMP: tmpDir,
}

const args = [cli, 'build']
if (!process.argv.includes('--bundle')) args.push('--no-bundle')

const started = Date.now()
const res = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env })
const secs = ((Date.now() - started) / 1000).toFixed(0)

if (res.status === 0) {
  console.log(`\n构建完成（${secs}s）`)
  console.log(`免安装 exe: ${join(root, 'src-tauri', 'target', 'release', 'labclean.exe')}`)
} else {
  console.error(`构建失败（退出码 ${res.status}）`)
}
process.exit(res.status ?? 1)
