@echo off
chcp 65001 > nul
echo ========================================
echo   AI Image Upscaler - Khoi dong
echo ========================================
echo.
echo Backend : http://localhost:8000
echo Frontend: http://localhost:5173
echo.
echo (Lan dau chay se tu dong tai model AI ~200MB)
echo.

REM Start backend in new window
start "Backend - AI Upscaler" cmd /k "cd /d "%~dp0backend" && call venv\Scripts\activate && uvicorn main:app --host 0.0.0.0 --port 8000 --reload"

REM Wait a moment for backend to start
timeout /t 2 /nobreak > nul

REM Start frontend in new window
start "Frontend - AI Upscaler" cmd /k "cd /d "%~dp0frontend" && npm run dev"

REM Wait then open browser
timeout /t 3 /nobreak > nul
start http://localhost:5173
