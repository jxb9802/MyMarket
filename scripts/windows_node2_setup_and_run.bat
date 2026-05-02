@echo off
setlocal

REM One-click bootstrap + run for Windows host as Node-2.
cd /d "%~dp0\.."

if not exist "steward_subprocess.js" (
  echo [error] missing steward_subprocess.js in this folder.
  echo please re-extract the latest full package and retry.
  pause
  exit /b 1
)

echo [1/5] checking Node.js...
call scripts\windows_ensure_node24.bat
if errorlevel 1 (
  pause
  exit /b 1
)

echo [2/5] checking npm...
where npm >nul 2>nul
if errorlevel 1 (
  echo npm not found. Please reinstall Node.js with npm.
  pause
  exit /b 1
)

echo [2.1/5] checking node:sqlite...
node -e "require('node:sqlite'); console.log('node:sqlite ok')" >nul 2>nul
if errorlevel 1 (
  echo This build of Node.js does not provide node:sqlite after auto-install.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [3/5] installing dependencies...
  call npm install axios@1.13.5 bsv@0.30.2 bsv-mnemonic@1.7.6 bsv-p2p@0.3.2 express@5.2.1 express-session@1.19.0 ws@8.18.3
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
) else (
  echo [3/5] dependencies already present.
)
node -e "require.resolve('axios');require.resolve('ws')" >nul 2>nul
if errorlevel 1 (
  echo [3.1/5] dependencies incomplete, repairing...
  call npm install axios@1.13.5 bsv@0.30.2 bsv-mnemonic@1.7.6 bsv-p2p@0.3.2 express@5.2.1 express-session@1.19.0 ws@8.18.3
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

if exist ".env.market" (
  for /f "usebackq tokens=1,* delims==" %%A in (`findstr /b /c:"BSV_MARKET_DATA_DIR=" ".env.market"`) do set "BSV_MARKET_DATA_DIR=%%B"
  for /f "usebackq tokens=1,* delims==" %%A in (`findstr /b /c:"BSV_MARKET_LOG_DIR=" ".env.market"`) do set "BSV_MARKET_LOG_DIR=%%B"
)
if not defined BSV_MARKET_DATA_DIR set "BSV_MARKET_DATA_DIR=%CD%\data"
if not defined BSV_MARKET_LOG_DIR set "BSV_MARKET_LOG_DIR=%CD%\log"
if not exist "%BSV_MARKET_DATA_DIR%" mkdir "%BSV_MARKET_DATA_DIR%"
if not exist "%BSV_MARKET_LOG_DIR%" mkdir "%BSV_MARKET_LOG_DIR%"

echo [4/5] exporting node-2 env...
set "BSV_MARKET_PORT=8091"
set "BSV_MARKET_SESSION_SECRET=bsv-market-node2-local"
set "BSV_MARKET_BOOTSTRAP_HEIGHT=947111"
set "BSV_MARKET_UNCONFIRMED_MAX_AGE_MS=86400000"

echo [5/5] starting server...
echo url: http://127.0.0.1:%BSV_MARKET_PORT%
echo log: %BSV_MARKET_LOG_DIR%\bsv_market_node2.log
echo Press Ctrl+C to stop.
node server_market.js 1>>"%BSV_MARKET_LOG_DIR%\bsv_market_node2.log" 2>&1
if errorlevel 1 (
  echo.
  echo [error] server_market.js exited with code %errorlevel%.
  echo check log: %BSV_MARKET_LOG_DIR%\bsv_market_node2.log
  pause
)

endlocal
