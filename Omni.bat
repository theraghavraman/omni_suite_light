@echo off
setlocal
cd /d "%~dp0"
call "%~dp0start_omni.bat"
exit /b %ERRORLEVEL%
