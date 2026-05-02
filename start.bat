@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"
set "ENV_FILE=%CD%\.env.market"

if exist "%ENV_FILE%" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
    set "ENV_KEY=%%A"
    set "ENV_VAL=%%B"
    for /f "tokens=* delims= " %%K in ("!ENV_KEY!") do set "ENV_KEY=%%K"
    if defined ENV_VAL (
      for /f "tokens=* delims= " %%V in ("!ENV_VAL!") do set "ENV_VAL=%%V"
    )
    if /I "!ENV_KEY!"=="BSV_MARKET_DATA_DIR" set "BSV_MARKET_DATA_DIR=!ENV_VAL!"
    if /I "!ENV_KEY!"=="BSV_MARKET_LOG_DIR" set "BSV_MARKET_LOG_DIR=!ENV_VAL!"
    if /I "!ENV_KEY!"=="BSV_MARKET_PORT" set "BSV_MARKET_PORT=!ENV_VAL!"
  )
)
if not defined BSV_MARKET_DATA_DIR set "BSV_MARKET_DATA_DIR=%CD%\data"
if not defined BSV_MARKET_LOG_DIR set "BSV_MARKET_LOG_DIR=%CD%\log"
if not exist "%BSV_MARKET_DATA_DIR%" mkdir "%BSV_MARKET_DATA_DIR%"
if not exist "%BSV_MARKET_LOG_DIR%" mkdir "%BSV_MARKET_LOG_DIR%"
set "LOG_FILE=%BSV_MARKET_LOG_DIR%\bsv_market_run.log"
set "PORTABLE_NODE_ROOT=%CD%\tools\node-v24.14.0-win-x64"
set "NODE_CMD=node"
set "NPM_CMD="
set "PORTABLE_NPM_CMD=%PORTABLE_NODE_ROOT%\npm.cmd"
set "NODE_READY=0"
set "GLOBAL_NODE_CMD="
set "GLOBAL_NPM_CMD="

for /f "delims=" %%I in ('where node 2^>nul') do (
  if not defined GLOBAL_NODE_CMD set "GLOBAL_NODE_CMD=%%I"
)
for /f "delims=" %%I in ('where npm.cmd 2^>nul') do (
  if not defined GLOBAL_NPM_CMD set "GLOBAL_NPM_CMD=%%I"
)

if defined GLOBAL_NODE_CMD (
  "%GLOBAL_NODE_CMD%" -e "require('node:sqlite')" >nul 2>nul
  if not errorlevel 1 (
    set "NODE_CMD=%GLOBAL_NODE_CMD%"
    set "NODE_READY=1"
    if defined GLOBAL_NPM_CMD set "NPM_CMD=%GLOBAL_NPM_CMD%"
  )
)
if "%NODE_READY%"=="0" (
  if exist "%PORTABLE_NODE_ROOT%\node.exe" (
    set "NODE_CMD=%PORTABLE_NODE_ROOT%\node.exe"
    set "NODE_READY=1"
    if exist "%PORTABLE_NPM_CMD%" (
      set "NPM_CMD=%PORTABLE_NPM_CMD%"
    )
  )
)

echo [1/6] checking Node.js...
if "%NODE_READY%"=="0" (
  call scripts\windows_ensure_node24.bat
  set "GLOBAL_NODE_CMD="
  set "GLOBAL_NPM_CMD="
  for /f "delims=" %%I in ('where node 2^>nul') do (
    if not defined GLOBAL_NODE_CMD set "GLOBAL_NODE_CMD=%%I"
  )
  for /f "delims=" %%I in ('where npm.cmd 2^>nul') do (
    if not defined GLOBAL_NPM_CMD set "GLOBAL_NPM_CMD=%%I"
  )
  if defined GLOBAL_NODE_CMD (
    "%GLOBAL_NODE_CMD%" -e "require('node:sqlite')" >nul 2>nul
    if not errorlevel 1 (
      set "NODE_CMD=%GLOBAL_NODE_CMD%"
      set "NODE_READY=1"
      if defined GLOBAL_NPM_CMD set "NPM_CMD=%GLOBAL_NPM_CMD%"
    )
  )
  if "%NODE_READY%"=="0" if exist "%PORTABLE_NODE_ROOT%\node.exe" (
    set "NODE_CMD=%PORTABLE_NODE_ROOT%\node.exe"
    set "NODE_READY=1"
    if exist "%PORTABLE_NPM_CMD%" (
      set "NPM_CMD=%PORTABLE_NPM_CMD%"
    )
  )
  if "%NODE_READY%"=="0" (
    pause
    exit /b 1
  )
)

