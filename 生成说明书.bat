@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Generating Word manual...
pip install python-docx -q
python generate-manual.py
if exist "跨境AI Listing生成器-使用说明书.docx" (
  echo Generated: 跨境AI Listing生成器-使用说明书.docx
  start "" "跨境AI Listing生成器-使用说明书.docx"
) else (
  echo python-docx failed. Opening: 跨境AI Listing生成器-使用说明书.doc
  start "" "跨境AI Listing生成器-使用说明书.doc"
)
pause
