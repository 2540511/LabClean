# 启动 LabClean（已构建好的静态版本）
# 用法：右键「使用 PowerShell 运行」，或  powershell -ExecutionPolicy Bypass -File .\start.ps1
param([int]$Port = 5173)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# 优先用系统 PATH 里的 node，退回到本机自带的 node
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$nodeExe = if ($nodeCmd) { $nodeCmd.Source } else {
  'C:\Users\lhlan\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
}

if (-not (Test-Path (Join-Path $root 'dist\index.html'))) {
  Write-Host '还没有 dist/，先构建： (需要允许 esbuild 启动子进程)' -ForegroundColor Yellow
  Write-Host '  set TEMP=%CD%\.tmp && set TMP=%CD%\.tmp && pnpm run build'
}

$env:PORT = "$Port"
Write-Host "LabClean 预览地址: http://127.0.0.1:$Port" -ForegroundColor Green
Write-Host '按 Ctrl+C 结束'
Push-Location $root
try { & $nodeExe 'scripts\serve.mjs' } finally { Pop-Location }
