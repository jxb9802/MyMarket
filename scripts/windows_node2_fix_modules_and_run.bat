@echo off
setlocal

cd /d "%~dp0\.."

echo [1/4] checking node/npm...
where node >nul 2>nul || (echo Node.js not found. Please install Node.js 24+ & pause & exit /b 1)
where npm >nul 2>nul || (echo npm not found & pause & exit /b 1)
node -e "require('node:sqlite'); console.log('node:sqlite ok')" >nul 2>nul || (echo This build of Node.js does not provide node:sqlite. Please install Node.js 24+ & pause & exit /b 1)

echo [2/4] installing required runtime modules...
call npm install axios@1.13.5 bsv@0.30.2 bsv-mnemonic@1.7.6 bsv-p2p@0.3.2 express@5.2.1 express-session@1.19.0
if errorlevel 1 (
  echo npm install failed.
  pause
  exit /b 1
)

echo [3/4] verifying modules...
node -e "require.resolve('axios');require.resolve('bsv');require.resolve('bsv-mnemonic');require.resolve('bsv-p2p');require.resolve('express');require.resolve('express-session');console.log('module check ok')"
if errorlevel 1 (
  echo module verification failed.
  pause
  exit /b 1
)

echo [4/4] start node-2...
call scripts\windows_node2_run_debug.bat

endlocal
