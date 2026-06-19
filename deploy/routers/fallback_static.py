"""Legacy static image route and final unknown-path guard."""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, Response


IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico")


def _image_media_type(filename: str) -> str:
    ext = filename.lower().split(".")[-1]
    if ext == "jpg":
        return "image/jpeg"
    if ext == "svg":
        return "image/svg+xml"
    return f"image/{ext}"


def create_fallback_static_router(*, deploy_root: Path, logger: logging.Logger) -> APIRouter:
    router = APIRouter()

    @router.get("/{filename}")
    async def serve_image_files(filename: str, request: Request):
        """Serve legacy one-segment image paths or hand React routes to the SPA."""
        if filename.startswith("api"):
            raise HTTPException(status_code=404, detail="Not Found")

        if not filename.lower().endswith(IMAGE_EXTENSIONS):
            index_path = deploy_root / "new_html" / "dist" / "index.html"
            if index_path.exists():
                logger.info("🔀 React路由: /%s, 返回 index.html", filename)
                return FileResponse(index_path, media_type="text/html")
            raise HTTPException(status_code=404, detail="Not Found")

        possible_paths = [
            Path("/root") / filename,
            Path(filename),
            Path("static") / filename,
            Path("uploads") / filename,
        ]

        for path in possible_paths:
            if path.exists():
                logger.info("✅ 找到图片: %s", path)
                return FileResponse(path, media_type=_image_media_type(filename))

        logger.warning("❌ 图片未找到: %s", filename)
        raise HTTPException(status_code=404, detail=f"图片未找到: {filename}")

    @router.get("/{path:path}")
    async def catch_scanner_requests(path: str):
        """
        捕获常见的扫描器和恶意请求，静默返回404避免日志污染。
        此路由必须在所有其他路由注册之后 include。
        """
        scanner_patterns = [
            "wp-admin",
            "wp-login",
            "wp-content",
            "wordpress",
            "wp-includes",
            "phpmyadmin",
            "phpMyAdmin",
            "pma",
            "mysql",
            "administrator",
            "login.asp",
            "login.php",
            "admin.php",
            "setup-config.php",
            "config.php",
            "configuration.php",
            "geoserver",
            "wfs",
            "ows",
            "wms",
            "webui",
            "console",
            "manager",
            ".env",
            ".git",
            ".svn",
            ".htaccess",
            "shell",
            "cmd",
            "exec",
            "XDEBUG_SESSION",
        ]

        path_lower = path.lower()

        if any(pattern in path_lower for pattern in scanner_patterns):
            return Response(status_code=404)

        logger.warning("⚠️ 未知路径访问: /%s", path)
        return Response(status_code=404)

    return router
