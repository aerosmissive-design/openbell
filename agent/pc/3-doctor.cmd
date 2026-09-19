@echo off
setlocal
cd /d "%~dp0"
title OpenBell PC Agent - Doctor

rem Refresh PATH for this session (common Node install locations).
where node >nul 2>&1
if errorlevel 1 (
  set "PATH=%ProgramFiles%\nodejs;%LocalAppData%\Programs\nodejs;%PATH%"
)
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Run 1-install.cmd first.
  pause
  exit /b 1
)

if not exist "%~dp0node_modules\tsx" (
  echo Dependencies missing. Run 1-install.cmd first.
  pause
  exit /b 1
)

call npx tsx "%~dp0src\doctor.ts"
set "ERR=%ERRORLEVEL%"
echo.
pause
exit /b %ERR%
