@echo off
setlocal
cd /d "%~dp0"
title OpenBell PC Agent
echo ========================================
echo OpenBell PC Agent 2.0.17
echo one click: install, check, poll
echo payment button is never clicked
echo ========================================
echo.
echo [1/4] Node.js
where node >nul 2>&1
if errorlevel 1 (
  echo [FAIL] Node.js missing. Opening https://nodejs.org
  start https://nodejs.org/
  pause
  exit /b 1
)
echo Node.js OK.
echo.
echo [2/4] dependencies
if not exist node_modules (
  if exist package-lock.json (
    call npm ci
  ) else (
    echo package-lock.json missing. npm install
    call npm install
  )
  if errorlevel 1 (
    echo [FAIL] dependency install failed.
    pause
    exit /b 1
  )
) else (
  echo node_modules exists. skip install.
)
if not exist config.env (
  echo OPENBELL_URL=https://openbell-fawn.vercel.app> config.env
  echo NAS_WORKER_TOKEN=99159915>> config.env
  echo AGENT_MODE=poll>> config.env
  echo [OK] config.env created
) else (
  echo config.env exists. left as-is.
)
echo.
echo [3/4] doctor
set AGENT_MODE=poll
call npx tsx src/doctor.ts
if errorlevel 1 (
  echo [FAIL] doctor failed. Read the lines above.
  pause
  exit /b 1
)
if not exist cgv-storage.json (
  echo [LOGIN] No saved CGV session.
  echo A browser will open. Log in yourself. This program does not type the password.
  echo After login, press Enter in that window, then this continues.
  call "%~dp0advanced\4-save-login.cmd"
)
echo.
echo [4/4] poll
echo Waiting for a job from the website.
echo Do not run the NAS booker on the same show.
set AGENT_MODE=poll
call npx tsx src/cli.ts
echo.
echo Agent stopped. Copy this window if it failed.
pause
exit /b %ERRORLEVEL%
