@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo   Install Node.js (required)
echo ========================================
echo.

where node >nul 2>&1
if not errorlevel 1 (
  echo [OK] Node.js is already installed:
  node -v
  echo.
  echo You can double-click start.bat to launch.
  pause
  exit /b 0
)

echo Node.js not found. Starting install...
echo.

where winget >nul 2>&1
if errorlevel 1 (
  echo [INFO] winget not found. Opening Node.js download page.
  echo During install, keep defaults and enable Add to PATH.
  start "" "https://nodejs.org/zh-cn"
  pause
  exit /b 1
)

echo Installing Node.js LTS via winget...
echo If a UAC prompt appears, click Yes.
echo.

winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements

echo.
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo [INFO] Install may have finished, but this window cannot see node yet.
  echo Close this window, reopen the folder, then double-click start.bat.
  echo Manual install: https://nodejs.org/zh-cn
) else (
  echo.
  echo [OK] Installed:
  node -v
  npm -v
  echo.
  echo Next: double-click start.bat
)

echo.
pause
