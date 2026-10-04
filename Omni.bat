@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "PYTHON="
where py >nul 2>&1
if not errorlevel 1 set "PYTHON=py -3"
if not defined PYTHON (
  where python >nul 2>&1
  if not errorlevel 1 set "PYTHON=python"
)
if not defined PYTHON (
  for %%P in (
    "%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
    "%ProgramFiles%\Python313\python.exe"
    "%ProgramFiles%\Python312\python.exe"
  ) do if not defined PYTHON if exist "%%~P" set "PYTHON=%%~P"
)

if not defined PYTHON (
  echo [ERROR] Python 3.11+ was not found.
  echo Install Python from python.org, then run Omni.bat again.
  pause
  exit /b 1
)

echo Starting OmniConverter Local Engine...
%PYTHON% -u omni_local_server.py
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo [ERROR] Local Engine exited with code %RC%.
  pause
)
exit /b %RC%
