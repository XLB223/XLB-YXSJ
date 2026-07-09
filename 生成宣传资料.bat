@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo   Generate promo materials
echo ========================================
echo.

if exist "跨境AI Listing生成器-宣传推广资料.doc" (
  echo [OK] Word pack found:
  echo      跨境AI Listing生成器-宣传推广资料.doc
) else (
  echo [INFO] Word pack not found
)

echo.
echo Trying to generate PPT one-pager...
where node >nul 2>&1
if errorlevel 1 (
  echo [SKIP] Node.js not installed, cannot generate PPT
  goto open_doc
)

call npm install pptxgenjs --no-save >nul 2>&1
node scripts/generate-promo-deck.mjs
if exist "跨境AI Listing生成器-宣传一页纸.pptx" (
  echo [OK] PPT generated: 跨境AI Listing生成器-宣传一页纸.pptx
)

:open_doc
echo.
echo Opening Word pack...
start "" "跨境AI Listing生成器-宣传推广资料.doc"
if exist "跨境AI Listing生成器-宣传一页纸.pptx" start "" "跨境AI Listing生成器-宣传一页纸.pptx"
pause
