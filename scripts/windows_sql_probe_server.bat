@echo off
setlocal

set "ROOT=%~dp0.."
pushd "%ROOT%" >nul 2>nul || exit /b 1

set "PORT=%SQL_PROBE_PORT%"
if not defined PORT set "PORT=8099"

set "DB=%SQL_PROBE_DB%"
if not defined DB set "DB=D:\WSL\db\market.db"

echo starting sql probe...
echo url: http://127.0.0.1:%PORT%
echo db: %DB%

set "SQL_PROBE_PORT=%PORT%"
set "SQL_PROBE_DB=%DB%"

node scripts\sql_probe_server.js

popd >nul 2>nul
endlocal
