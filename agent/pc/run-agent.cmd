@echo off
setlocal
cd /d "%~dp0"
title OpenBell PC Booking Agent

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Run install.cmd first.
  pause
  exit /b 1
)

if not exist "%~dp0config.env" (
  echo config.env is missing. Run install.cmd first.
  pause
  exit /b 1
)

set "OPENBELL_AGENT_CONFIG=%~dp0config.env"
node --experimental-strip-types "%~dp0run-booking-cli.ts"
if errorlevel 1 (
  echo.
  echo Booking Agent stopped with an error.
  pause
)
