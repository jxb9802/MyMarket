@echo off
setlocal

cd /d "%~dp0\.."
if exist ".env.market" (
  for /f "usebackq tokens=1,* delims==" %%A in (`findstr /b /c:"BSV_MARKET_DATA_DIR=" ".env.market"`) do set "BSV_MARKET_DATA_DIR=%%B"
  for /f "usebackq tokens=1,* delims==" %%A in (`findstr /b /c:"BSV_MARKET_DB_DIR=" ".env.market"`) do set "BSV_MARKET_DB_DIR=%%B"
  for /f "usebackq tokens=1,* delims==" %%A in (`findstr /b /c:"BSV_MARKET_LOG_DIR=" ".env.market"`) do set "BSV_MARKET_LOG_DIR=%%B"
  for /f "usebackq tokens=1,* delims==" %%A in (`findstr /b /c:"BSV_MARKET_PORT=" ".env.market"`) do set "BSV_MARKET_PORT=%%B"
)
if not defined BSV_MARKET_DATA_DIR set "BSV_MARKET_DATA_DIR=%CD%\data"
if not defined BSV_MARKET_DB_DIR set "BSV_MARKET_DB_DIR=%BSV_MARKET_DATA_DIR%"
if not defined BSV_MARKET_LOG_DIR set "BSV_MARKET_LOG_DIR=%CD%\log"
if not defined BSV_MARKET_PORT set "BSV_MARKET_PORT=8091"
if not exist "%BSV_MARKET_DATA_DIR%" mkdir "%BSV_MARKET_DATA_DIR%"
if not exist "%BSV_MARKET_DB_DIR%" mkdir "%BSV_MARKET_DB_DIR%"
if not exist "%BSV_MARKET_LOG_DIR%" mkdir "%BSV_MARKET_LOG_DIR%"
set "LOG_FILE=%BSV_MARKET_LOG_DIR%\bsv_market_node2.log"

echo [debug] cwd=%cd%
echo [debug] data=%BSV_MARKET_DATA_DIR%
echo [debug] db=%BSV_MARKET_DB_DIR%
echo [debug] log=%LOG_FILE%

where node >nul 2>nul
if errorlevel 1 (
  echo [error] Node.js not found. Install Node.js 18+ first.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [error] npm not found.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [debug] installing dependencies...
  call npm install axios@1.13.5 bsv@0.30.2 bsv-mnemonic@1.7.6 bsv-p2p@0.3.2 express@5.2.1 express-session@1.19.0
  if errorlevel 1 (
    echo [error] npm install failed.
    pause
    exit /b 1
  )
)
node -e "require.resolve('axios')" >nul 2>nul
if errorlevel 1 (
  echo [debug] dependencies incomplete, repairing...
  call npm install axios@1.13.5 bsv@0.30.2 bsv-mnemonic@1.7.6 bsv-p2p@0.3.2 express@5.2.1 express-session@1.19.0
  if errorlevel 1 (
    echo [error] npm install failed.
    pause
    exit /b 1
  )
)

set "BSV_MARKET_SESSION_SECRET=bsv-market-node2-local"
set "BSV_MARKET_BOOTSTRAP_HEIGHT=947111"
set "BSV_MARKET_UNCONFIRMED_MAX_AGE_MS=86400000"

echo [debug] starting server...
echo [debug] url=http://127.0.0.1:%BSV_MARKET_PORT%
echo [debug] press Ctrl+C to stop

node server_market.js 1>>"%LOG_FILE%" 2>&1
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo [error] server exited, code=%EXIT_CODE%
echo [error] tail log:
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Test-Path '%LOG_FILE%') { Get-Content -Path '%LOG_FILE%' -Tail 80 } else { Write-Host 'log file not found' }"
echo.
pause
exit /b %EXIT_CODE%
