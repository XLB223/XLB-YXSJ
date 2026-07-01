@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo   跨境 AI Listing 生成器 - 启动中...
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [错误] 未检测到 Node.js
  echo 请先安装: https://nodejs.org
  echo 安装后关闭此窗口，重新双击 start.bat
  pause
  exit /b 1
)

echo [OK] Node.js 已安装
node -v
echo.

if not exist .env (
  echo [警告] 未找到 .env 文件
  echo 请复制 .env.example 为 .env 并填入 DEEPSEEK_API_KEY
  echo.
)

echo 正在启动服务器...
echo.
echo 重要: 不要直接双击 index.html
echo 浏览器将打开: http://127.0.0.1:5173
echo 按 Ctrl+C 可停止
echo.

timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:5173"
node server.mjs

pause
