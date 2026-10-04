@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo ==========================================
echo   OmniConverter Windows Setup
echo ==========================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_windows.ps1"
if errorlevel 1 (
  echo.
  echo [ERROR] Windows setup failed.
  pause
  exit /b 1
)

echo.
echo [OK] Setup completed. Launching OmniConverter...
echo.
call "%~dp0start_omni.bat"
exit /b %ERRORLEVEL%
