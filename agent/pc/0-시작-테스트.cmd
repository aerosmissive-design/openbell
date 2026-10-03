@echo off
cd /d "%~dp0"
title OpenBell PC Agent test
echo OpenBell PC Agent 2.0.18 test
echo No booking. No payment click.
echo [CGV] open login URL only
call npx tsx src/save-login.ts
echo [MEGABOX] open home only
call npx tsx -e "import { runMegabox } from './src/run.ts'; await runMegabox({ movieTitle:'test', playDate:'2026-10-03', showtime:'12:00' });"
echo TEST_DONE
pause
