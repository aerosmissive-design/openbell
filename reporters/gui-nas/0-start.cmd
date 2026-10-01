@echo off
cd /d "%~dp0"
echo OpenBell NAS reporter v11.28
echo [1/2] Node.js
where node >nul 2>&1
if errorlevel 1 (
  echo [FAIL] Node.js missing.
  pause
  exit /b 1
)
echo [2/2] start
node scrape.js
if errorlevel 1 echo [FAIL] reporter stopped. Copy this window.
pause
