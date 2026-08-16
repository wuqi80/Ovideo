"""Frontend shell and static page routes."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response


ICON_CACHE_HEADERS = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
}


def _serve_spa():
    """Return the React SPA entry with no-cache headers for fresh build hashes."""
    dist_index = Path("dist/index.html")
    if dist_index.exists():
        return FileResponse(
            "dist/index.html",
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0",
            },
        )
    return HTMLResponse(
        """
        <html><body style="font-family: sans-serif; padding: 40px; text-align: center;">
        <h1>Application is not built</h1>
        <pre>cd new_html && npm run build</pre>
        </body></html>
        """
    )


def _studio_dist_dir() -> Path:
    return Path(__file__).resolve().parents[2] / "studio" / "dist"


def _serve_studio_spa():
    """Return the independently-built Studio SPA entry."""
    studio_index = _studio_dist_dir() / "index.html"
    if studio_index.exists():
        return FileResponse(
            studio_index,
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0",
            },
        )
    return HTMLResponse(
        """
        <html><body style="font-family: sans-serif; padding: 40px; text-align: center;">
        <h1>MECHA Studio is not built</h1>
        <pre>cd ../studio &amp;&amp; npm run build</pre>
        </body></html>
        """,
        status_code=503,
    )


def _serve_icon(relative_path: str, media_type: str):
    icon_path = Path("static") / relative_path
    if icon_path.exists():
        return FileResponse(icon_path, media_type=media_type, headers=ICON_CACHE_HEADERS)
    return Response(status_code=204, headers=ICON_CACHE_HEADERS)


def create_frontend_pages_router() -> APIRouter:
    router = APIRouter()

    @router.get("/")
    async def root():
        return FileResponse("login.html")

    @router.get("/login")
    async def login_page():
        return FileResponse("login.html")

    @router.get("/favicon.ico")
    async def favicon():
        return _serve_icon("favicon.ico", "image/x-icon")

    @router.get("/favicon.png")
    @router.get("/favicon-32x32.png")
    async def favicon_png():
        return _serve_icon("favicon-32x32.png", "image/png")

    @router.get("/favicon-16x16.png")
    async def favicon_16_png():
        return _serve_icon("favicon-16x16.png", "image/png")

    @router.get("/favicon.svg")
    async def favicon_svg():
        return _serve_icon("favicon.svg", "image/svg+xml")

    @router.get("/apple-touch-icon.png")
    async def apple_touch_icon():
        return _serve_icon("apple-touch-icon.png", "image/png")

    @router.get("/editor")
    async def editor_page():
        return RedirectResponse("/projects", status_code=301)

    @router.get("/materials")
    async def materials_page():
        return RedirectResponse("/projects", status_code=301)

    @router.get("/generation")
    async def generation_page():
        return RedirectResponse("/projects", status_code=301)

    @router.get("/workspace")
    async def workspace_page():
        return RedirectResponse("/projects", status_code=301)

    @router.get("/app")
    async def app_page():
        return RedirectResponse(url="/projects")

    @router.get("/create")
    async def create_page():
        """一句话新建创作首页（docs/design-standard 模板 Home）。"""
        return _serve_spa()

    @router.get("/projects")
    async def projects_hub():
        return _serve_spa()

    @router.get("/projects/{path:path}")
    async def projects_spa(path: str):
        return _serve_spa()

    @router.get("/profile")
    async def profile_page():
        return _serve_spa()

    @router.get("/credits")
    async def credits_page():
        return _serve_spa()

    @router.get("/canvas")
    async def canvas_page():
        return _serve_spa()

    @router.get("/canvas/{path:path}")
    async def canvas_spa(path: str):
        return _serve_spa()

    @router.get("/studio")
    @router.get("/studio/")
    async def studio_spa_root():
        return _serve_studio_spa()

    @router.get("/studio/{path:path}")
    async def studio_spa(path: str):
        return _serve_studio_spa()

    @router.get("/admin")
    @router.get("/admin/")
    async def admin_spa_root():
        return _serve_spa()

    @router.get("/admin/login")
    @router.get("/admin/operations")
    @router.get("/admin/settings")
    async def admin_spa_named():
        return _serve_spa()

    @router.get("/admin/login/{path:path}")
    @router.get("/admin/operations/{path:path}")
    @router.get("/admin/settings/{path:path}")
    async def admin_spa_subpath(path: str):
        return _serve_spa()

    return router
