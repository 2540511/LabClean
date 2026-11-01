@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo ================================
echo   LabClean - build desktop exe
echo ================================
echo.
set "NODE="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE set "NODE=%%i"
if not defined NODE (
  for /f "delims=" %%i in ('powershell -NoProfile -Command "Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA dsh-tools\node),(Join-Path $env:ProgramFiles nodejs) -Filter node.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName"') do set "NODE=%%i"
)
if not defined NODE (
  echo [ERROR] Node.js not found. Install from https://nodejs.org
  pause
  exit /b 1
)
echo [OK] Node: %NODE%
echo.
if not exist "node_modules\@tauri-apps\cli\tauri.js" (
  echo Installing dependencies, about 1 minute...
  call npm install --ignore-scripts --no-audit --no-fund
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)
if not exist ".rust\cargo\bin\cargo.exe" (
  echo [ERROR] Rust toolchain missing. See README desktop section.
  pause
  exit /b 1
)
echo [OK] Dependencies ready.
echo.
echo Building... 1-3 minutes on first run.
echo.
"%NODE%" scripts\build-exe.mjs
if errorlevel 1 (
  echo.
  echo [ERROR] Build failed. Send the output above to the assistant.
  pause
  exit /b 1
)
if not exist "release" mkdir "release"
copy /y "src-tauri\target\release\labclean.exe" "release\LabClean.exe" >nul
echo.
echo [OK] Done: %~dp0release\LabClean.exe
pause
