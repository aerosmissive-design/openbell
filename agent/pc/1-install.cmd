@echo off
setlocal
cd /d "%~dp0"
title OpenBell PC Agent - Install

echo ============================================
echo   OpenBell PC Agent - Install (local only)
echo ============================================
echo.

echo [1/4] Checking Node.js...
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js LTS is not installed. Installing with winget...
  where winget >nul 2>&1
  if errorlevel 1 (
    echo winget is not available. Install Node.js LTS from https://nodejs.org/ then re-run.
    start https://nodejs.org/
    pause
    exit /b 1
  )
  winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    echo Node.js installation failed.
    pause
    exit /b 1
  )
  rem Refresh PATH for this session (common Node install locations).
  set "PATH=%ProgramFiles%\nodejs;%LocalAppData%\Programs\nodejs;%PATH%"
)

where node >nul 2>&1
if errorlevel 1 (
  set "PATH=%ProgramFiles%\nodejs;%LocalAppData%\Programs\nodejs;%PATH%"
)
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found after install.
  echo Close this window, open a NEW Command Prompt, then run 1-install.cmd again.
  echo If it still fails, reboot once so PATH updates, then re-run.
  pause
  exit /b 1
)

echo Node.js OK:
call node -v
call npm -v

echo.
echo [2/4] npm install LOCAL to agent\pc only...
call npm install
if errorlevel 1 (
  echo npm install failed.
  pause
  exit /b 1
)

echo.
echo [3/4] Installing Playwright Chromium...
call npx playwright install chromium
if errorlevel 1 (
  echo Playwright Chromium install failed.
  pause
  exit /b 1
)

echo.
echo [4/4] Checking config.env...
if not exist "%~dp0config.env" (
  copy /y "%~dp0config.env.example" "%~dp0config.env" >nul
  echo config.env created from config.env.example
  echo Edit config.env, then run 2-run.cmd
) else (
  echo config.env already exists.
)

echo.
echo ============================================
echo Install complete. Read START.txt
echo Checklist:
echo   1. Edit config.env (movie/date/showtime; optional BOOKING_URL)
echo   2. Optional: 4-save-login.cmd  (manual CGV login, then save session)
echo   3. Optional: 3-doctor.cmd
echo   4. Run 2-run.cmd
echo Dry-run: leave NAS_WORKER_TOKEN empty → result code B
echo Linked: set OPENBELL_URL + NAS_WORKER_TOKEN → result code A
echo Safety: no payment click, no CAPTCHA bypass.
echo ============================================
echo.
pause
