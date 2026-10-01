@echo off
setlocal
cd /d "%~dp0"
title OpenBell PC Agent - Edit config.env

if not exist "%~dp0config.env" (
  echo config.env is missing. Run 1-install.cmd first.
  pause
  exit /b 1
)

start "" notepad "%~dp0config.env"
echo Opened config.env in Notepad.
echo After saving: 3-doctor.cmd then 2-run.cmd
pause
