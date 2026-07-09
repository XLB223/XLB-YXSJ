@echo off
cd /d "%~dp0"

echo ========================================
echo   Pack for Tencent Cloud
echo   Domain: www.kjdsai.cn
echo ========================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\pack-deploy.ps1"
if errorlevel 1 (
    echo.
    echo [ERROR] Pack failed.
    pause
    exit /b 1
)

echo Next steps:
echo   1. Upload kjdsai-listing-deploy.zip to server
echo   2. Unzip in project folder (keep .env)
echo   3. Run: pm2 restart listing-ai
echo.
echo URLs:
echo   https://www.kjdsai.cn
echo   https://www.kjdsai.cn/mobile/
echo.
pause
