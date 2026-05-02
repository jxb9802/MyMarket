@echo off

set "NODEJS_REQUIRED_MAJOR=24"
set "NODEJS_VERSION=24.14.0"
set "NODEJS_MSI_URL=https://nodejs.org/dist/v24.14.0/node-v24.14.0-x64.msi"
set "NODEJS_MSI_NAME=node-v24.14.0-x64.msi"
set "NODEJS_ZIP_URL=https://nodejs.org/dist/v24.14.0/node-v24.14.0-win-x64.zip"
set "NODEJS_ZIP_NAME=node-v24.14.0-win-x64.zip"
set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%SCRIPT_DIR%.."
set "PORTABLE_NODE_ROOT=%PROJECT_DIR%\tools\node-v24.14.0-win-x64"
set "PORTABLE_NODE_EXE=%PORTABLE_NODE_ROOT%\node.exe"
set "PORTABLE_NPM_CMD=%PORTABLE_NODE_ROOT%\npm.cmd"
set "NODEJS_INSTALL_DIR=%ProgramFiles%\nodejs"
set "NODE_EXE=%NODEJS_INSTALL_DIR%\node.exe"

call :has_compatible_node
if not errorlevel 1 exit /b 0

echo Node.js %NODEJS_REQUIRED_MAJOR%+ with node:sqlite was not found.
echo Attempting automatic install of Node.js v%NODEJS_VERSION% x64...

call :install_portable
if errorlevel 1 (
  echo Portable Node.js install failed. Trying winget...
  call :install_with_winget
  if errorlevel 1 (
    echo winget install did not complete successfully. Falling back to the official MSI...
    call :install_with_msi
    if errorlevel 1 (
      echo Automatic Node.js installation failed.
      exit /b 1
    )
  )
)

if exist "%PORTABLE_NODE_ROOT%" (
  set "PATH=%PORTABLE_NODE_ROOT%;%PATH%"
)
if exist "%NODEJS_INSTALL_DIR%" (
  set "PATH=%NODEJS_INSTALL_DIR%;%PATH%"
)
if defined APPDATA if exist "%APPDATA%\npm" (
  set "PATH=%APPDATA%\npm;%PATH%"
)
call :has_compatible_node
if errorlevel 1 (
  echo Node.js installation finished, but a compatible runtime is still not available in this shell.
  echo Expected location: %NODE_EXE%
  echo Please open a new terminal and run the launcher again.
  exit /b 1
)

echo Node.js is ready.
exit /b 0

:has_compatible_node_exe
set "CHECK_NODE_EXE=%~1"
if not defined CHECK_NODE_EXE exit /b 1
if not exist "%CHECK_NODE_EXE%" exit /b 1
"%CHECK_NODE_EXE%" -e "const major=Number(process.versions.node.split('.')[0]); if (!(major >= 24)) process.exit(1); require('node:sqlite');" >nul 2>nul || exit /b 1
exit /b 0

:has_compatible_node
if exist "%NODEJS_INSTALL_DIR%" (
  set "PATH=%NODEJS_INSTALL_DIR%;%PATH%"
)
if defined APPDATA if exist "%APPDATA%\npm" (
  set "PATH=%APPDATA%\npm;%PATH%"
)
where node >nul 2>nul && (
  node -e "const major=Number(process.versions.node.split('.')[0]); if (!(major >= 24)) process.exit(1); require('node:sqlite');" >nul 2>nul && exit /b 0
)
call :has_compatible_node_exe "%NODE_EXE%" && (
  set "PATH=%NODEJS_INSTALL_DIR%;%PATH%"
  exit /b 0
)
call :has_compatible_node_exe "%PORTABLE_NODE_EXE%" && (
  set "PATH=%PORTABLE_NODE_ROOT%;%PATH%"
  if exist "%PORTABLE_NPM_CMD%" set "PATH=%PORTABLE_NODE_ROOT%;%PATH%"
  exit /b 0
)
where node >nul 2>nul || exit /b 1
node -e "const major=Number(process.versions.node.split('.')[0]); if (!(major >= 24)) process.exit(1); require('node:sqlite');" >nul 2>nul || exit /b 1
exit /b 0

:install_portable
where powershell >nul 2>nul || exit /b 1
if exist "%PORTABLE_NODE_EXE%" exit /b 0
if not exist "%PROJECT_DIR%\tools" mkdir "%PROJECT_DIR%\tools"
set "TEMP_ZIP=%TEMP%\%NODEJS_ZIP_NAME%"
if exist "%TEMP_ZIP%" del /q "%TEMP_ZIP%" >nul 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing '%NODEJS_ZIP_URL%' -OutFile '%TEMP_ZIP%'"
if errorlevel 1 exit /b 1
if exist "%PORTABLE_NODE_ROOT%" rmdir /s /q "%PORTABLE_NODE_ROOT%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%TEMP_ZIP%' -DestinationPath '%PROJECT_DIR%\\tools' -Force"
if errorlevel 1 exit /b 1
if not exist "%PORTABLE_NODE_EXE%" exit /b 1
exit /b 0

:install_with_winget
where winget >nul 2>nul || exit /b 1
winget install --id OpenJS.NodeJS --version %NODEJS_VERSION% --exact --accept-source-agreements --accept-package-agreements --disable-interactivity
if errorlevel 1 exit /b 1
exit /b 0

:install_with_msi
where powershell >nul 2>nul || exit /b 1
set "TEMP_MSI=%TEMP%\%NODEJS_MSI_NAME%"
if exist "%TEMP_MSI%" del /q "%TEMP_MSI%" >nul 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing '%NODEJS_MSI_URL%' -OutFile '%TEMP_MSI%'"
if errorlevel 1 exit /b 1
msiexec /i "%TEMP_MSI%" /qn /norestart ADDLOCAL=NodeRuntime,npm
if errorlevel 1 exit /b 1
exit /b 0
