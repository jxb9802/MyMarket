@echo off
setlocal

cd /d "%~dp0\.."
set "PORT=%~1"
if "%PORT%"=="" set "PORT=8091"
set "URL=http://127.0.0.1:%PORT%/api/state"

echo [1/2] checking api: %URL%
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$r=Invoke-WebRequest -UseBasicParsing -Uri '%URL%' -TimeoutSec 10; $j=$r.Content|ConvertFrom-Json; " ^
  "Write-Host ('success=' + $j.success);" ^
  "Write-Host ('localHeight=' + $j.state.sync.localHeight + ' networkHeight=' + $j.state.sync.networkHeight);" ^
  "Write-Host ('merchants=' + $j.state.merchants.Count + ' users=' + $j.state.users.Count + ' categories=' + $j.state.categories.Count + ' products=' + $j.state.products.Count);"
if errorlevel 1 (
  echo [error] api not reachable.
  pause
  exit /b 1
)

echo [2/2] checking chat threads
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$u='http://127.0.0.1:%PORT%/api/chat/threads'; $r=Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 10; $j=$r.Content|ConvertFrom-Json; " ^
  "Write-Host ('threads=' + $j.threads.Count + ' unreadTotal=' + $j.unreadTotal); " ^
  "if($j.threads.Count -gt 0){$j.threads | Select-Object -First 8 | ForEach-Object { Write-Host ('- ' + $_.walletId + ' | ' + $_.displayName + ' | direct=' + $_.directConnected + ' | connecting=' + $_.connecting + ' | unread=' + $_.unreadCount) }} else { Write-Host '- no chat threads' }"

echo done
pause
exit /b 0
