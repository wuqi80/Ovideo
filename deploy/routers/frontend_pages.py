"""Frontend shell and static page routes."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response


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
        favicon_path = Path("static/favicon.ico")
        if favicon_path.exists():
            return FileResponse(favicon_path, media_type="image/x-icon")
        return Response(status_code=204)

    @router.get("/favicon.png")
    async def favicon_png():
        favicon_path = Path("static/favicon-32x32.png")
        if favicon_path.exists():
            return FileResponse(favicon_path, media_type="image/png")
        return Response(status_code=204)

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
