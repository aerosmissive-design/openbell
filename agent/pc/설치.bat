@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0..\.."
title OpenBell PC Booking Agent Installer

echo ============================================
echo   OpenBell PC Booking Agent - One Click
echo ============================================
echo.

echo [1/4] Checking Node.js...
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js LTS is not installed. Installing with winget...
  where winget >nul 2>&1
  if errorlevel 1 (
    echo winget is not available. Please install Node.js LTS and run this again.
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
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
)

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found after installation. Reboot and run this file again.
  pause
  exit /b 1
)

echo [2/4] Installing project dependencies...
npm install
if errorlevel 1 (
  echo npm install failed.
  pause
  exit /b 1
)

echo [3/4] Installing Playwright Chromium...
npx playwright install chromium
if errorlevel 1 (
  echo Playwright Chromium installation failed.
  pause
  exit /b 1
)

echo [4/4] Checking config.env...
if not exist "%~dp0config.env" (
  copy /y "%~dp0config.env.example" "%~dp0config.env" >nul
  echo config.env was created from config.env.example.
  echo Fill in the required values, then run agent\pc\예매Agent.bat.
)

echo.
echo ============================================
echo Installation complete.
echo Run agent\pc\예매Agent.bat to start the PC agent.
echo ============================================
echo.
pause
