@echo off
setlocal
cd /d "%~dp0"
title OpenBell PC Agent

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Run 1-install.cmd first.
  pause
  exit /b 1
)

if not exist "%~dp0node_modules\playwright" (
  echo Dependencies missing. Run 1-install.cmd first.
  pause
  exit /b 1
)

if not exist "%~dp0config.env" (
  echo config.env is missing. Run 1-install.cmd first.
  pause
  exit /b 1
)

set "OPENBELL_AGENT_CONFIG=%~dp0config.env"
echo Starting OpenBell PC Agent...
call npx tsx "%~dp0src\run.ts"
if errorlevel 1 (
  echo.
  echo Agent stopped with an error.
  pause
)
