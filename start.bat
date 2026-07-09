@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo   Cross-border AI Listing Generator
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found
  echo Install LTS from: https://nodejs.org
  echo Or double-click install-node.bat
  echo Then close this window and run start.bat again
  pause
  exit /b 1
)

echo [OK] Node.js installed
node -v
echo.

if not exist .env (
  echo [WARN] .env not found
  echo Copy .env.example to .env and set DEEPSEEK_API_KEY
  echo.
)

echo Important: do not open index.html directly
echo URL:     http://127.0.0.1:5173
echo Mobile:  http://127.0.0.1:5173/mobile/
echo.
echo Starting server (keep this window open)...
echo.

node server.mjs
if errorlevel 1 (
  echo.
  echo [ERROR] Server failed to start
  echo Common causes:
  echo   1. Port 5173 in use - close other node windows
  echo   2. Run: taskkill /F /IM node.exe  then start.bat again
  echo.
)

pause
