@echo off
title Lab Equipment Loans
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist "server\.env" (
  call npm install --prefix server
  call npm install --prefix client
  node server\scripts\setup.js
)

call npm start
pause
