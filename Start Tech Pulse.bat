@echo off
rem Windows: fast start on this computer only (phone setup needs macOS, see README).
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.12 or newer is needed once ^(free^): https://nodejs.org/  Install the LTS version, then run this file again.
  pause
  exit /b 1
)
node scripts\demo.js
if errorlevel 1 pause
