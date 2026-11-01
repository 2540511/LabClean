// 打包桌面版：把 Rust 工具链固定在项目内 .rust 目录，构建前自动设好环境变量。
// 用法：node scripts/build-exe.mjs [--bundle]
//   不带参数 -> 只产出免安装的单个 exe（src-tauri/target/release/labclean.exe）
//   带 --bundle -> 额外打 NSIS 安装包（需要联网下载 NSIS，较慢）
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
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

/** 找到 VS 的 vcvars64.bat（cargo 链接时要用它的 link.exe 和 LIB/INCLUDE） */
function findVcvars() {
  const vswhere = `${process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'}\\Microsoft Visual Studio\\Installer\\vswhere.exe`
  if (existsSync(vswhere)) {
    const r = spawnSync(
      vswhere,
      ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'],
      { encoding: 'utf8' },
    )
    const base = (r.stdout ?? '').trim()
    if (base) {
      const p = join(base, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat')
      if (existsSync(p)) return p
    }
  }
  const fallbacks = [
    'D:\\APPYUANWENJIAN\\VS2026\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat',
    `${process.env['ProgramFiles'] ?? 'C:\\Program Files'}\\Microsoft Visual Studio\\2022\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat`,
  ]
  return fallbacks.find((p) => existsSync(p)) ?? null
}

/** 读一遍 vcvars 设置的环境变量（重定向到文件，避免管道） */
function msvcEnv() {
  const bat = findVcvars()
  if (!bat) {
    console.warn('⚠ 没找到 Visual Studio 的 vcvars64.bat，如果链接阶段报找不到 link.exe，请安装 VS C++ 生成工具')
    return {}
  }
  const outFile = join(tmpDir, 'vcenv.txt')
  const r = spawnSync('cmd', ['/c', `call "${bat}" >nul 2>&1 && set > "${outFile}"`], { stdio: 'ignore' })
  if (r.status !== 0 || !existsSync(outFile)) return {}
  const env = {}
  for (const line of readFileSync(outFile, 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=')
    if (i <= 0) continue
    env[line.slice(0, i)] = line.slice(i + 1)
  }
  try {
    unlinkSync(outFile)
  } catch {
    /* 删不掉也无所谓 */
  }
  return env
}

if (!existsSync(join(cargoHome, 'bin', 'cargo.exe'))) {
  console.error('没找到 Rust 工具链，先运行：npm run rust:install')
  process.exit(1)
}
if (!existsSync(cli)) {
  console.error('没找到 @tauri-apps/cli，请先 npm install')
  process.exit(1)
}

const msvc = msvcEnv()

const env = {
  ...process.env,
  ...msvc,
  CARGO_HOME: cargoHome,
  RUSTUP_HOME: rustupHome,
  PATH: `${join(cargoHome, 'bin')};${msvc.PATH ?? process.env.PATH ?? ''}`,
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
