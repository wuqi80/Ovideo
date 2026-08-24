"""Generate the 创剧 raster lockups and favicon assets from the brand geometry."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


DEPLOY_DIR = Path(__file__).resolve().parents[1]
STATIC_DIR = DEPLOY_DIR / "static"
BRAND_DIR = STATIC_DIR / "branding"

BLUE = (83, 159, 243, 255)
INDIGO = (80, 94, 245, 255)
PURPLE = (166, 66, 245, 255)
INK = (23, 23, 28, 255)
WHITE = (255, 255, 255, 255)


def _font(size: int, *, bold: bool = True) -> ImageFont.FreeTypeFont:
    fonts = Path("C:/Windows/Fonts")
    candidates = [
        fonts / ("msyhbd.ttc" if bold else "msyh.ttc"),
        fonts / ("simhei.ttf" if bold else "simsun.ttc"),
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
                a, b = BLUE, INDIGO
            else:
                p = (t - 0.56) / 0.44
                a, b = INDIGO, PURPLE
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
    scale = size / 368
    draw.polygon([(87 * scale, 130 * scale), (275 * scale, 80 * scale), (317 * scale, 133 * scale), (100 * scale, 191 * scale)], fill=WHITE)
    draw.polygon([(132 * scale, 118 * scale), (162 * scale, 110 * scale), (193 * scale, 153 * scale), (163 * scale, 161 * scale)], fill=INDIGO)
    draw.polygon([(208 * scale, 98 * scale), (238 * scale, 90 * scale), (269 * scale, 133 * scale), (239 * scale, 141 * scale)], fill=PURPLE)
    draw.rounded_rectangle((87 * scale, 166 * scale, 317 * scale, 308 * scale), radius=30 * scale, fill=WHITE)
    draw.polygon([(176 * scale, 203 * scale), (254 * scale, 250 * scale), (176 * scale, 297 * scale)], fill=INDIGO)
    return image


def make_lockup(on_dark: bool) -> Image.Image:
    image = Image.new("RGBA", (820, 368), (0, 0, 0, 0))
    image.alpha_composite(make_mark(368), (0, 0))
    draw = ImageDraw.Draw(image)
    word_font = _font(176)
    draw.text((390, 68), "创剧", font=word_font, fill=WHITE if on_dark else INK, spacing=12)
    return image


def main() -> None:
    BRAND_DIR.mkdir(parents=True, exist_ok=True)
    mark = make_mark(368)
    mark.save(BRAND_DIR / "chuangju-mark.png")
    make_lockup(on_dark=False).save(BRAND_DIR / "chuangju-logo-on-light.png")
    make_lockup(on_dark=True).save(BRAND_DIR / "chuangju-logo-on-dark.png")

    favicon_16 = make_mark(16)
    favicon_32 = make_mark(32)
    favicon_180 = make_mark(180)
    favicon_16.save(STATIC_DIR / "favicon-16x16.png")
    favicon_32.save(STATIC_DIR / "favicon-32x32.png")
    favicon_180.save(STATIC_DIR / "apple-touch-icon.png")
    favicon_32.save(STATIC_DIR / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32)])


if __name__ == "__main__":
    main()
