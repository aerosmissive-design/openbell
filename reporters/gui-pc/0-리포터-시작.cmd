@echo off
cd /d "%~dp0"
where node >nul 2>&1 || (
  echo Node.js가 없습니다. https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules\playwright-core call npm install playwright-core
echo OpenBell reporter v11.27
echo Edge 프로필은 이 폴더의 edge-profile 을 씁니다. 예매 에이전트와 섞지 마세요.
node scrape.js
pause
