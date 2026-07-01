@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在生成 Word 说明书...
pip install python-docx -q
python generate-manual.py
if exist "跨境AI Listing生成器-使用说明书.docx" (
  echo 已生成: 跨境AI Listing生成器-使用说明书.docx
  start "" "跨境AI Listing生成器-使用说明书.docx"
) else (
  echo python-docx 生成失败，请直接打开: 跨境AI Listing生成器-使用说明书.doc
  start "" "跨境AI Listing生成器-使用说明书.doc"
)
pause
