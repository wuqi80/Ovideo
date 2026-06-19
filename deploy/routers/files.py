"""Generic file upload routes."""
from __future__ import annotations

import hashlib
import logging
import os
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials

from cluster_config import SystemConfig
from dao_content import FileDAO, ProjectDAO, VersionDAO

logger = logging.getLogger(__name__)

THUMBNAIL_CACHE_DIR = Path("temp") / "thumbnail_cache"
DEFAULT_THUMBNAIL_CACHE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60
DEFAULT_THUMBNAIL_CACHE_MAX_BYTES = 2 * 1024 * 1024 * 1024
DEFAULT_THUMBNAIL_TMP_MAX_AGE_SECONDS = 60 * 60


def _thumbnail_cache_limit(env_name: str, default: int) -> int:
    try:
        return max(0, int(os.getenv(env_name, str(default))))
    except (TypeError, ValueError):
        logger.warning("Invalid %s value, using default %s", env_name, default)
        return default


def cleanup_thumbnail_cache(
    *,
    cache_dir: Optional[Path] = None,
    max_age_seconds: Optional[int] = None,
    max_bytes: Optional[int] = None,
    tmp_max_age_seconds: int = DEFAULT_THUMBNAIL_TMP_MAX_AGE_SECONDS,
) -> dict[str, int]:
    cache_path = Path(cache_dir or THUMBNAIL_CACHE_DIR)
    stats = {
        "scanned": 0,
        "removed": 0,
        "bytes_before": 0,
        "bytes_removed": 0,
        "bytes_after": 0,
    }
    if not cache_path.exists():
        return stats

    max_age = (
        _thumbnail_cache_limit("THUMBNAIL_CACHE_MAX_AGE_SECONDS", DEFAULT_THUMBNAIL_CACHE_MAX_AGE_SECONDS)
        if max_age_seconds is None
        else max(0, int(max_age_seconds))
    )
    byte_limit = (
        _thumbnail_cache_limit("THUMBNAIL_CACHE_MAX_BYTES", DEFAULT_THUMBNAIL_CACHE_MAX_BYTES)
        if max_bytes is None
        else max(0, int(max_bytes))
    )

    now = time.time()
    remaining: list[tuple[float, int, Path]] = []

    for entry in cache_path.iterdir():
        if not entry.is_file():
            continue
        if entry.suffix.lower() not in {".jpg", ".tmp"}:
            continue

        try:
            stat = entry.stat()
        except FileNotFoundError:
            continue

        stats["scanned"] += 1
        stats["bytes_before"] += stat.st_size
        age = now - stat.st_mtime
        should_remove = False
        if entry.suffix.lower() == ".tmp":
            should_remove = age > tmp_max_age_seconds
        else:
            should_remove = max_age > 0 and age > max_age

        if should_remove:
            try:
                entry.unlink(missing_ok=True)
                stats["removed"] += 1
                stats["bytes_removed"] += stat.st_size
            except Exception as exc:
                logger.warning("Failed to remove thumbnail cache file %s: %s", entry, exc)
            continue

        if entry.suffix.lower() == ".jpg":
            remaining.append((stat.st_mtime, stat.st_size, entry))
            stats["bytes_after"] += stat.st_size

    if byte_limit > 0 and stats["bytes_after"] > byte_limit:
        for _, size, entry in sorted(remaining, key=lambda item: item[0]):
            if stats["bytes_after"] <= byte_limit:
                break
            try:
                entry.unlink(missing_ok=True)
                stats["removed"] += 1
                stats["bytes_removed"] += size
                stats["bytes_after"] -= size
            except Exception as exc:
                logger.warning("Failed to trim thumbnail cache file %s: %s", entry, exc)

    return stats


