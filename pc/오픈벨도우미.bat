@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

title 오픈벨 PC 도우미

REM --- .env 없으면 첫 설정 ---
if not exist ".env" goto SETUP
goto START

:SETUP
echo ========================================
echo   오픈벨 PC 도우미 - 처음 설정 (한 번만)
echo ========================================
echo.
echo 베셀에 넣어 둔 NAS_WORKER_TOKEN 과 같아야 합니다.
echo.

set "DEFAULT_URL=https://openbell-fawn.vercel.app"
set /p OPENBELL_URL="오픈벨 주소 (엔터=기본 %DEFAULT_URL%): "
if "%OPENBELL_URL%"=="" set "OPENBELL_URL=%DEFAULT_URL%"

set /p NAS_WORKER_TOKEN="NAS_WORKER_TOKEN (베셀과 동일): "
if "%NAS_WORKER_TOKEN%"=="" (
  echo 토큰은 필수입니다.
  pause
  exit /b 1
)

set /p TELEGRAM_BOT_TOKEN="텔레그램 봇 토큰 (없으면 엔터): "
set /p TELEGRAM_CHAT_ID="텔레그램 채팅 ID (없으면 엔터): "

(
  echo OPENBELL_URL=%OPENBELL_URL%
  echo NAS_WORKER_TOKEN=%NAS_WORKER_TOKEN%
  echo TELEGRAM_BOT_TOKEN=%TELEGRAM_BOT_TOKEN%
  echo TELEGRAM_CHAT_ID=%TELEGRAM_CHAT_ID%
  echo POLL_SECONDS=15
  echo HEADLESS=1
  echo PLAYWRIGHT_STATE_DIR=../nas/worker/data
) > ".env"

echo.
echo [저장] pc\.env
echo.

echo Node 패키지 설치 중... (처음만 조금 걸림)
cd /d "%~dp0..\nas\worker"
if not exist "data\" mkdir data
call npm install
if errorlevel 1 (
  echo npm install 실패. https://nodejs.org 에서 LTS 설치 후 다시 실행하세요.
  pause
  exit /b 1
)
cd /d "%~dp0"

echo.
set /p DOLOGIN="극장 로그인 쿠키를 지금 만들까요? (Y/N): "
if /i "%DOLOGIN%"=="Y" (
  echo CGV 로그인 창이 열립니다. 로그인 후 이 창에서 Enter.
  cd /d "%~dp0..\nas\worker"
  set HEADLESS=0
  set PLAYWRIGHT_STATE_DIR=./data
  node login-setup.mjs cgv
  echo 메가박스 로그인 창이 열립니다. 로그인 후 Enter.
  node login-setup.mjs megabox
  cd /d "%~dp0"
)

echo.
echo 설정 끝. 이제부터는 이 파일을 다시 누르면 바로 시작합니다.
echo.

:START
cd /d "%~dp0"
for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
  set "line=%%A"
  if not "!line!"=="" if not "!line:~0,1!"=="#" set "%%A=%%B"
)

if "%OPENBELL_URL%"=="" (
  echo .env 가 비었습니다. .env 삭제 후 다시 실행하세요.
  pause
  exit /b 1
)
if "%NAS_WORKER_TOKEN%"=="" (
  echo 토큰이 없습니다. .env 삭제 후 다시 실행하세요.
  pause
  exit /b 1
)
if "%PLAYWRIGHT_STATE_DIR%"=="" set "PLAYWRIGHT_STATE_DIR=%~dp0..\nas\worker\data"
if "%HEADLESS%"=="" set "HEADLESS=1"
if "%POLL_SECONDS%"=="" set "POLL_SECONDS=15"

cd /d "%~dp0..\nas\worker"
if not exist "node_modules\" call npm install
if not exist "data\" mkdir data

echo.
echo ========================================
echo   오픈벨 PC 도우미 실행 중
echo   창을 닫으면 멈춥니다 (알림은 베셀이 계속)
echo   URL=%OPENBELL_URL%
echo ========================================
echo.

node index.mjs
echo.
echo 종료됨.
pause
