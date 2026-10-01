@echo off
rem Windows: stops every Tech Pulse process started from this folder.
cd /d "%~dp0"
node scripts\stop.js
pause
