@echo off
setlocal

cd /d "%~dp0\.."
set "PORT=%~1"
if "%PORT%"=="" set "PORT=8091"

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "TS=%%i"
set "OUT_DIR=%CD%\bsv_market_debug_%TS%"
set "OUT_ZIP=%CD%\bsv_market_debug_%TS%.zip"
mkdir "%OUT_DIR%" >nul 2>nul

echo [1/5] collect api/state
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:%PORT%/api/state' -TimeoutSec 12).Content | Out-File -Encoding UTF8 '%OUT_DIR%\api_state.json' } catch { $_ | Out-File -Encoding UTF8 '%OUT_DIR%\api_state.error.txt' }"

echo [2/6] collect api/chat/threads
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:%PORT%/api/chat/threads' -TimeoutSec 12).Content | Out-File -Encoding UTF8 '%OUT_DIR%\api_chat_threads.json' } catch { $_ | Out-File -Encoding UTF8 '%OUT_DIR%\api_chat_threads.error.txt' }"

echo [3/6] collect api/chat/unread
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:%PORT%/api/chat/unread' -TimeoutSec 12).Content | Out-File -Encoding UTF8 '%OUT_DIR%\api_chat_unread.json' } catch { $_ | Out-File -Encoding UTF8 '%OUT_DIR%\api_chat_unread.error.txt' }"

echo [4/6] collect runtime logs
if exist "log\bsv_market_node2.log" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content -Path 'log\bsv_market_node2.log' -Tail 2000 | Out-File -Encoding UTF8 '%OUT_DIR%\node2_tail.log'"
) else (
  echo no log\bsv_market_node2.log > "%OUT_DIR%\node2_tail.log"
)

if exist "log\market-debug.log" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content -Path 'log\market-debug.log' -Tail 2000 | Out-File -Encoding UTF8 '%OUT_DIR%\market_debug_tail.log'"
) else (
  echo no log\market-debug.log > "%OUT_DIR%\market_debug_tail.log"
)

echo [5/6] collect lightweight local snapshots
if exist "data\state.json" copy /y "data\state.json" "%OUT_DIR%\state.json" >nul
if exist "data\wallet_state.json" copy /y "data\wallet_state.json" "%OUT_DIR%\wallet_state.json" >nul
if exist "data\cache.json" copy /y "data\cache.json" "%OUT_DIR%\cache.json" >nul

echo [6/6] pack zip
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "if (Test-Path '%OUT_ZIP%') { Remove-Item -Force '%OUT_ZIP%' }; Compress-Archive -Path '%OUT_DIR%\*' -DestinationPath '%OUT_ZIP%' -Force"

echo.
echo debug bundle: %OUT_ZIP%
echo please send this zip to me.
pause
exit /b 0
