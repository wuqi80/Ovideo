import asyncio
import json
from pathlib import Path

from fastapi.responses import FileResponse
from PIL import Image

from routers.frontend_pages import _studio_dist_dir, create_frontend_pages_router


DEPLOY_DIR = Path(__file__).resolve().parents[1]


def _route_endpoint(path: str):
    router = create_frontend_pages_router()
    return next(route.endpoint for route in router.routes if route.path == path)


def test_favicon_routes_serve_the_spti_ai_assets(monkeypatch):
    monkeypatch.chdir(DEPLOY_DIR)

    ico_response = asyncio.run(_route_endpoint("/favicon.ico")())
    png_response = asyncio.run(_route_endpoint("/favicon.png")())
    png_32_response = asyncio.run(_route_endpoint("/favicon-32x32.png")())
    png_16_response = asyncio.run(_route_endpoint("/favicon-16x16.png")())
    svg_response = asyncio.run(_route_endpoint("/favicon.svg")())
    apple_response = asyncio.run(_route_endpoint("/apple-touch-icon.png")())

    expectations = [
        (ico_response, "static/favicon.ico", "image/x-icon"),
        (png_response, "static/favicon-32x32.png", "image/png"),
        (png_32_response, "static/favicon-32x32.png", "image/png"),
        (png_16_response, "static/favicon-16x16.png", "image/png"),
        (svg_response, "static/favicon.svg", "image/svg+xml"),
        (apple_response, "static/apple-touch-icon.png", "image/png"),
    ]
    for response, path, media_type in expectations:
        assert isinstance(response, FileResponse)
        assert Path(response.path).as_posix() == path
        assert response.media_type == media_type
        assert response.headers["cache-control"] == "no-cache, no-store, must-revalidate"
        assert response.headers["pragma"] == "no-cache"
        assert response.headers["expires"] == "0"


def test_spti_ai_favicon_files_have_valid_signatures():
    assert (DEPLOY_DIR / "static/favicon.ico").read_bytes()[:4] == b"\x00\x00\x01\x00"
    assert (DEPLOY_DIR / "static/favicon-32x32.png").read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    assert (DEPLOY_DIR / "static/apple-touch-icon.png").read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_spti_brand_favicons_and_mark_use_a_white_panel_inside_the_blue_frame():
    login_html = (DEPLOY_DIR / "login.html").read_text(encoding="utf-8")

    assert "/static/branding/spti-ai-logo-dark.png" in login_html
    assert "/static/branding/spti-ai-logo-light.png" in login_html
    assert "drop-shadow(2px 0 0 rgba(255,255,255,0.98))" not in login_html

    for relative_path in [
        "static/branding/spti-ai-mark.png",
        "static/favicon-32x32.png",
    ]:
        image = Image.open(DEPLOY_DIR / relative_path).convert("RGBA")
        pixels = image.getdata()
        visible_pixels = sum(1 for _, _, _, alpha in pixels if alpha > 128)
        white_pixels = sum(
            1
            for red, green, blue, alpha in pixels
            if alpha > 180 and red > 235 and green > 235 and blue > 235
        )

        assert visible_pixels > 0
        assert 0.25 < white_pixels / visible_pixels < 0.75

    mark = Image.open(DEPLOY_DIR / "static/branding/spti-ai-mark.png").convert("RGBA")
    panel_red, panel_green, panel_blue, panel_alpha = mark.getpixel((80, 80))
    frame_red, frame_green, frame_blue, frame_alpha = mark.getpixel((184, 40))

    assert panel_alpha > 240
    assert panel_red > 245 and panel_green > 245 and panel_blue > 245
    assert frame_alpha > 240
    assert frame_red < 40 and frame_green > 80 and frame_blue > 220
    assert mark.getpixel((0, 0))[3] == 0


def test_spti_final_logo_masters_are_backed_up_and_theme_ready():
    repository_root = DEPLOY_DIR.parent
    backup_dir = repository_root / "docs/brand-assets/spti-ai-final-20260730"
    image_expectations = {
        backup_dir / "spti-ai-logo-light-blue-master.png": (1327, 368),
        backup_dir / "spti-ai-logo-dark-white-master.png": (1327, 368),
        backup_dir / "spti-ai-mark-master.png": (368, 368),
        DEPLOY_DIR / "static/branding/spti-ai-logo-light.png": (1327, 368),
        DEPLOY_DIR / "static/branding/spti-ai-logo-dark.png": (1327, 368),
        DEPLOY_DIR / "static/branding/spti-ai-mark.png": (368, 368),
    }

    for image_path, expected_size in image_expectations.items():
        image = Image.open(image_path)
        assert image.mode == "RGBA"
        assert image.size == expected_size
        assert image.getpixel((0, 0))[3] == 0


def test_studio_routes_serve_the_sibling_build_directory():
    router = create_frontend_pages_router()
    studio_paths = {
        route.path
        for route in router.routes
        if route.path.startswith("/studio")
    }

    assert studio_paths == {"/studio", "/studio/", "/studio/{path:path}"}
    assert _studio_dist_dir() == DEPLOY_DIR.parent / "studio" / "dist"


def test_studio_build_toolchain_is_pinned_for_the_production_host():
    package = json.loads(
        (DEPLOY_DIR.parent / "studio" / "package.json").read_text(encoding="utf-8")
    )
    dev_dependencies = package["devDependencies"]

    assert dev_dependencies["vite"] == "6.4.1"
    assert dev_dependencies["vitest"] == "4.1.0"
    assert dev_dependencies["rollup"] == "4.53.3"
