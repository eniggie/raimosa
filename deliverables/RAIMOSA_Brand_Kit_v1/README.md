# RAIMOSA AI Brand System

RAIMOSA AI is an intelligent Desktop Commander. Its identity combines a clearly readable capital **R** with a royal-purple inlay, gold structural edges, and a command ring carrying six real product capabilities.

## Core line

**RAIMOSA AI**  
**Command Your World With Intelligence**

The tagline is title case in prose and may be uppercase with generous tracking in display lockups.

## Capability signs

The medallions map clockwise from the upper left:

1. **Observe — eye:** understands approved desktop activity and context.
2. **Coordinate AI — connected nodes:** orchestrates supported models, tools, and workflows.
3. **Execute — forward arrow:** carries out explicitly approved actions and follow-ups.
4. **Report — status bars:** communicates progress, results, and alerts.
5. **Automate — circular arrows and gear:** runs repeatable workflows and monitors long jobs.
6. **Protect — shield and keyhole:** uses consent, least privilege, and auditable controls.

These six signs replace the earlier crown, sun, flame, globe, scales, and generic-shield symbolism.

## Palette

| Token | Hex | Use |
| --- | --- | --- |
| Royal Black | `#07030D` | Application field and chrome |
| Obsidian Purple | `#17082E` | Raised surfaces and depth |
| Royal Purple | `#6D28D9` | Dominant brand action color |
| Imperial Violet | `#8B5CF6` | Focus and active states |
| Electric Lavender | `#A78BFA` | Restrained digital glow |
| Royal Gold | `#D6A843` | Structural edge and premium accent |
| Gold Light | `#F6D782` | Highlight, not body copy |
| Divine Ivory | `#F8F3E7` | Primary text on dark surfaces |

Purple is visually dominant. Gold frames the R and identifies the capability signs.

## Logo rules

- The approved canonical logo is `logo/raimosa-r-capabilities-transparent.png`.
- Preserve clear space equal to one medallion diameter on every side.
- Do not place any spear, star, jewel, letter A, or other obstruction across the center of the R.
- Do not rearrange or replace the six capability signs without changing this specification.
- Use the full emblem at 96px and above. Use the app-icon tile or favicon exports below 96px.
- Do not rotate, stretch, recolor, outline, or place the transparent emblem over visually busy imagery.
- Minimum sizes: favicon 16px; application icon 32px; interface emblem 48px; print emblem 16mm.

## Typography

- Display: Avenir Next, with Montserrat or Inter as fallbacks.
- Interface: Inter, SF Pro Text, or Segoe UI.
- Display tracking is intentional. Body copy uses normal tracking for readability.

## Motion signature

The splash follows one narrative: **command field awakens → approved R resolves → six capability signs ignite clockwise → RAIMOSA promise appears → system reports online**.

The full reveal completes in 4.8 seconds and emits `raimosa:splash-ready` so Electron or Tauri can transition into the application. `?loop=1` enables a review loop. Reduced-motion preferences receive the completed identity immediately.

## Asset map

- `logo/raimosa-r-capabilities-transparent.png`: canonical transparent master.
- `logo/raimosa-r-capabilities-transparent-tight.png`: tightly cropped transparent master.
- `logo/raimosa-logo-horizontal.png`: horizontal lockup and tagline.
- `logo/raimosa-logo-stacked.png`: presentation lockup.
- `icons/png/`: app icons from 16px through 1024px.
- `icons/macos/RAIMOSA.icns`: macOS application icon.
- `icons/windows/RAIMOSA.ico`: Windows multi-resolution application icon.
- `icons/linux/`: Linux PNG icon set.
- `icons/raimosa-loader.svg`: animated lightweight loading mark.
- `favicon/favicon.ico`: multi-resolution browser favicon.
- `favicon/favicon-16.png`, `favicon/favicon-32.png`, `favicon/favicon-48.png`: browser PNG fallbacks.
- `favicon/apple-touch-icon.png`: 180px Apple touch icon.
- `splash/index.html`: animated production-oriented splash.
- `splash/assets/raimosa-splash-static-1920x1080.png`: static and reduced-motion fallback.
- `previews/capability-symbol-key.png`: visual capability legend.

## Generated-image provenance

The emblem and command-nexus background were produced with the built-in image-generation workflow using the supplied artwork as inspiration. The approved emblem was then background-extracted locally and validated as an RGBA PNG with transparent corners. Platform exports and lockups are deterministic builds produced by `tools/build_brand_assets.py`.
