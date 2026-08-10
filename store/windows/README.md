# RAIMOSA AI — Microsoft Store (MSIX) build & submit

MSIX packaging needs `MakeAppx.exe` from the Windows SDK, which exists only on
Windows. Everything that *can* be prepared on macOS already is: the manifest
carries your real Partner Center identity
(`Publisher="CN=EC901829-51E2-4D1D-9115-BC8F5EF62C3C"`,
`Name="ECONTEURLLC.RAIMOSAAI"`), the launcher, the assets, and `package.ps1`.

Do this on a Windows 10/11 machine (or VM).

## One-time setup on the Windows box

1. **Install the Windows SDK** — either the standalone
   [Windows SDK](https://developer.microsoft.com/windows/downloads/windows-sdk/)
   or Visual Studio with the "Desktop development" workload. This provides
   `MakeAppx.exe`.
2. **Install Node 22+** from nodejs.org.
3. **Get the repo** onto the machine (clone `github.com/eniggie/raimosa`).
4. **Fetch the bundled Node runtimes** (needs Git Bash or WSL):
   ```bash
   ./native/fetch-node.sh
   ```
   This must produce `vendor\node\win-x64\node.exe` — `package.ps1` checks for it.

## Build the MSIX

```powershell
powershell -ExecutionPolicy Bypass -File .\store\windows\package.ps1
```

Output: `dist-store\RAIMOSA-<version>.msix`. The manifest identity is already
correct, so no `-PublisherCN` is needed. (If you ever re-key with a different
Partner Center CN, pass `-PublisherCN "CN=..."`.)

## Test it locally before submitting

The `.msix` is unsigned (the Store signs it on ingestion). To run it on your own
machine first, sign it with a self-signed dev cert whose subject **exactly
matches** the manifest Publisher:

```powershell
$cn = "CN=EC901829-51E2-4D1D-9115-BC8F5EF62C3C"
$cert = New-SelfSignedCertificate -Type Custom -Subject $cn `
  -KeyUsage DigitalSignature -CertStoreLocation "Cert:\CurrentUser\My" `
  -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3")
# Trust it (Admin PowerShell), then sign:
$pwd = ConvertTo-SecureString -String "test" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath dev.pfx -Password $pwd
$st = (Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Recurse -Filter signtool.exe |
       Sort FullName -Desc | Select -First 1).FullName
& $st sign /fd SHA256 /a /f dev.pfx /p test dist-store\RAIMOSA-<version>.msix
Add-AppxPackage dist-store\RAIMOSA-<version>.msix
```

Launch RAIMOSA from the Start Menu. Confirm: the window opens, `/health` reports
its capabilities, a governed action writes a ledger receipt, and Pro activation
works. **This is also the first real-hardware test of the Windows shell** — if
the window doesn't appear, the runtime still serves on the localhost URL it
prints (see `START HERE.txt` in the release zip).

Uninstall the test: `Remove-AppxPackage ECONTEURLLC.RAIMOSAAI_...`.

## Submit

1. In [Partner Center](https://partner.microsoft.com/dashboard) → your reserved
   app **RAIMOSA AI** → **Packages** → upload the **unsigned** `.msix`.
2. Fill the listing from `store/windows/listing.md`; privacy policy from
   `store/windows/PRIVACY.md` (host it at a public URL, e.g. on the landing
   page).
3. Submit for certification.

## winget (parallel channel)

Once the Store build runs cleanly on real hardware, the winget manifests in
`store/winget/manifests/e/ECONTEURLLC/RAIMOSA/0.1.0/` are ready to PR to
`microsoft/winget-pkgs` via `wingetcreate submit`. winget's CI runs the package
on a real Windows VM — so do the local test above first.
