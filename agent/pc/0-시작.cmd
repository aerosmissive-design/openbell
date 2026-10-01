@echo off
cd /d "%~dp0"
where node >nul 2>&1 || (
  echo Node.js가 없습니다. https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  call npm ci
)
set AGENT_MODE=poll
echo AGENT_MODE=poll  APP_VERSION=2.0.16
echo 기존 1~5 실행 파일은 이 폴더에 그대로 있습니다. 고급 실행은 advanced\ 를 보세요.
node node_modules\tsx\dist\cli.mjs src\cli.ts
pause
