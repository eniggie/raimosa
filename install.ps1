# RAIMOSA AI installer — Windows (PowerShell 5.1+).
#
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#
# Installs into this checkout and puts a `raimosa` command on your PATH.
# Nothing is installed system-wide and nothing needs Administrator.

$ErrorActionPreference = 'Stop'
$MinNodeMajor = 22
$AppDir = Join-Path $PSScriptRoot 'app'

function Say  { param($m) Write-Host "  $m" }
function Fail { param($m) Write-Host ""; Write-Host "  ERROR: $m" -ForegroundColor Red; Write-Host ""; exit 1 }

Write-Host ""
Write-Host "  RAIMOSA AI installer"
Write-Host ""

# 1. Node
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail @"
Node.js is not installed.
  RAIMOSA needs Node $MinNodeMajor or newer for its built-in SQLite ledger.
  Install it from https://nodejs.org (or: winget install OpenJS.NodeJS)
  and run this installer again.
"@
}

$nodeMajor = [int](node -p 'process.versions.node.split(".")[0]')
if ($nodeMajor -lt $MinNodeMajor) {
  Fail @"
Node $(node -v) is too old — RAIMOSA needs Node $MinNodeMajor+.
  Node $MinNodeMajor is the first release with the built-in SQLite used by
  the receipt ledger. Upgrade from https://nodejs.org and try again.
"@
}
Say "Node $(node -v) - OK"

if (-not (Test-Path $AppDir)) { Fail "Cannot find the app directory at $AppDir" }
Set-Location $AppDir

# 2. Dependencies
Say "Installing dependencies..."
if (Test-Path 'package-lock.json') { npm ci --no-audit --no-fund | Out-Null }
else { npm install --no-audit --no-fund | Out-Null }

# 3. Build the interface
Say "Building the interface..."
npm run build | Out-Null

# 4. Verify before claiming success
Say "Verifying the install..."
npm test *> $null
if ($LASTEXITCODE -ne 0) { Fail "The verification suite failed. Nothing was linked." }

# 5. Put `raimosa` on PATH
npm link *> $null
if ($LASTEXITCODE -eq 0) {
  Say "Linked the 'raimosa' command."
  $launch = "raimosa"
} else {
  Say "Could not link globally. Use the local command instead."
  $launch = "npm start --prefix `"$AppDir`""
}

Write-Host ""
Write-Host "  RAIMOSA AI is installed."
Write-Host ""
Write-Host "    Start it:   $launch"
Write-Host "    Options:    raimosa --port 5000 --no-open"
Write-Host ""
Write-Host "  It runs entirely on this machine. The adapter API answers loopback"
Write-Host "  requests only, and a paired phone is limited to your local network."
Write-Host ""
