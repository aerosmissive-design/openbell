@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

cd /d "%~dp0"

if not exist ".env" (
  echo [오류] pc 폴더에 .env 파일이 없습니다.
  echo env.example 을 복사해 .env 로 이름 바꾸고 값을 채워 주세요.
  pause
  exit /b 1
)

for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
  set "line=%%A"
  if not "!line!"=="" if not "!line:~0,1!"=="#" (
    set "%%A=%%B"
  )
)

if "%OPENBELL_URL%"=="" (
  echo [오류] .env 에 OPENBELL_URL 이 없습니다.
  pause
  exit /b 1
)
if "%NAS_WORKER_TOKEN%"=="" (
  echo [오류] .env 에 NAS_WORKER_TOKEN 이 없습니다.
  pause
  exit /b 1
)

if "%PLAYWRIGHT_STATE_DIR%"=="" set "PLAYWRIGHT_STATE_DIR=%~dp0..\nas\worker\data"
if "%HEADLESS%"=="" set "HEADLESS=1"
if "%POLL_SECONDS%"=="" set "POLL_SECONDS=15"

cd /d "%~dp0..\nas\worker"
if not exist "node_modules\" (
  echo [설치] npm install 중...
  call npm install
  if errorlevel 1 (
    echo npm install 실패. Node.js LTS 설치 여부를 확인하세요.
    pause
    exit /b 1
  )
)

if not exist "data\" mkdir data

echo.
echo [PC 도우미] 시작 — 이 창을 닫으면 멈춥니다.
echo URL=%OPENBELL_URL%
echo.

node index.mjs
echo.
echo [PC 도우미] 종료됨.
pause
