@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo   Environment check
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [X] Node.js not installed - visit https://nodejs.org
) else (
  echo [OK] Node.js:
  node -v
)

echo.
if exist .env (echo [OK] .env exists) else (echo [!] Missing .env file)

echo.
if exist assets\payment\wechat-pay.png (echo [OK] WeChat QR) else (echo [X] Missing assets\payment\wechat-pay.png)
if exist assets\payment\alipay-pay.png (echo [OK] Alipay QR) else (echo [X] Missing assets\payment\alipay-pay.png)

echo.
echo Checking port 5173...
netstat -ano | findstr :5173
if errorlevel 1 (
  echo [OK] Port 5173 is free
) else (
  echo [!] Port 5173 is in use. Try: taskkill /F /IM node.exe
)

echo.
echo Testing local connection...
curl -s -o nul -w "HTTP %%{http_code}\n" http://127.0.0.1:5173/api/health 2>nul
if errorlevel 1 (
  echo [X] Cannot reach server - run start.bat first
)

echo.
echo Correct URL: http://127.0.0.1:5173
echo Do not open index.html directly
echo.
pause
