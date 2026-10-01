@echo off
setlocal
cd /d "%~dp0"
title OpenBell PC Agent - Save CGV login

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

if not exist "%~dp0node_modules\playwright" (
  echo Dependencies missing. Run 1-install.cmd first.
  pause
  exit /b 1
)

echo A Chromium window will open.
echo Log in to CGV yourself. This script does not type passwords.
echo This script does not click payment.
echo After login, return here and press Enter.
echo.
call npx tsx "%~dp0src\save-login.ts"
set "ERR=%ERRORLEVEL%"
echo.
pause
exit /b %ERR%
