"""Generate Ostory TV raster logo and favicon assets from the brand geometry."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


DEPLOY_DIR = Path(__file__).resolve().parents[1]
STATIC_DIR = DEPLOY_DIR / "static"
BRAND_DIR = STATIC_DIR / "branding"

PURPLE = (91, 73, 240, 255)
VIOLET = (122, 91, 255, 255)
ORANGE = (255, 106, 61, 255)
PEACH = (255, 179, 143, 255)
INK = (23, 23, 28, 255)
WHITE = (255, 255, 255, 255)


def _font(size: int, *, bold: bool = True) -> ImageFont.FreeTypeFont:
    fonts = Path("C:/Windows/Fonts")
    candidates = [
        fonts / ("segoeuib.ttf" if bold else "segoeui.ttf"),
        fonts / ("arialbd.ttf" if bold else "arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default(size=size)


def _gradient_square(size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pixels = image.load()
    for y in range(size):
        for x in range(size):
            t = min(1.0, max(0.0, (x + y) / (2 * max(1, size - 1))))
            if t < 0.56:
                p = t / 0.56
                a, b = PURPLE, VIOLET
            else:
                p = (t - 0.56) / 0.44
                a, b = VIOLET, ORANGE
            pixels[x, y] = tuple(round(a[i] * (1 - p) + b[i] * p) for i in range(4))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=round(size * 0.29), fill=255)
    image.putalpha(mask)
    return image


def make_mark(size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pad = round(size * 0.065)
    square_size = size - pad * 2
    image.alpha_composite(_gradient_square(square_size), (pad, pad))
    draw = ImageDraw.Draw(image)
    cx = cy = size / 2
    radius = size * 0.247
    stroke = max(2, round(size * 0.092))
    draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), outline=WHITE, width=stroke)
    draw.polygon(
        [
            (size * 0.451, size * 0.372),
            (size * 0.650, size * 0.500),
            (size * 0.451, size * 0.628),
        ],
        fill=WHITE,
    )
    dot_radius = size * 0.049
    dot_x, dot_y = size * 0.793, size * 0.212
    draw.ellipse(
        (dot_x - dot_radius * 1.25, dot_y - dot_radius * 1.25, dot_x + dot_radius * 1.25, dot_y + dot_radius * 1.25),
        fill=WHITE,
    )
    draw.ellipse(
        (dot_x - dot_radius, dot_y - dot_radius, dot_x + dot_radius, dot_y + dot_radius),
        fill=PEACH,
    )
    return image


def make_lockup(on_dark: bool) -> Image.Image:
    image = Image.new("RGBA", (1327, 368), (0, 0, 0, 0))
    image.alpha_composite(make_mark(368), (0, 0))
    draw = ImageDraw.Draw(image)
    word_font = _font(184)
    badge_font = _font(86)
    draw.text((392, 80), "Ostory", font=word_font, fill=WHITE if on_dark else INK, spacing=0)
    draw.rounded_rectangle((1060, 113, 1274, 255), radius=48, fill=VIOLET if on_dark else PURPLE)
    draw.text((1102, 126), "TV", font=badge_font, fill=WHITE)
    return image


def main() -> None:
    BRAND_DIR.mkdir(parents=True, exist_ok=True)
    mark = make_mark(368)
    mark.save(BRAND_DIR / "ostory-tv-mark.png")
    make_lockup(on_dark=False).save(BRAND_DIR / "ostory-tv-logo-on-light.png")
    make_lockup(on_dark=True).save(BRAND_DIR / "ostory-tv-logo-on-dark.png")

    favicon_16 = make_mark(16)
    favicon_32 = make_mark(32)
    favicon_180 = make_mark(180)
    favicon_16.save(STATIC_DIR / "favicon-16x16.png")
    favicon_32.save(STATIC_DIR / "favicon-32x32.png")
    favicon_180.save(STATIC_DIR / "apple-touch-icon.png")
    favicon_32.save(STATIC_DIR / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32)])


if __name__ == "__main__":
    main()
