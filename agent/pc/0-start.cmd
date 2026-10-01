@echo off
setlocal
cd /d "%~dp0"
title OpenBell PC Agent
echo ========================================
echo OpenBell PC Agent 0-start  v2.0.17
echo install, doctor, then poll
echo payment button is never clicked
echo ========================================
echo.
echo [1/4] Node.js
where node >nul 2>&1
if errorlevel 1 (
  echo [FAIL] Node.js is missing.
  echo Install the LTS from https://nodejs.org then run this file again.
  start https://nodejs.org/
  pause
  exit /b 1
)
echo Node.js OK.
echo.
echo [2/4] dependencies
if exist package-lock.json (
  call npm ci
) else (
  echo package-lock.json missing. Using npm install.
  call npm install
)
if errorlevel 1 (
  echo [FAIL] dependency install failed.
  pause
  exit /b 1
)
echo.
echo [3/4] doctor
call npx tsx src/doctor.ts
if errorlevel 1 (
  echo [FAIL] doctor failed. Read the lines above.
  echo Login: run advanced\4-save-login.cmd and log in yourself. No password is typed.
  pause
  exit /b 1
)
echo.
echo [4/4] poll mode
echo AGENT_MODE=poll. Waits for a web job. Sample movie name is not used.
set AGENT_MODE=poll
call npx tsx src/cli.ts
echo.
echo Agent stopped. If this is an error, copy this window.
pause
exit /b %ERRORLEVEL%
