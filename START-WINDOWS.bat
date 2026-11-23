@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ installed болуы керек. / Требуется Node.js 20+
  echo https://nodejs.org/
  pause
  exit /b 1
)
echo CareerBrand AI: http://localhost:3000
echo Close this window to stop the website.
start "" "http://localhost:3000"
node server.mjs
pause
