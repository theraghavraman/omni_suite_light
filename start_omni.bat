@echo off
setlocal EnableExtensions
cd /d "%~dp0"
echo.
echo ==========================================
echo   OmniConverter Local Bootstrap
echo ==========================================
echo.
python -u "%~dp0omni_bootstrap.py"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo [ERROR] OmniConverter bootstrap failed with exit code %RC%.
  pause
)
exit /b %RC%