echo [2/6] checking node:sqlite...
"%NODE_CMD%" -e "require('node:sqlite')" >nul 2>nul
if errorlevel 1 (
  echo This build of Node.js does not provide node:sqlite after auto-install.
  pause
  exit /b 1
)

echo [3/6] checking dependencies...
if not exist node_modules (
  if not defined NPM_CMD (
    for /f "delims=" %%I in ('where npm.cmd 2^>nul') do (
      if not defined NPM_CMD set "NPM_CMD=%%I"
    )
  )
  if not defined NPM_CMD (
    echo npm.cmd not found. Please install Node.js with npm on Windows and run start.bat again.
    pause
    exit /b 1
  )
  call "%NPM_CMD%" install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)
"%NODE_CMD%" -e "require.resolve('axios');require.resolve('bsv');require.resolve('bsv-p2p');require.resolve('express');require.resolve('express-session');require.resolve('ws')" >nul 2>nul
if errorlevel 1 (
  if not defined NPM_CMD (
    for /f "delims=" %%I in ('where npm.cmd 2^>nul') do (
      if not defined NPM_CMD set "NPM_CMD=%%I"
    )
  )
  if not defined NPM_CMD (
    echo npm.cmd not found. Please install Node.js with npm on Windows and run start.bat again.
    pause
    exit /b 1
  )
  call "%NPM_CMD%" install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo [4/6] resolving port...
if not defined BSV_MARKET_PORT set "BSV_MARKET_PORT=8091"
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr /R /C:":%BSV_MARKET_PORT% .*LISTENING" 2^>nul') do (
  if not "%%P"=="0" (
    echo stopping stale process on port %BSV_MARKET_PORT%: %%P
    taskkill /PID %%P /T /F >nul 2>nul
  )
)
timeout /t 1 /nobreak >nul 2>nul
for /f %%p in ('"%NODE_CMD%" scripts\\resolve_runtime_port.js 8091 8100 --write') do set "BSV_MARKET_PORT=%%p"
if "%BSV_MARKET_PORT%"=="" (
  echo Failed to resolve runtime port.
  pause
  exit /b 1
)
set "BSV_MARKET_SESSION_SECRET=bsv-market-local"
set "BSV_MARKET_BOOTSTRAP_HEIGHT=947111"
set "BSV_MARKET_UNCONFIRMED_MAX_AGE_MS=86400000"
set "BSV_MARKET_DB_TIMEOUT_MS=30000"
set "BSV_MARKET_ENABLE_TEST_SQL_API=1"
set "NODE_NO_WARNINGS=1"
echo using port: %BSV_MARKET_PORT%
if exist "%ENV_FILE%" (
  echo env: %ENV_FILE%
) else (
  echo env: missing ^(%ENV_FILE%^)
)
if "%BSV_MARKET_DATA_DIR%"=="%CD%\data" echo note: BSV_MARKET_DATA_DIR not set in .env.market, using default
if "%BSV_MARKET_LOG_DIR%"=="%CD%\log" echo note: BSV_MARKET_LOG_DIR not set in .env.market, using default

echo [5/6] starting server...
echo url: http://127.0.0.1:%BSV_MARKET_PORT%/index.html
echo node: %NODE_CMD%
if not defined NPM_CMD (
  echo npm: not-resolved
) else (
  echo npm: %NPM_CMD%
)
echo data: %BSV_MARKET_DATA_DIR%
echo log: %LOG_FILE%
echo Closing this window will stop the service.
where powershell >nul 2>nul
if not errorlevel 1 (
  start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process 'http://127.0.0.1:%BSV_MARKET_PORT%/index.html'"
) else (
  start "" "http://127.0.0.1:%BSV_MARKET_PORT%/index.html"
)
"%NODE_CMD%" server_market.js 1>>"%LOG_FILE%" 2>&1

endlocal
