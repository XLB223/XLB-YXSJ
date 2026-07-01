@echo off
cd /d "%~dp0"
echo === npm install === > test-result.txt
call npm install >> test-result.txt 2>&1
echo NPM_EXIT=%ERRORLEVEL%>> test-result.txt
echo.>> test-result.txt
echo === API test ===>> test-result.txt
node test-api.mjs >> test-result.txt 2>&1
echo NODE_EXIT=%ERRORLEVEL%>> test-result.txt
echo Done. See test-result.txt
