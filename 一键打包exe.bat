@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ========================================
echo   LabClean 桌面版打包
echo ========================================
echo.

echo [1/3] 查找 Node.js ...
set "NODE="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE set "NODE=%%i"
if not defined NODE (
  for /f "delims=" %%i in ('powershell -NoProfile -Command "Get-ChildItem -Path \"$env:LOCALAPPDATA\dsh-tools\node\",\"$env:ProgramFiles\nodejs\",\"$env:LOCALAPPDATA\Programs\nodejs\" -Filter node.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName"') do set "NODE=%%i"
)
if not defined NODE (
  echo.
  echo   没找到 Node.js。请先安装：https://nodejs.org  ^(选 LTS 版本^)
  echo.
  pause
  exit /b 1
)
echo   使用: !NODE!

echo.
echo [2/3] 检查依赖和 Rust 工具链 ...
if not exist "node_modules\@tauri-apps\cli\tauri.js" (
  echo   缺少依赖，正在安装（首次约 1 分钟）...
  call npm install --ignore-scripts --no-audit --no-fund
  if errorlevel 1 (
    echo   依赖安装失败。
    pause
    exit /b 1
  )
)
if not exist ".rust\cargo\bin\cargo.exe" (
  echo   缺少 Rust 工具链，见 README 的「桌面版」一节。
  pause
  exit /b 1
)
echo   依赖和工具链就绪。

echo.
echo [3/3] 开始打包（首次约 2-3 分钟，之后约 1 分钟）...
echo.
"!NODE!" scripts\build-exe.mjs
set "CODE=%errorlevel%"

echo.
if "%CODE%"=="0" (
  echo ========================================
  echo   打包成功
  echo   产物: %~dp0release\LabClean.exe
  echo ========================================
  if exist "src-tauri\target\release\labclean.exe" (
    if not exist "release" mkdir "release"
    copy /y "src-tauri\target\release\labclean.exe" "release\LabClean.exe" >nul
    echo   已复制到 release\LabClean.exe
  )
) else (
  echo   打包失败，退出码 %CODE%
  echo   把上面的输出发给我看看。
)
echo.
pause
