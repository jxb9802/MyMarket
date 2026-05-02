@echo off
setlocal

cd /d "%~dp0\.."
if not exist "log" mkdir log
set "AGENT_LOG=%CD%\log\windows_restart_agent.log"

echo [restart-agent] cwd=%CD%
echo [restart-agent] log=%AGENT_LOG%
echo [restart-agent] starting...
echo [restart-agent] commands and restart progress will print below and also append to the log file.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "& { " ^
  "  if (Test-Path '%AGENT_LOG%') { Remove-Item '%AGENT_LOG%' -Force -ErrorAction SilentlyContinue } " ^
  "  & node 'scripts\\windows_restart_agent.js' 2>&1 | Tee-Object -FilePath '%AGENT_LOG%' -Append; " ^
  "  exit $LASTEXITCODE " ^
  "}"
set "EXIT_CODE=%ERRORLEVEL%"
echo [restart-agent] exited code=%EXIT_CODE%
pause
exit /b %EXIT_CODE%
