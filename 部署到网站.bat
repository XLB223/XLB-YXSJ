@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo   部署网站
echo   主域名: www.kjdsai.cn （腾讯云）
echo ========================================
echo.
echo 你使用的是【腾讯云】，请双击:
echo   部署到腾讯云.bat
echo.
echo 若使用 Vercel 备用部署，可继续本脚本。
echo.
pause

call 部署到腾讯云.bat
