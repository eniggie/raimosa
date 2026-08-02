#!/usr/bin/env python3
"""Build RAIMOSA raster brand deliverables from the approved transparent emblem."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps


BRAND_DIR = Path(__file__).resolve().parents[1]
EMBLEM_PATH = BRAND_DIR / "logo" / "raimosa-r-capabilities-transparent.png"
BACKGROUND_PATH = BRAND_DIR / "splash" / "assets" / "command-nexus-background-1920x1080.png"

ROYAL_BLACK = "#07030D"
OBSIDIAN_PURPLE = "#17082E"
ROYAL_PURPLE = "#6D28D9"
IMPERIAL_VIOLET = "#8B5CF6"
ROYAL_GOLD = "#D6A843"
GOLD_LIGHT = "#F6D782"
DIVINE_IVORY = "#F8F3E7"
MUTED_IVORY = "#C7BEAD"

DISPLAY_FONT = Path("/System/Library/Fonts/Avenir Next.ttc")
INTERFACE_FONT = Path("/System/Library/Fonts/Avenir.ttc")


def font(size: int, *, bold: bool = False, condensed: bool = False) -> ImageFont.FreeTypeFont:
    path = Path("/System/Library/Fonts/Avenir Next Condensed.ttc") if condensed else DISPLAY_FONT
    index = 1 if bold else 0
    return ImageFont.truetype(str(path), size=size, index=index)


def alpha_crop(image: Image.Image, padding: int = 0) -> Image.Image:
    rgba = image.convert("RGBA")
    bbox = rgba.getchannel("A").getbbox()
    if not bbox:
        return rgba
    left, top, right, bottom = bbox
    return rgba.crop(
        (
            max(0, left - padding),
            max(0, top - padding),
            min(rgba.width, right + padding),
            min(rgba.height, bottom + padding),
        )
    )


def contained(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    result = image.copy()
    result.thumbnail(size, Image.Resampling.LANCZOS)
    return result


def paste_center(canvas: Image.Image, image: Image.Image, center: tuple[int, int]) -> None:
    x = center[0] - image.width // 2
    y = center[1] - image.height // 2
    canvas.alpha_composite(image, (x, y))


def text_width(draw: ImageDraw.ImageDraw, text: str, text_font: ImageFont.FreeTypeFont, spacing: int) -> int:
    widths = [int(draw.textlength(char, font=text_font)) for char in text]
    return sum(widths) + spacing * max(0, len(text) - 1)


def draw_tracked_text(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    text_font: ImageFont.FreeTypeFont,
    fill: str,
    spacing: int,
    *,
    anchor: str = "la",
) -> tuple[int, int]:
    width = text_width(draw, text, text_font, spacing)
    x, y = xy
    if anchor.startswith("m"):
        x -= width // 2
    elif anchor.startswith("r"):
        x -= width
    start_x = x
    for char in text:
        draw.text((x, y), char, font=text_font, fill=fill, anchor="la")
        x += int(draw.textlength(char, font=text_font)) + spacing
    return start_x, width


def build_app_icon(emblem: Image.Image) -> Image.Image:
    size = 1024
    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    field = Image.new("RGBA", (size, size), ROYAL_BLACK)

    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse((170, 105, 854, 789), fill=(109, 40, 217, 118))
    glow = glow.filter(ImageFilter.GaussianBlur(155))
    field.alpha_composite(glow)

    mask = Image.new("L", (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle((28, 28, 996, 996), radius=222, fill=255)
    tile.alpha_composite(Image.composite(field, Image.new("RGBA", field.size), mask))

    tile_draw = ImageDraw.Draw(tile)
    tile_draw.rounded_rectangle((42, 42, 982, 982), radius=210, outline=ROYAL_GOLD, width=5)
    tile_draw.rounded_rectangle((56, 56, 968, 968), radius=198, outline=(109, 40, 217, 145), width=3)

    mark = contained(alpha_crop(emblem, 4), (880, 880))
    shadow = Image.new("RGBA", tile.size, (0, 0, 0, 0))
    shadow_mark = mark.getchannel("A").filter(ImageFilter.GaussianBlur(24))
    purple_shadow = Image.new("RGBA", mark.size, (109, 40, 217, 150))
    purple_shadow.putalpha(shadow_mark)
    shadow.alpha_composite(purple_shadow, ((size - mark.width) // 2, (size - mark.height) // 2 + 8))
    tile.alpha_composite(shadow)
    paste_center(tile, mark, (size // 2, size // 2 - 2))
    return tile


def build_platform_icons(app_icon: Image.Image) -> None:
    png_dir = BRAND_DIR / "icons" / "png"
    linux_dir = BRAND_DIR / "icons" / "linux"
    mac_dir = BRAND_DIR / "icons" / "macos"
    windows_dir = BRAND_DIR / "icons" / "windows"
    favicon_dir = BRAND_DIR / "favicon"
    for directory in (png_dir, linux_dir, mac_dir, windows_dir, favicon_dir):
        directory.mkdir(parents=True, exist_ok=True)

    app_icon.save(png_dir / "raimosa-app-icon-1024.png")
    sizes = (16, 24, 32, 48, 64, 128, 192, 256, 512)
    for size in sizes:
        resized = app_icon.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(png_dir / f"raimosa-app-icon-{size}.png")
        resized.save(linux_dir / f"raimosa-{size}x{size}.png")
    app_icon.save(linux_dir / "raimosa-1024x1024.png")

    app_icon.save(
        windows_dir / "RAIMOSA.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    app_icon.save(favicon_dir / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    for size in (16, 32, 48, 64):
        app_icon.resize((size, size), Image.Resampling.LANCZOS).save(favicon_dir / f"favicon-{size}.png")
    app_icon.resize((180, 180), Image.Resampling.LANCZOS).save(favicon_dir / "apple-touch-icon.png")

    iconset = mac_dir / "RAIMOSA.iconset"
    iconset.mkdir(parents=True, exist_ok=True)
    mapping = {
        "icon_16x16.png": 16,
        "icon_16x16@2x.png": 32,
        "icon_32x32.png": 32,
        "icon_32x32@2x.png": 64,
        "icon_128x128.png": 128,
        "icon_128x128@2x.png": 256,
        "icon_256x256.png": 256,
        "icon_256x256@2x.png": 512,
        "icon_512x512.png": 512,
        "icon_512x512@2x.png": 1024,
    }
    for filename, size in mapping.items():
        app_icon.resize((size, size), Image.Resampling.LANCZOS).save(iconset / filename)


def build_horizontal_lockup(emblem: Image.Image) -> None:
    canvas = Image.new("RGBA", (2400, 720), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    mark = contained(alpha_crop(emblem, 8), (560, 560))
    paste_center(canvas, mark, (340, 355))

    display = font(154, bold=True)
    ai_font = font(58, bold=True)
    tagline_font = font(30, bold=False, condensed=True)
    x = 690
    draw_tracked_text(draw, (x, 170), "RAIMOSA", display, DIVINE_IVORY, 24)
    draw_tracked_text(draw, (2055, 244), "AI", ai_font, ROYAL_GOLD, 8)
    draw.line((695, 403, 2195, 403), fill=ROYAL_PURPLE, width=5)
    draw.ellipse((2225, 397, 2237, 409), fill=ROYAL_GOLD)
    draw_tracked_text(
        draw,
        (696, 454),
        "COMMAND YOUR WORLD WITH INTELLIGENCE",
        tagline_font,
        ROYAL_GOLD,
        10,
    )
    canvas.save(BRAND_DIR / "logo" / "raimosa-logo-horizontal.png")


def build_stacked_lockup(emblem: Image.Image) -> None:
    canvas = Image.new("RGBA", (1400, 1600), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    mark = contained(alpha_crop(emblem, 8), (890, 890))
    paste_center(canvas, mark, (700, 485))

    display = font(140, bold=True)
    ai_font = font(50, bold=True)
    tagline_font = font(31, condensed=True)
    draw_tracked_text(draw, (700, 1004), "RAIMOSA", display, DIVINE_IVORY, 23, anchor="ma")
    draw_tracked_text(draw, (700, 1194), "AI", ai_font, ROYAL_GOLD, 8, anchor="ma")
    draw.line((270, 1298, 1130, 1298), fill=ROYAL_PURPLE, width=5)
    draw_tracked_text(
        draw,
        (700, 1350),
        "COMMAND YOUR WORLD",
        tagline_font,
        ROYAL_GOLD,
        12,
        anchor="ma",
    )
    draw_tracked_text(
        draw,
        (700, 1410),
        "WITH INTELLIGENCE",
        tagline_font,
        ROYAL_GOLD,
        12,
        anchor="ma",
    )
    canvas.save(BRAND_DIR / "logo" / "raimosa-logo-stacked.png")


def build_static_splash(emblem: Image.Image) -> None:
    background = Image.open(BACKGROUND_PATH).convert("RGBA")
    background = ImageOps.fit(background, (1920, 1080), method=Image.Resampling.LANCZOS)
    veil = Image.new("RGBA", background.size, (7, 3, 13, 95))
    background.alpha_composite(veil)

    mark = contained(alpha_crop(emblem, 4), (440, 440))
    paste_center(background, mark, (960, 425))
    draw = ImageDraw.Draw(background)
    display = font(78, bold=True)
    ai_font = font(29, bold=True)
    tagline_font = font(21, condensed=True)
    support_font = font(16, bold=True, condensed=True)
    draw_tracked_text(draw, (960, 637), "RAIMOSA", display, DIVINE_IVORY, 20, anchor="ma")
    draw_tracked_text(draw, (1311, 676), "AI", ai_font, ROYAL_GOLD, 5)
    draw_tracked_text(
        draw,
        (960, 750),
        "COMMAND YOUR WORLD WITH INTELLIGENCE",
        tagline_font,
        ROYAL_GOLD,
        8,
        anchor="ma",
    )
    draw_tracked_text(
        draw,
        (960, 815),
        "OBSERVE  •  COORDINATE  •  EXECUTE  •  REPORT  •  AUTOMATE  •  PROTECT",
        support_font,
        MUTED_IVORY,
        3,
        anchor="ma",
    )
    output = BRAND_DIR / "splash" / "assets" / "raimosa-splash-static-1920x1080.png"
    background.convert("RGB").save(output, quality=95)


def build_capability_key(emblem: Image.Image) -> None:
    canvas = Image.new("RGBA", (1920, 1080), ROYAL_BLACK)
    draw = ImageDraw.Draw(canvas)
    mark = contained(alpha_crop(emblem, 4), (900, 900))
    paste_center(canvas, mark, (530, 555))

    title_font = font(42, bold=True)
    label_font = font(28, bold=True)
    body_font = font(20)
    draw_tracked_text(draw, (1040, 128), "RAIMOSA CAPABILITY SIGNS", title_font, DIVINE_IVORY, 6)

    items = [
        ("01", "OBSERVE", "Understands approved desktop activity and context."),
        ("02", "COORDINATE AI", "Orchestrates supported models, tools, and workflows."),
        ("03", "EXECUTE", "Carries out explicitly approved actions and follow-ups."),
        ("04", "REPORT", "Communicates progress, status, results, and alerts."),
        ("05", "AUTOMATE", "Runs repeatable workflows and monitors long jobs."),
        ("06", "PROTECT", "Uses consent, least privilege, and auditable controls."),
    ]
    y = 260
    for number, label, description in items:
        draw.ellipse((1040, y - 4, 1104, y + 60), outline=ROYAL_GOLD, width=2)
        draw.text((1072, y + 28), number, font=font(17, bold=True), fill=ROYAL_GOLD, anchor="mm")
        draw_tracked_text(draw, (1135, y), label, label_font, DIVINE_IVORY, 3)
        draw.text((1137, y + 45), description, font=body_font, fill=MUTED_IVORY)
        y += 125
    canvas.convert("RGB").save(BRAND_DIR / "previews" / "capability-symbol-key.png", quality=95)


def main() -> None:
    emblem = Image.open(EMBLEM_PATH).convert("RGBA")
    alpha_crop(emblem, 8).save(BRAND_DIR / "logo" / "raimosa-r-capabilities-transparent-tight.png")
    app_icon = build_app_icon(emblem)
    build_platform_icons(app_icon)
    build_horizontal_lockup(emblem)
    build_stacked_lockup(emblem)
    build_static_splash(emblem)
    build_capability_key(emblem)
    print(f"Built RAIMOSA brand outputs from {EMBLEM_PATH}")


if __name__ == "__main__":
    main()
