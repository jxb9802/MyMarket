@echo off
setlocal

set "PORT=%1"
if "%PORT%"=="" set "PORT=8091"

echo checking http://127.0.0.1:%PORT%/api/state
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:%PORT%/api/state' -TimeoutSec 5;" ^
  "$j=$r.Content | ConvertFrom-Json;" ^
  "Write-Host ('success=' + $j.success + ' local=' + $j.state.sync.localHeight + ' network=' + $j.state.sync.networkHeight)"

if errorlevel 1 (
  echo healthcheck failed.
  exit /b 1
)
echo healthcheck ok.
exit /b 0
