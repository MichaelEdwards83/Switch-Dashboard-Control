@echo off
cd /d "%~dp0"

echo ==========================================
echo   HoneyBadger Switch Manager
echo ==========================================

:: Check if Node is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Error: Node.js is not installed!
    pause
    exit /b
)

echo.
echo Installing dependencies...
call npm install

echo.
echo Starting Manager...
echo Access at: http://localhost:5173
echo.
call npm run dev

pause
