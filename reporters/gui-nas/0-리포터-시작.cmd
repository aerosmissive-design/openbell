@echo off
cd /d "%~dp0"
where node >nul 2>&1 || (
  echo Node.js가 없습니다.
  pause
  exit /b 1
)
echo OpenBell NAS reporter v11.27
node scrape.js
pause
