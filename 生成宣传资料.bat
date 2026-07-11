@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo   Generate promo materials
echo ========================================
echo.

echo Generating Word promo pack...
where python >nul 2>&1
if errorlevel 1 (
  echo [SKIP] Python not installed, cannot generate Word
) else (
  pip install python-docx -q >nul 2>&1
  python generate-promo.py
  if exist "跨境AI Listing生成器-宣传推广资料.docx" (
    echo [OK] Word generated: 跨境AI Listing生成器-宣传推广资料.docx
  )
)

echo.
echo Generating PPT one-pager...
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
echo Opening promo materials...
if exist "跨境AI Listing生成器-宣传推广资料.docx" start "" "跨境AI Listing生成器-宣传推广资料.docx"
if exist "跨境AI Listing生成器-宣传一页纸.pptx" start "" "跨境AI Listing生成器-宣传一页纸.pptx"
pause
