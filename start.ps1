# 启动 LabClean（已构建好的静态版本）
# 用法：右键「使用 PowerShell 运行」，或在终端执行：
#   powershell -ExecutionPolicy Bypass -File .\start.ps1
param([int]$Port = 5173)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# 找 node：先查 PATH，再查几个常见安装位置（不要硬编码某台机器的路径）
$nodeExe = $null
$cmd = Get-Command node -ErrorAction SilentlyContinue
if ($cmd) { $nodeExe = $cmd.Source }
if (-not $nodeExe) {
  $candidates = @(
    (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
  )
  # 兜底：有些环境会把 node 装在工具链目录里
  $dsh = Join-Path $env:LOCALAPPDATA 'dsh-tools'
  if (Test-Path $dsh) {
    $candidates += Get-ChildItem $dsh -Recurse -Filter node.exe -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty FullName
  }
  $nodeExe = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}

if (-not $nodeExe) {
  Write-Host '没有找到 Node.js。请先安装：https://nodejs.org （选 LTS 版本），装完重新打开这个窗口。' -ForegroundColor Red
  Read-Host '按回车关闭'
  exit 1
}

if (-not (Test-Path (Join-Path $root 'dist\index.html'))) {
  Write-Host '还没有 dist/ 目录，先构建一次：' -ForegroundColor Yellow
  Write-Host "  cd `"$root`""
  Write-Host '  npm install'
  Write-Host '  npm run build'
  Write-Host '（如果构建时报 esbuild 子进程失败，把临时目录指到项目内再试：set TEMP=%CD%\.tmp）'
  Read-Host '按回车关闭'
  exit 1
}

$env:PORT = "$Port"
Write-Host "LabClean 预览地址: http://127.0.0.1:$Port" -ForegroundColor Green
Write-Host '按 Ctrl+C 结束'
Push-Location $root
try { & $nodeExe 'scripts\serve.mjs' } finally { Pop-Location }