def create_files_router(
    *,
    require_auth_dependency,
    security_dependency,
    verify_token: Callable[[str], Optional[str]],
    storage_path_safe: Callable[[str], Path],
    get_db_manager: Callable[[], object],
) -> APIRouter:
    router = APIRouter()

    def thumbnail_cache_path(file_path: str, width: int, height: int) -> Path:
        source = Path(file_path).resolve()
        stat = source.stat()
        material = f"{source}|{stat.st_mtime_ns}|{stat.st_size}|{width}x{height}"
        digest = hashlib.sha256(material.encode("utf-8")).hexdigest()
        return THUMBNAIL_CACHE_DIR / f"{digest}.jpg"

    def thumbnail_headers() -> dict[str, str]:
        return {
            "Cache-Control": "public, max-age=86400",
            "Content-Disposition": "inline",
        }

    @router.get("/api/thumbnail")
    async def get_thumbnail(
        url: str,
        width: int = 300,
        height: int = 200,
        token: Optional[str] = None,
        credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_dependency),
    ):
        """动态生成图片缩略图"""
        from PIL import Image

        try:
            username = None
            if credentials:
                username = verify_token(credentials.credentials)
            if not username and token:
                username = verify_token(token)
            if not username:
                raise HTTPException(status_code=401, detail="需要登录")

            file_path = None

            if url.startswith("/uploads/"):
                relative_path = url.replace("/uploads/", "")
                file_path = os.path.join("temp", "uploads", relative_path.split("?")[0])
            elif url.startswith("/storage/"):
                file_path = str(storage_path_safe(url.split("?")[0]))
            elif url.startswith("/api/files/"):
                parts = url.split("/")
                if len(parts) >= 4:
                    file_id = parts[3]
                    if get_db_manager():
                        try:
                            file_record = await FileDAO.get_file(file_id)
                            if file_record:
                                file_path = file_record.get("file_path")
                        except Exception as e:
                            logger.warning("从数据库获取文件失败: %s", e)

            if not file_path or not os.path.exists(file_path):
                logger.warning("缩略图文件不存在: %s", file_path)
                raise HTTPException(status_code=404, detail="文件不存在")

            thumb_width = max(1, int(width))
            thumb_height = max(1, int(height))
            cache_path = thumbnail_cache_path(file_path, thumb_width, thumb_height)
            if cache_path.exists():
                return FileResponse(
                    cache_path,
                    media_type="image/jpeg",
                    headers=thumbnail_headers(),
                )

            cache_path.parent.mkdir(parents=True, exist_ok=True)
            tmp_cache_path = cache_path.with_name(f"{cache_path.name}.{uuid.uuid4().hex}.tmp")

            with Image.open(file_path) as img:
                if img.mode in ("RGBA", "P"):
                    img = img.convert("RGB")

                img.thumbnail((thumb_width, thumb_height), Image.Resampling.LANCZOS)

                try:
                    img.save(tmp_cache_path, format="JPEG", quality=75, optimize=True)
                    os.replace(tmp_cache_path, cache_path)
                finally:
                    if tmp_cache_path.exists():
                        tmp_cache_path.unlink(missing_ok=True)

                return FileResponse(
                    cache_path,
                    media_type="image/jpeg",
                    headers=thumbnail_headers(),
                )

        except HTTPException:
            raise
        except Exception as e:
            logger.error("生成缩略图失败: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=f"生成缩略图失败: {str(e)}")

    @router.post("/api/upload")
    async def upload_file(
        file: UploadFile = File(...),
        version_id: Optional[str] = Form(None),
        username: str = Depends(require_auth_dependency),
    ):
        """上传文件并保存到数据库（支持图片和视频）"""
        try:
            contents = await file.read()
            if len(contents) > SystemConfig.MAX_UPLOAD_SIZE:
                raise HTTPException(status_code=413, detail="文件太大")

            content_type = file.content_type or ""
            if content_type.startswith("image/"):
                file_type = "image"
            elif content_type.startswith("video/"):
                file_type = "video"
            else:
                ext = Path(file.filename).suffix.lower()
                if ext in [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]:
                    file_type = "image"
                elif ext in [".mp4", ".avi", ".mov", ".mkv", ".flv", ".wmv"]:
                    file_type = "video"
                else:
                    raise HTTPException(status_code=400, detail=f"不支持的文件类型: {content_type}")

            file_id = f"file_{uuid.uuid4().hex[:12]}"
            ext = Path(file.filename).suffix
            year_month = datetime.now().strftime("%Y%m")
            storage_dir = Path("persistent_storage") / f"{file_type}s" / username / year_month
            storage_dir.mkdir(parents=True, exist_ok=True)
            file_path = storage_dir / f"{file_id}{ext}"

            file_path.write_bytes(contents)
            file_written = True

            if not version_id:
                projects = await ProjectDAO.get_user_projects(username)
                if not projects:
                    project_id = f"proj_{uuid.uuid4().hex[:12]}"
                    await ProjectDAO.save_or_update_project(
                        user_id=username,
                        project_id=project_id,
                        project_name="默认项目",
                        project_data={},
                        description="自动创建的默认项目",
                    )
                else:
                    project_id = projects[0]["project_id"]

                versions = await VersionDAO.get_project_versions(project_id)
                if not versions:
                    version = await VersionDAO.create_version(
                        project_id=project_id,
                        user_id=username,
                        version_name="默认版本",
                        description="自动创建",
                    )
                    version_id = version["version_id"]
                else:
                    version_id = versions[0]["version_id"]

            try:
                file_record = await FileDAO.create_file(
                    version_id=version_id,
                    user_id=username,
                    file_type=file_type,
                    file_name=file.filename,
                    file_path=str(file_path),
                    file_url=f"/api/files/{file_id}/download",
                    file_size_bytes=len(contents),
                    mime_type=content_type or f"{file_type}/*",
                    metadata={"source": "upload_api"},
                    file_id=file_id,
                )
            except Exception as db_err:
                if file_written:
                    try:
                        file_path.unlink(missing_ok=True)
                        logger.info("🔄 DB失败，已回滚物理文件: %s", file_path)
                    except Exception:
                        logger.error("⚠️ 回滚物理文件失败: %s", file_path)
                raise HTTPException(status_code=500, detail=f"保存文件记录失败: {db_err}")

            logger.info("✅ 用户 %s 上传%s: %s, 文件ID: %s", username, file_type, file.filename, file_id)

            return {
                "success": True,
                "file_id": file_record["file_id"],
                "filename": file_record["file_id"],
                "original_filename": file.filename,
                "storage_url": file_record["file_url"],
                "url": file_record["file_url"],
                "path": str(file_path),
                "file_type": file_type,
                "size": len(contents),
            }

        except HTTPException:
            raise
        except Exception as e:
            logger.error("❌ 上传文件失败: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=f"上传失败: {str(e)}")

    return router
