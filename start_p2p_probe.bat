@echo off
setlocal

cd /d "%~dp0"

echo [1/3] checking npm...
where npm >nul 2>nul
if errorlevel 1 (
  echo npm not found. Please install Node.js with npm.
  pause
  exit /b 1
)

echo [2/3] checking dependencies...
if not exist node_modules (
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)
node -e "require.resolve('ws')" >nul 2>nul
if errorlevel 1 (
  call npm install ws@8.18.3
  if errorlevel 1 (
    echo npm install ws failed.
    pause
    exit /b 1
  )
)

set "MODE=serve"
set "WALLET_ID=windows-node"
set "HOST=0.0.0.0"
set "PORT=9777"
set "UDP_PORT=9777"
set "ADVERTISE_HOST=192.168.2.10"
set "RELAY_URL=http://192.168.2.42:9780"
set "ENABLE_RELAY=true"
set "BLACKLIST="

if /i "%~1"=="probe" goto run_probe
if /i "%~1"=="direct-send" goto run_direct
if /i "%~1"=="holepunch-send" goto run_holepunch
if /i "%~1"=="relay-send" goto run_relay

echo [3/3] starting P2P probe...
echo [P2P Probe] starting device service...
echo wallet=%WALLET_ID%
echo host=%HOST%
echo port=%PORT%
echo udp_port=%UDP_PORT%
echo advertise_host=%ADVERTISE_HOST%
if not "%RELAY_URL%"=="" echo relay_url=%RELAY_URL%
if not "%BLACKLIST%"=="" echo blacklist=%BLACKLIST%
echo.
echo If Windows firewall prompts, allow Node.js on private network.
echo.
node tools\p2p_probe_device.js serve ^
  --wallet-id "%WALLET_ID%" ^
  --host "%HOST%" ^
  --port "%PORT%" ^
  --udp-port "%UDP_PORT%" ^
  --advertise-host "%ADVERTISE_HOST%" ^
  --enable-relay "%ENABLE_RELAY%" ^
  --relay-url "%RELAY_URL%" ^
  --blacklist "%BLACKLIST%"
goto end

:run_probe
if "%~2"=="" (
  echo Usage: start_p2p_probe.bat probe http://TARGET_IP:9777
  goto end
)
node tools\p2p_probe_device.js probe --target "%~2"
goto end

:run_direct
if "%~2"=="" (
  echo Usage: start_p2p_probe.bat direct-send http://TARGET_IP:9777
  goto end
)
node tools\p2p_probe_device.js direct-send ^
  --wallet-id "%WALLET_ID%" ^
  --port 9781 ^
  --udp-port 9781 ^
  --advertise-host "%ADVERTISE_HOST%" ^
  --target "%~2" ^
  --text "hello-direct"
goto end

:run_holepunch
if "%~2"=="" (
  echo Usage: start_p2p_probe.bat holepunch-send http://TARGET_IP:9777
  goto end
)
node tools\p2p_probe_device.js holepunch-send ^
  --wallet-id "%WALLET_ID%" ^
  --host "%HOST%" ^
  --port 9782 ^
  --udp-port 9782 ^
  --advertise-host "%ADVERTISE_HOST%" ^
  --target "%~2" ^
  --text "hello-udp"
goto end

:run_relay
if "%~2"=="" (
  echo Usage: start_p2p_probe.bat relay-send TARGET_WALLET_ID
  echo Requires RELAY_URL to be set in this file first.
  goto end
)
if "%RELAY_URL%"=="" (
  echo RELAY_URL is empty. Edit start_p2p_probe.bat first.
  goto end
)
node tools\p2p_probe_device.js relay-send ^
  --wallet-id "%WALLET_ID%" ^
  --port 9783 ^
  --udp-port 9783 ^
  --advertise-host "%ADVERTISE_HOST%" ^
  --relay "%RELAY_URL%" ^
  --target-wallet "%~2" ^
  --text "hello-relay"
goto end

:end
echo.
pause
endlocal
