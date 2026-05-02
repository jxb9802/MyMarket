$ErrorActionPreference = 'Stop'

function Compare-Version {
  param(
    [string]$A,
    [string]$B
  )
  $va = ($A.TrimStart('v') -split '\.')
  $vb = ($B.TrimStart('v') -split '\.')
  $len = [Math]::Max($va.Length, $vb.Length)
  for ($i = 0; $i -lt $len; $i++) {
    $la = if ($i -lt $va.Length) { [int]$va[$i] } else { 0 }
    $lb = if ($i -lt $vb.Length) { [int]$vb[$i] } else { 0 }
    if ($la -gt $lb) { return 1 }
    if ($la -lt $lb) { return -1 }
  }
  return 0
}

$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeVersion = if ($env:DEPLOY_AGENT_NODE_VERSION) { $env:DEPLOY_AGENT_NODE_VERSION } else { '24.14.0' }
$minNodeVersion = if ($env:DEPLOY_AGENT_MIN_NODE_VERSION) { $env:DEPLOY_AGENT_MIN_NODE_VERSION } else { '20.0.0' }
$nodeDir = Join-Path $baseDir '.agent_node'
$nodeExe = Join-Path $nodeDir 'node.exe'
$agentServer = Join-Path $baseDir 'agent_server.js'

$hostNode = $null
$hostNodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($hostNodeCmd) {
  $hostVersion = (& $hostNodeCmd.Source -p "process.version" 2>$null)
  if ($hostVersion -and (Compare-Version $hostVersion $minNodeVersion) -ge 0) {
    $hostNode = $hostNodeCmd.Source
  }
}

if (-not $hostNode) {
  if (-not (Test-Path $nodeExe)) {
    $arch = if ([Environment]::Is64BitOperatingSystem) {
      if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
    } else {
      throw 'unsupported 32-bit Windows'
    }
    $tmpDir = Join-Path $baseDir '.agent_node_tmp'
    $archive = "node-v$nodeVersion-win-$arch.zip"
    $url = "https://nodejs.org/dist/v$nodeVersion/$archive"
    Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $tmpDir | Out-Null
    $zipPath = Join-Path $tmpDir $archive
    Invoke-WebRequest -Uri $url -OutFile $zipPath
    Expand-Archive -LiteralPath $zipPath -DestinationPath $tmpDir -Force
    $srcDir = Get-ChildItem $tmpDir -Directory | Where-Object { $_.Name -like "node-v$nodeVersion-win-*" } | Select-Object -First 1
    if (-not $srcDir) {
      throw 'node archive extract failed'
    }
    Remove-Item -Recurse -Force $nodeDir -ErrorAction SilentlyContinue
    Move-Item $srcDir.FullName $nodeDir
    Remove-Item -Recurse -Force $tmpDir
  }
  $hostNode = $nodeExe
}

& $hostNode $agentServer
$exitCode = $LASTEXITCODE
if ($null -eq $exitCode) { $exitCode = 0 }
exit $exitCode
