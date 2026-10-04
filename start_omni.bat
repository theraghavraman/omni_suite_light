@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo ==========================================
echo   OmniConverter Local Bootstrap
echo ==========================================
echo.

where py >nul 2>&1
if not errorlevel 1 (
  py -3 -u "%~dp0omni_bootstrap.py"
  set "RC=%ERRORLEVEL%"
  goto :DONE
)

where python >nul 2>&1
if not errorlevel 1 (
  python -u "%~dp0omni_bootstrap.py"
  set "RC=%ERRORLEVEL%"
  goto :DONE
)

echo [SETUP] Python launcher not found. Running the full Windows installer...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_windows.ps1"
if errorlevel 1 (
  set "RC=%ERRORLEVEL%"
  goto :DONE
)

"%~dp0.venv\Scripts\python.exe" -u "%~dp0omni_bootstrap.py"
set "RC=%ERRORLEVEL%"

:DONE
if not "%RC%"=="0" (
  echo.
  echo [ERROR] OmniConverter bootstrap failed with exit code %RC%.
  pause
)
exit /b %RC%
