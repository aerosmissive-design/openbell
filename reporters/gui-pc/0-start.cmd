@echo off
cd /d "%~dp0"
echo OpenBell reporter v11.28
echo [1/3] Node.js
where node >nul 2>&1
if errorlevel 1 (
  echo [FAIL] Node.js missing. https://nodejs.org
  start https://nodejs.org/
  pause
  exit /b 1
)
echo [2/3] playwright-core
if not exist node_modules\playwright-core call npm install playwright-core
if errorlevel 1 (
  echo [FAIL] playwright-core install failed.
  pause
  exit /b 1
)
echo [3/3] start
echo Edge profile folder: %~dp0edge-profile
echo This is not your normal Edge profile.
node scrape.js
if errorlevel 1 echo [FAIL] reporter stopped. Copy this window.
pause
