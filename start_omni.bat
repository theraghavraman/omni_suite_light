@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if not exist "%~dp0.venv\Scripts\python.exe" goto :SETUP
"%~dp0.venv\Scripts\python.exe" "%~dp0verify_local_environment.py" >nul 2>&1
if errorlevel 1 goto :SETUP

echo.
echo ==========================================
echo   OmniConverter Local Engine
echo ==========================================
echo.
echo [OK] Complete local environment verified.
echo [OK] Starting Local Engine on http://127.0.0.1:8765/
echo.
"%~dp0.venv\Scripts\python.exe" -u "%~dp0omni_local_server.py"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" (
  echo [ERROR] OmniConverter stopped with exit code %RC%.
  pause
)
exit /b %RC%

:SETUP
echo.
echo [SETUP] Complete local environment is not ready.
echo [SETUP] Running one-click dependency installer now...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_windows.ps1"
if errorlevel 1 (
  echo [ERROR] Dependency setup failed.
  pause
  exit /b 1
)
goto :START

:START
