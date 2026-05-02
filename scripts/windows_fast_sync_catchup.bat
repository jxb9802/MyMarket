@echo off
setlocal

cd /d "%~dp0\.."
set "PORT=%~1"
if "%PORT%"=="" set "PORT=8091"
set "ROUNDS=%~2"
if "%ROUNDS%"=="" set "ROUNDS=300"

echo fast catchup start: port=%PORT% rounds=%ROUNDS%

for /l %%i in (1,1,%ROUNDS%) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "try { Invoke-WebRequest -UseBasicParsing -Method POST -Uri 'http://127.0.0.1:%PORT%/api/catalog/sync' -ContentType 'application/json' -Body '{}' | Out-Null } catch {}"
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "try { $j=(Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:%PORT%/api/state' -TimeoutSec 10).Content|ConvertFrom-Json; " ^
    "Write-Host ('[' + %%i + '/%ROUNDS%] local=' + $j.state.sync.localHeight + ' network=' + $j.state.sync.networkHeight + ' merchants=' + $j.state.merchants.Count + ' products=' + $j.state.products.Count) } catch { Write-Host ('[' + %%i + '/%ROUNDS%] api error') }"
  timeout /t 1 >nul
)

echo done
pause
exit /b 0
