@echo off
rem Windows: full version - private HTTPS for phones + big QR codes on screen.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.12 or newer is needed once ^(free^): https://nodejs.org/  Install the LTS version, then run this file again.
  pause
  exit /b 1
)
node scripts\full.js %*
if errorlevel 1 pause
