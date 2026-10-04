@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo ==========================================
echo   OmniConverter Local Engine
echo ==========================================
echo.

set "PYTHON="
where py >nul 2>&1
if not errorlevel 1 set "PYTHON=py"
if not defined PYTHON (
  where python >nul 2>&1
  if not errorlevel 1 set "PYTHON=python"
)

if not defined PYTHON (
  echo [ERROR] Python was not found.
  echo Install Python 3.11+ and make sure it is available in PATH.
  echo.
  pause
  exit /b 1
)

if exist "%~dp0.venv\Scripts\python.exe" (
  set "RUNPY=%~dp0.venv\Scripts\python.exe"
  echo [OK] Using OmniConverter virtual environment.
) else (
  set "RUNPY=%PYTHON%"
  echo [WARN] .venv not found; using system Python.
)
echo [OK] Starting Local Engine on http://127.0.0.1:8765/
echo.
"%RUNPY%" omni_local_server.py
set "RC=%ERRORLEVEL%"

echo.
if not "%RC%"=="0" (
  echo [ERROR] OmniConverter stopped with exit code %RC%.
  echo Review the error above.
) else (
  echo OmniConverter Local Engine stopped.
)
echo.
pause
exit /b %RC%
