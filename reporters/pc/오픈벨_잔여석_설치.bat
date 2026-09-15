@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title OpenBell CGV Seat Reporter

echo ========================================
echo   OpenBell CGV 잔여석 리포터 - 원클릭 설치
 echo ========================================
echo.

set "OPENBELL_URL=https://openbell-fawn.vercel.app"
set "THEATERS=cgv_yongsan,cgv_yeongdeungpo"
set "INTERVAL_MS=60000"
set "IMAX_INTERVAL_MS=30000"
set "DAYS=2"

where node >nul 2>&1
if errorlevel 1 (
  echo [1/3] Node.js LTS를 설치합니다...
  where winget >nul 2>&1
  if errorlevel 1 (
    echo.
    echo 이 PC에는 winget이 없습니다.
    echo Windows 10/11의 App Installer를 업데이트한 뒤 다시 실행하세요.
    pause
    exit /b 1
  )
  winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    echo Node.js 설치에 실패했습니다.
    pause
    exit /b 1
  )
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
) else (
  echo [1/3] Node.js 확인 완료.
)

if not exist "%~dp0scrape.js" (
  echo [2/3] scrape.js가 없습니다. 설치 패키지가 손상되었습니다.
  pause
  exit /b 1
)
echo [2/3] 리포터 파일 확인 완료.

if not exist "%~dp0config.env" (
  echo.
  echo [3/3] 최초 1회만 서버 인증 토큰을 입력합니다.
  echo Vercel의 NAS_WORKER_TOKEN 값과 동일한 값을 입력하세요.
  set /p "TOKEN=NAS_WORKER_TOKEN: "
  if "!TOKEN!"=="" (
    echo 토큰이 비어 있습니다.
    pause
    exit /b 1
  )
  >"%~dp0config.env" echo OPENBELL_URL=%OPENBELL_URL%
  >>"%~dp0config.env" echo NAS_WORKER_TOKEN=!TOKEN!
  >>"%~dp0config.env" echo THEATERS=%THEATERS%
  >>"%~dp0config.env" echo INTERVAL_MS=%INTERVAL_MS%
  >>"%~dp0config.env" echo IMAX_INTERVAL_MS=%IMAX_INTERVAL_MS%
  >>"%~dp0config.env" echo DAYS=%DAYS%
  echo 설정 저장 완료.
) else (
  echo [3/3] 기존 설정 사용.
)

echo.
echo ----------------------------------------
echo OpenBell CGV 잔여석 리포터를 시작합니다.
echo 전체 조회 : 60초
 echo IMAX 조회 : 30초
echo 대상       : CGV 용산 / 영등포
echo 서버       : %OPENBELL_URL%
echo ----------------------------------------
echo.

node "%~dp0scrape.js"
echo.
echo 리포터가 종료되었습니다. 아무 키나 누르세요.
pause >nul
