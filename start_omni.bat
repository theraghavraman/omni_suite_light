@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 ( py omni_local_server.py ) else ( python omni_local_server.py )
pause
