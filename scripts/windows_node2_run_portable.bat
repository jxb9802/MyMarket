@echo off
setlocal

cd /d "%~dp0\.."
if not exist "log" mkdir log
set "LOG_FILE=%CD%\log\bsv_market_node2.log"
set "DEPS_ERR_FILE=%CD%\log\bsv_market_node2_deps.err"

set "BSV_MARKET_PORT=8091"
set "BSV_MARKET_SESSION_SECRET=bsv-market-node2-local"
set "BSV_MARKET_BOOTSTRAP_HEIGHT=947111"
set "BSV_MARKET_UNCONFIRMED_MAX_AGE_MS=86400000"

echo [portable] cwd=%cd%
echo [portable] url=http://127.0.0.1:%BSV_MARKET_PORT%
echo [portable] log=%LOG_FILE%

if not exist "steward_subprocess.js" (
  echo [error] missing steward_subprocess.js in package root.
  echo [error] please delete old folder and re-extract latest fullbundle zip.
  pause
  exit /b 1
)

node -e "const mods=['axios','bsv','bsv-mnemonic','bsv-p2p'];const miss=mods.filter((m)=>{try{require.resolve(m);return false;}catch(_){return true;}});if(miss.length){console.error('missing modules: '+miss.join(','));process.exit(1);}" >nul 2>"%DEPS_ERR_FILE%"
if errorlevel 1 (
  echo [error] bundled dependencies are missing. please re-extract the full package.
  if exist "%DEPS_ERR_FILE%" type "%DEPS_ERR_FILE%"
  pause
  exit /b 1
)

echo [portable] starting...
node server_market.js 1>>"%LOG_FILE%" 2>&1
set "EXIT_CODE=%ERRORLEVEL%"
echo [error] server exited code=%EXIT_CODE%
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Test-Path '%LOG_FILE%') { Get-Content -Path '%LOG_FILE%' -Tail 80 }"
pause
exit /b %EXIT_CODE%
