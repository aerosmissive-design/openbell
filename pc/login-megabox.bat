@echo off
chcp 65001 >nul
cd /d "%~dp0..\nas\worker"
if not exist "node_modules\" call npm install
if not exist "data\" mkdir data
set HEADLESS=0
set PLAYWRIGHT_STATE_DIR=./data
echo 브라우저에서 메가박스 로그인 후 이 창으로 돌아와 Enter 치세요.
node login-setup.mjs megabox
pause
