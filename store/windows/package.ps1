# RAIMOSA AI — build a Microsoft Store MSIX package.
#
#   powershell -ExecutionPolicy Bypass -File .\store\windows\package.ps1
#
# RUN THIS ON WINDOWS. MSIX packaging needs MakeAppx.exe from the Windows SDK,
# which does not exist on macOS — so this can only be built on a Windows
# machine. It:
#   1. compiles the tiny C# launcher with the built-in csc.exe,
#   2. stages the app, the bundled Node runtime, and the shell,
#   3. substitutes the Publisher identity Partner Center assigned you,
#   4. calls MakeAppx to produce RAIMOSA-<version>.msix.
#
# The unsigned .msix is what you upload to Partner Center; the Store signs it.
# For local testing, sign it with your own dev certificate (see the README).

param(
  [string]$PublisherCN = $env:RAIMOSA_PUBLISHER_CN  # e.g. "CN=ECONTEUR LLC, O=..., C=US"
)

$ErrorActionPreference = 'Stop'
$Store = $PSScriptRoot
$Root  = Split-Path -Parent (Split-Path -Parent $Store)
$Out   = Join-Path $Root 'dist-store'
$Stage = Join-Path $Out 'msix-stage'
$Version = (node -p "require('$Root/app/package.json').version") + '.0'

function Say { param($m) Write-Host "  $m" }
function Fail { param($m) Write-Host "`n  ERROR: $m`n" -ForegroundColor Red; exit 1 }

Write-Host "`n  RAIMOSA AI — Microsoft Store package $Version`n"

# --- Locate the Windows SDK tools ---
$makeappx = (Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Recurse -Filter MakeAppx.exe -ErrorAction SilentlyContinue |
             Sort-Object FullName -Descending | Select-Object -First 1)
if (-not $makeappx) { Fail "MakeAppx.exe not found. Install the Windows SDK (or Visual Studio with the SDK component)." }

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { Fail "csc.exe (.NET Framework compiler) not found." }

# --- Ensure the bundled Node runtimes exist (Git Bash / WSL can run fetch-node.sh) ---
if (-not (Test-Path "$Root\vendor\node\win-x64\node.exe")) {
  Fail "vendor\node\win-x64\node.exe is missing. Run native/fetch-node.sh first (Git Bash or WSL)."
}

# --- Stage the package ---
if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path "$Stage\app","$Stage\native\windows","$Stage\vendor\node","$Stage\assets" | Out-Null
Copy-Item "$Root\app\bin","$Root\app\server","$Root\app\dist" "$Stage\app" -Recurse
Copy-Item "$Root\app\package.json" "$Stage\app"
Copy-Item "$Root\native\windows\RAIMOSA.ps1" "$Stage\native\windows"
Copy-Item "$Root\vendor\node\win-x64" "$Stage\vendor\node" -Recurse
Copy-Item "$Store\assets\*" "$Stage\assets"

# --- Compile the launcher ---
Say "Compiling the launcher…"
& $csc /nologo /target:winexe /out:"$Stage\RAIMOSA.exe" `
  /reference:System.Windows.Forms.dll "$Store\RAIMOSA-launcher.cs"
if ($LASTEXITCODE -ne 0) { Fail "Launcher compilation failed." }

# --- Manifest with the real identity ---
$manifest = Get-Content "$Store\AppxManifest.xml" -Raw
if ($PublisherCN) { $manifest = $manifest -replace 'CN=__PUBLISHER_CN__', $PublisherCN }
elseif ($manifest -match '__PUBLISHER_CN__') {
  Say "NOTE: no Publisher CN supplied. Set RAIMOSA_PUBLISHER_CN or pass -PublisherCN"
  Say "      with the value from Partner Center before submitting."
}
$manifest = $manifest -replace 'Version="0\.0\.0\.0"', "Version=`"$Version`""
Set-Content "$Stage\AppxManifest.xml" $manifest -Encoding UTF8

# --- Build the MSIX ---
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$msix = Join-Path $Out "RAIMOSA-$Version.msix"
Say "Packing the MSIX…"
& $makeappx.FullName pack /d $Stage /p $msix /o | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "MakeAppx failed." }

Say "Built $msix"
Write-Host "`n  Next: upload this .msix in Partner Center (Store signs it), or sign it"
Write-Host "  with a local dev cert to test — see store/windows/README.md.`n"
