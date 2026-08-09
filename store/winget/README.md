# RAIMOSA AI on winget (Windows Package Manager)

winget is Microsoft's official package manager, built into Windows 10/11. It
distributes RAIMOSA **without** the Microsoft Store, MSIX, Partner Center
enrollment, or a fee — it installs straight from the GitHub release.

Once the manifests here are accepted into the public catalog, anyone installs
RAIMOSA with:

```powershell
winget install ECONTEURLLC.RAIMOSA
```

## What's here

`manifests/e/ECONTEURLLC/RAIMOSA/0.1.0/` — the three-file manifest set winget
requires (version, installer, locale), already filled in and validated:

- installs the self-contained `RAIMOSA-0.1.0-windows.zip` from the release,
- exposes a `raimosa` command that runs `START-RAIMOSA.cmd`,
- verified SHA256 so winget refuses a tampered download.

## Submitting to the public catalog

The manifests must be merged into Microsoft's community repo,
[microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs). The easy path:

1. Install winget's own tool: `winget install wingetcreate`
2. From a Windows machine:
   ```powershell
   wingetcreate submit --token <github-token> store\winget\manifests\e\ECONTEURLLC\RAIMOSA\0.1.0
   ```
   or open a PR to winget-pkgs by hand with these three files.
3. Microsoft's automated validation **installs and runs the package on a real
   Windows VM.** This is the point where the "unverified on real Windows
   hardware" caveat matters — the Windows shell has not yet been run on real
   hardware, so test the `.zip` on a real PC first and fix anything that
   surfaces before submitting.

Nothing here needs a paid account. `winget install ECONTEURLLC.RAIMOSA` goes
live the moment the PR merges.

© ECONTEUR LLC
