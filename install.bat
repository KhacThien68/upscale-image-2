@echo off
chcp 65001 > nul
echo ========================================
echo   AI Image Upscaler - Cai dat
echo ========================================
echo.

REM ── Backend ──
echo [1/4] Tao Python virtual environment...
cd /d "%~dp0backend"
python -m venv venv
if errorlevel 1 ( echo LỖI: Không tìm thấy Python! & pause & exit /b 1 )

echo.
echo [2/4] Cai PyTorch voi CUDA 12.1 (RTX 3060)...
call venv\Scripts\activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121 --quiet
if errorlevel 1 ( echo LỖI: Cài PyTorch thất bại! & pause & exit /b 1 )

echo.
echo [3/4] Cai cac thu vien AI...
pip install -r requirements.txt --quiet
if errorlevel 1 ( echo LỖI: Cài requirements thất bại! & pause & exit /b 1 )

REM ── Frontend ──
echo.
echo [4/4] Cai frontend (React + Vite)...
cd /d "%~dp0frontend"
call npm install
if errorlevel 1 ( echo LỖI: Cài npm thất bại! & pause & exit /b 1 )

echo.
echo ========================================
echo   Cai dat hoan tat!
echo   Chay run.bat de khoi dong app.
echo ========================================
pause
