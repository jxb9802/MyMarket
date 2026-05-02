@echo off
setlocal enableextensions
set "BASE_DIR=%~dp0"
set "BOOTSTRAP_PS1=%BASE_DIR%bootstrap_agent.ps1"
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%BOOTSTRAP_PS1%"
exit /b %ERRORLEVEL%
