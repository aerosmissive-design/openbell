@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title OpenBell PC Booking Agent

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Run 설치.bat first.
  pause
  exit /b 1
)

if not exist "%~dp0config.env" (
  echo config.env is missing. Run 설치.bat first.
  pause
  exit /b 1
)

node --experimental-strip-types "%~dp0run-booking-cli.ts"
if errorlevel 1 (
  echo.
  echo Booking Agent stopped with an error.
  pause
)
