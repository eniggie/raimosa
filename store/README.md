# RAIMOSA in the app stores — the honest picture

Short version: **Microsoft Store is possible** (the packaging is prepared here).
**The Mac App Store is not**, for a reason no amount of work removes.

---

## Mac App Store — not possible for this product

Every app on the Mac App Store must run inside the **App Sandbox**. RAIMOSA's
entire purpose is the exact set of things the sandbox exists to forbid:

| RAIMOSA does this | Sandbox verdict |
|---|---|
| Spawns a bundled **Node runtime** as a child process | Forbidden — no arbitrary executable spawning |
| **Launches and quits** other applications (`open`, `osascript`) | Forbidden |
| **Sleep / restart / shut down** the machine (`pmset`, `osascript`) | Forbidden |
| **Captures the screen** (`screencapture`) | Forbidden without a sandbox-only API |
| Reads/organizes files across folders **you** approve | Only via user-selected scoped bookmarks, not RAIMOSA's own model |
| Runs a **local HTTP server** the UI talks to | Effectively incompatible with review |

This is not a certificate or paperwork gap — it is what RAIMOSA *is*. Sandboxing
it would mean deleting the product.

**The correct Apple channel for a tool like this is exactly what RAIMOSA already
uses: Developer ID signing + Apple notarization.** Apple built that path for
powerful utilities that can't live in the sandboxed store. The notarized `.dmg`
in `dist-release/` opens with a plain double-click on any Mac, with no warning —
it is already "Apple-blessed distribution," just not the storefront. Distributing
it yourself (your site, a download link) is the standard, legitimate route for
this class of app (the same one used by developer tools, backup utilities, and
automation apps that Apple won't sandbox either).

---

## Microsoft Store — possible; packaging is prepared

Microsoft **does** accept full-trust desktop apps (via the `runFullTrust`
capability), so RAIMOSA can go on the Microsoft Store as an MSIX package. What's
in `store/windows/`:

- `AppxManifest.xml` — the MSIX manifest (full-trust desktop app, tiles, splash)
- `RAIMOSA-launcher.cs` — a tiny entry-point exe that launches the tested shell
- `package.ps1` — builds the `.msix` on Windows (compiles the launcher, stages
  the app + bundled Node + shell, runs MakeAppx)
- `assets/` — all the Store logo/tile sizes, generated from the app icon

### What only you can do (I can't from this Mac)

1. **Register a Microsoft Partner Center developer account** — one-time fee
   (~$19 individual / ~$99 company). https://partner.microsoft.com/dashboard
   *(I can't create accounts or make payments.)*
2. **Reserve the app name** "RAIMOSA AI" in Partner Center → it gives you the
   **Package Identity Name**, **Publisher**, and **Publisher CN**.
3. On a **Windows machine** with the Windows SDK installed:
   - run `native/fetch-node.sh` (Git Bash or WSL) to fetch the bundled Node,
   - `powershell -File store\windows\package.ps1 -PublisherCN "<CN from step 2>"`
   - this produces `dist-store\RAIMOSA-<version>.msix`.
4. **Upload the `.msix`** in Partner Center. The Store signs it and runs
   certification (full-trust apps get extra review — expect a few days).

### Honesty flags

- The Windows shell is **still unverified on real Windows hardware** — it was
  written and reviewed on macOS. Test the `.msix` on a real PC before you submit;
  Store certification will exercise it anyway.
- MSIX packaging **cannot be built on macOS** (MakeAppx is Windows-only), so
  everything up to the `.msix` is prepared, but the build+submit happens on
  Windows.

---

## Recommended distribution, today

- **macOS:** ship the notarized `.dmg` yourself. It is already the right answer.
- **Windows:** ship the self-contained `.zip` now; pursue the Microsoft Store
  when you want the storefront reach, using the prepared package above.
- **Linux:** ship the self-contained `.tar.gz` (no store applies).
