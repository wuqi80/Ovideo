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


def test_spti_brand_favicons_stay_clean_while_homepage_adds_white_outline():
    login_html = (DEPLOY_DIR / "login.html").read_text(encoding="utf-8")

    assert ".brand-panel .logo" in login_html
    assert "drop-shadow(2px 0 0 rgba(255,255,255,0.98))" in login_html

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
        assert white_pixels / visible_pixels < 0.02


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
