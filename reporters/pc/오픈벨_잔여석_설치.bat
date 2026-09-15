@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title 오픈벨 잔여석 리포터 설치

echo ========================================
echo   오픈벨 PC 잔여석 리포터 - 1클릭 설치
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [1/3] Node.js LTS가 없어 자동 설치합니다.
  where winget >nul 2>&1
  if errorlevel 1 (
    echo winget이 없습니다. Microsoft Store/App Installer를 먼저 설치하세요.
    start https://nodejs.org/en/download
    pause
    exit /b 1
  )
  winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    echo Node.js 자동 설치에 실패했습니다. nodejs.org에서 LTS를 설치 후 다시 실행하세요.
    start https://nodejs.org/en/download
    pause
    exit /b 1
  )
  echo Node.js 설치 완료.
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
) else (
  echo [1/3] Node.js 확인 완료.
)

if not exist scrape.js (
  echo [2/3] 리포터 파일을 준비합니다.
  echo 이 파일과 같은 폴더에 scrape.js가 없으면 GitHub에서 받으세요.
  echo.
  echo 이미 저장소의 reporters\pc 폴더를 받은 경우에는 그대로 진행합니다.
  pause
  exit /b 1
) else (
  echo [2/3] 리포터 파일 확인 완료.
)

if not exist config.env (
  echo.
  echo [3/3] 처음 한 번만 베셀 연결 정보를 입력합니다.
  set "OPENBELL_URL=https://openbell-fawn.vercel.app"
  set /p "TOKEN=NAS_REPORT_TOKEN (베셀 환경변수와 같은 값): "
  if "!TOKEN!"=="" (
    echo 토큰이 비어 있습니다.
    pause
    exit /b 1
  )
  >config.env echo OPENBELL_URL=!OPENBELL_URL!
  >>config.env echo NAS_REPORT_TOKEN=!TOKEN!
  >>config.env echo THEATERS=cgv_yongsan,cgv_yeongdeungpo
  >>config.env echo INTERVAL_MS=60000
  >>config.env echo IMAX_INTERVAL_MS=30000
  >>config.env echo DAYS=2
  echo 설정 저장 완료. 다음부터는 이 파일을 다시 더블클릭하면 바로 실행됩니다.
) else (
  echo [3/3] 기존 설정 사용.
)

echo.
echo 오픈벨 잔여석 리포터를 시작합니다.
echo - 전체 잔여석: 60초
 echo - IMAX: 30초
 echo - CGV 용산/영등포
 echo - 좌석 선택/예매/결제는 하지 않습니다.
echo.
node scrape.js
pause
