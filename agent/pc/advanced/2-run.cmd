@echo off
setlocal
cd /d "%~dp0"
title OpenBell PC Agent

rem Refresh PATH for this session (common Node install locations) - same as 1-install.cmd.
where node >nul 2>&1
if errorlevel 1 (
  set "PATH=%ProgramFiles%\nodejs;%LocalAppData%\Programs\nodejs;%PATH%"
)
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

if not exist "%~dp0config.env" (
  echo config.env is missing. Run 1-install.cmd first.
  pause
  exit /b 1
)

if not exist "%~dp0logs" mkdir "%~dp0logs"

set "OPENBELL_AGENT_CONFIG=%~dp0config.env"
echo Starting OpenBell PC Agent...
call npx tsx "%~dp0src\cli.ts"
set "ERR=%ERRORLEVEL%"
echo.
if not "%ERR%"=="0" (
  echo Agent stopped with an error.
  echo If a screenshot was saved, look in the logs folder.
) else (
  echo Agent finished. Result code A-E is above.
  echo Browser stays open until you close it. You pay yourself.
)
echo.
pause
exit /b %ERR%
