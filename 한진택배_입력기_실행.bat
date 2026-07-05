@echo off
chcp 65001 >nul
title Hanjin CRM App

echo ========================================================
echo.
echo    Hanjin CRM App (Frontend + Backend)
echo.
echo ========================================================
echo.
echo Starting both Frontend and Backend...

:: Start Frontend (Vite)
start "Frontend (Vite)" /D client cmd /c "npm run dev"

:: Wait 3 seconds and open browser
timeout /t 3 /nobreak >nul
start http://localhost:5180

:: Start Backend
cd server
node index.js

pause
