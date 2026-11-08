@echo off
setlocal EnableExtensions
chcp 65001 >nul
title LabClean Launcher
cd /d "%~dp0"

rem Optional: this-file 5174  (use another port)
set "PORT=%~1"
if not defined PORT set "PORT=5173"

if not exist ".tmp" mkdir ".tmp"
set "LOG=%~dp0.tmp\launcher.log"
>>"%LOG%" echo ===== launcher start %DATE% %TIME% =====
>>"%LOG%" echo cwd=%CD% port=%PORT%

echo ==================================
echo   LabClean - Lab Data Cleaner
echo ==================================
echo.

rem ---------- locate Node.js ----------
set "NODE="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE set "NODE=%%i"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\node.exe" set "NODE=%LOCALAPPDATA%\Microsoft\WinGet\Links\node.exe"
if not defined NODE goto :no_node
for %%I in ("%NODE%") do set "NODE_DIR=%%~dpI"
>>"%LOG%" echo [1/4] node=%NODE%

rem ---------- build once if dist is missing ----------
if exist "dist\index.html" goto :serve
>>"%LOG%" echo [2/4] dist missing, building
echo First run: building frontend...
set "TEMP=%CD%\.tmp"
set "TMP=%CD%\.tmp"
if not exist "%NODE_DIR%npm.cmd" goto :no_npm
if not exist "node_modules" (
  echo Installing dependencies, needs network...
  call "%NODE_DIR%npm.cmd" install --no-audit --no-fund
  if errorlevel 1 goto :failed
)
call "%NODE_DIR%npm.cmd" run build
if errorlevel 1 goto :failed
>>"%LOG%" echo [3/4] build done

:serve
>>"%LOG%" echo [4/4] serving on port %PORT%
echo Starting LabClean...
echo   The address will be shown below and opened in your browser.
echo   Keep this window open. Close it to stop LabClean.
echo.
set "LAB_CLEAN_OPEN_BROWSER=1"
"%NODE%" "scripts\serve.mjs"
set "CODE=%errorlevel%"
>>"%LOG%" echo serve exited, code=%CODE%
echo.
echo LabClean stopped. Exit code: %CODE%
echo If this was not expected, see .tmp\launcher.log
echo.
if not defined LAB_CLEAN_NO_PAUSE pause
exit /b %CODE%

:no_node
>>"%LOG%" echo ERROR: node not found
echo [ERROR] Node.js not found.
echo         Install the LTS version from https://nodejs.org, then run this file again.
echo.
if not defined LAB_CLEAN_NO_PAUSE pause
exit /b 1

:no_npm
>>"%LOG%" echo ERROR: npm not found
echo [ERROR] npm was not found next to Node.js.
echo         Reinstall Node.js LTS from https://nodejs.org, then run this file again.
echo.
if not defined LAB_CLEAN_NO_PAUSE pause
exit /b 1

:failed
>>"%LOG%" echo ERROR: build failed
echo.
echo [ERROR] Build failed. Read the messages above.
echo.
if not defined LAB_CLEAN_NO_PAUSE pause
exit /b 1
