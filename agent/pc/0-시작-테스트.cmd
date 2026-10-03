@echo off
cd /d "%~dp0"
title OpenBell PC Agent test
echo OpenBell PC Agent 2.0.18 test
echo No booking. No payment click.
if not exist node_modules (
  echo [1] install
  call npm install
  if errorlevel 1 (
    echo [FAIL] npm install
    pause
    exit /b 1
  )
)
if not exist node_modules\.bin\tsx.cmd (
  echo [FAIL] tsx missing. npm install failed.
  pause
  exit /b 1
)
echo [2] open CGV login and Megabox home
call node_modules\.bin\tsx.cmd src\test-open.ts
echo Done. Close the browser if it is still open.
pause
