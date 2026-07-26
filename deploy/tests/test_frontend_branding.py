import asyncio
from pathlib import Path

from fastapi.responses import FileResponse

from routers.frontend_pages import create_frontend_pages_router


DEPLOY_DIR = Path(__file__).resolve().parents[1]


def _route_endpoint(path: str):
    router = create_frontend_pages_router()
    return next(route.endpoint for route in router.routes if route.path == path)


def test_favicon_routes_serve_the_mecha_one_assets(monkeypatch):
    monkeypatch.chdir(DEPLOY_DIR)

    ico_response = asyncio.run(_route_endpoint("/favicon.ico")())
    png_response = asyncio.run(_route_endpoint("/favicon.png")())

    assert isinstance(ico_response, FileResponse)
    assert Path(ico_response.path).as_posix() == "static/favicon.ico"
    assert ico_response.media_type == "image/x-icon"
    assert isinstance(png_response, FileResponse)
    assert Path(png_response.path).as_posix() == "static/favicon-32x32.png"
    assert png_response.media_type == "image/png"


def test_mecha_one_favicon_files_have_valid_signatures():
    assert (DEPLOY_DIR / "static/favicon.ico").read_bytes()[:4] == b"\x00\x00\x01\x00"
    assert (DEPLOY_DIR / "static/favicon-32x32.png").read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
