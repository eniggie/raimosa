# RAIMOSA AI — native Windows shell.
#
#   powershell -ExecutionPolicy Bypass -File .\native\windows\RAIMOSA.ps1
#
# A WinForms window hosting Microsoft's WebView2 control. It owns the RAIMOSA
# runtime: the local Node server starts as a child process and is terminated
# when the window closes, so no authority can outlive the window that showed
# it — the same contract the macOS shell holds to.
#
# Node is bundled (vendor/node/win-<arch>), so a downloaded copy needs nothing
# installed. UNVERIFIED ON REAL WINDOWS HARDWARE — written and reviewed on
# macOS. Treat the first launch as a test, not a release.

$ErrorActionPreference = 'Stop'
$MinNodeMajor = 22
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Entry = Join-Path $Root 'app\bin\raimosa.mjs'

function Fail { param($m) [System.Windows.Forms.MessageBox]::Show($m, 'RAIMOSA AI') | Out-Null; exit 1 }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# --- Resolve Node. Prefer the bundled runtime so a downloaded copy needs
#     nothing installed; fall back to a system Node only if the bundled one is
#     absent (e.g. an unsupported CPU architecture). ---
$arch = if ([Environment]::Is64BitOperatingSystem) {
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
} else { 'x64' }
$bundledNode = Join-Path $Root "vendor\node\win-$arch\node.exe"

if (Test-Path $bundledNode) {
  $nodeExe = $bundledNode
} else {
  $sys = Get-Command node -ErrorAction SilentlyContinue
  if (-not $sys) {
    Fail "This build has no bundled Node for your CPU ($arch) and none is installed.`n`nInstall Node.js $MinNodeMajor+ from https://nodejs.org, then reopen RAIMOSA."
  }
  $sysMajor = [int](& node -p 'process.versions.node.split(".")[0]')
  if ($sysMajor -lt $MinNodeMajor) {
    Fail "The installed Node $(& node -v) is too old. RAIMOSA needs Node $MinNodeMajor or newer."
  }
  $nodeExe = $sys.Source
}
if (-not (Test-Path $Entry)) { Fail "The RAIMOSA runtime is missing at:`n$Entry" }

# WebView2 ships with Edge on current Windows, but say so clearly when absent.
$webViewAssembly = Get-ChildItem -Path "$Root\app\node_modules" -Filter 'Microsoft.Web.WebView2.WinForms.dll' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $webViewAssembly) {
  $webViewAssembly = Get-ChildItem -Path "${env:ProgramFiles(x86)}\Microsoft\EdgeWebView" -Filter 'Microsoft.Web.WebView2.WinForms.dll' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
}

# --- Start the runtime on a free-ish port ---
$port = Get-Random -Minimum 4200 -Maximum 4899
$runtime = Start-Process -FilePath $nodeExe `
  -ArgumentList @($Entry, '--port', $port, '--no-open') `
  -PassThru -WindowStyle Hidden `
  -Environment @{ RAIMOSA_NATIVE = 'windows' } 2>$null
if (-not $runtime) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $nodeExe
  $psi.Arguments = "`"$Entry`" --port $port --no-open"
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.EnvironmentVariables['RAIMOSA_NATIVE'] = 'windows'
  $runtime = [System.Diagnostics.Process]::Start($psi)
}

# --- Wait for the runtime to actually answer before showing anything ---
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/raimosa/health" -TimeoutSec 2 -UseBasicParsing
    if ($response.StatusCode -eq 200) { $ready = $true; break }
  } catch { Start-Sleep -Milliseconds 250 }
}
if (-not $ready) {
  if ($runtime -and -not $runtime.HasExited) { $runtime.Kill() }
  Fail 'The RAIMOSA runtime did not become ready.'
}

# --- Window ---
$form = New-Object System.Windows.Forms.Form
$form.Text = 'RAIMOSA AI'
$form.Width = 1440
$form.Height = 940
$form.MinimumSize = New-Object System.Drawing.Size(1120, 720)
$form.StartPosition = 'CenterScreen'
$form.BackColor = [System.Drawing.Color]::FromArgb(7, 3, 13)

$hosted = $false
if ($webViewAssembly) {
  try {
    Add-Type -Path $webViewAssembly.FullName
    $webView = New-Object Microsoft.Web.WebView2.WinForms.WebView2
    $webView.Dock = 'Fill'
    $form.Controls.Add($webView)
    $webView.Source = [Uri]"http://localhost:$port"
    $hosted = $true
  } catch {
    $hosted = $false
  }
}

if (-not $hosted) {
  # Never pretend: if WebView2 cannot be hosted, say so and hand the owner a
  # working path rather than showing an empty frame.
  $label = New-Object System.Windows.Forms.Label
  $label.Text = "RAIMOSA is running at http://localhost:$port`n`nWebView2 could not be hosted in this window.`nOpening it in your browser instead."
  $label.ForeColor = [System.Drawing.Color]::White
  $label.Dock = 'Fill'
  $label.TextAlign = 'MiddleCenter'
  $form.Controls.Add($label)
  Start-Process "http://localhost:$port"
}

# --- Terminate the runtime with the window, always ---
$form.Add_FormClosing({
  if ($runtime -and -not $runtime.HasExited) {
    try { $runtime.CloseMainWindow() | Out-Null } catch {}
    Start-Sleep -Milliseconds 400
    if (-not $runtime.HasExited) { $runtime.Kill() }
  }
})

[void]$form.ShowDialog()
