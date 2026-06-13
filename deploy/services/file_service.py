# -*- coding: utf-8 -*-
"""
Unified file service — single entry point for registering output files.

Usage:
    from file_service import FileService
    result_entry = await FileService.register_output(
        content=raw_bytes,
        original_filename="ComfyUI_00001_.png",
        content_type="image/png",
        task_id="abc-123",
        user_id="admin",
        source="agent_complete",
    )
    # result_entry = {"file_id": "file_xxx", "url": "/storage/...", "filename": "...", "size": 123}
"""
import logging
import mimetypes
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from dao_file import FileDAO

logger = logging.getLogger(__name__)

STORAGE_ROOT = Path("persistent_storage")

MIME_TO_CATEGORY = {
    "image": "image",
    "video": "video",
    "audio": "audio",
}

MIME_FALLBACK_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "application/octet-stream": ".bin",
}


class FileService:

    @staticmethod
    def _detect_category(content_type: str) -> str:
        """image/png -> 'image', video/mp4 -> 'video', etc."""
        major = content_type.split("/")[0] if content_type else "other"
        return MIME_TO_CATEGORY.get(major, "other")

    @staticmethod
    def _ensure_extension(filename: str, content_type: str) -> str:
        """Ensure filename has a proper extension based on content_type."""
        p = Path(filename)
        if p.suffix and len(p.suffix) <= 5:
            return filename
        ext = MIME_FALLBACK_EXT.get(content_type)
        if not ext:
            ext = mimetypes.guess_extension(content_type) or ".bin"
        return f"{filename}{ext}"

    @staticmethod
    async def register_output(
        content: bytes,
        original_filename: str,
        content_type: str,
        task_id: str,
        user_id: str = "system",
        source: str = "agent_complete",
    ) -> Dict[str, Any]:
        """
        Save a generated file to disk and register it in the database.

        Returns a standardized entry:
            {"file_id": "file_xxx", "url": "/storage/...", "filename": "...", "size": 123}
        """
        category = FileService._detect_category(content_type)
        safe_filename = FileService._ensure_extension(original_filename, content_type)

        year_month = datetime.now().strftime("%Y%m")
        file_id = FileDAO.generate_file_id()
        disk_filename = f"{task_id}_{safe_filename}"

        sub_dir = f"{category}s" if not category.endswith("s") else category
        rel_dir = Path(sub_dir) / source / year_month
        output_dir = STORAGE_ROOT / rel_dir
        output_dir.mkdir(parents=True, exist_ok=True)

        file_path = output_dir / disk_filename
        file_path.write_bytes(content)

        file_url = f"/storage/{rel_dir}/{disk_filename}"

        try:
            await FileDAO.create(
                file_id=file_id,
                user_id=user_id,
                file_type=category,
                file_name=safe_filename,
                file_path=str(file_path),
                file_url=file_url,
                file_size_bytes=len(content),
                mime_type=content_type,
                metadata={"task_id": task_id, "source": source},
            )
        except Exception as e:
            logger.warning(f"Failed to create file DB record (non-fatal): {e}")

        return {
            "file_id": file_id,
            "url": file_url,
            "filename": safe_filename,
            "size": len(content),
        }

    @staticmethod
    def build_result(
        file_entries: List[Dict[str, Any]],
        duration: float = 0.0,
    ) -> Dict[str, Any]:
        """
        Build a standardized task result from a list of file entries.
        Splits into images / videos based on URL extension.
        """
        images = []
        videos = []
        for entry in file_entries:
            fname = entry.get("filename", "").lower()
            if any(fname.endswith(ext) for ext in (".mp4", ".webm", ".mov", ".avi")):
                videos.append(entry)
            else:
                images.append(entry)
        return {
            "images": images,
            "videos": videos,
            "output_files": file_entries,
            "duration": duration,
        }


# ---------------------------------------------------------------------------
# 统一数据层: 通用文件保存入口（复用 dao_content.FileDAO.create_file）
# ---------------------------------------------------------------------------
from dao_content import FileDAO as ContentFileDAO


async def save_generated_file_to_db(
    content: bytes,
    file_type: str,
    user_id: str,
    source: str,
    entity_type: str = None,
    entity_id: str = None,
    file_role: str = None,
    original_ext: str = '.png',
    is_selected: bool = False,
    episode_id: str = None,
    extra_metadata: dict = None,
) -> dict:
    """
    统一的生成文件保存入口。
    将文件保存到 persistent_storage 并写入 files 表（含 entity 关联）。
    返回 { file_id, file_url, file_path }；DB 失败时 file_id 为 None。
    """
    import io
    import uuid as _uuid

    year_month = datetime.now().strftime('%Y%m')
    file_id = str(_uuid.uuid4())

    if file_type == 'image' and original_ext.lower() in ('.png', '.jpg', '.jpeg'):
        try:
            from PIL import Image
            img = Image.open(io.BytesIO(content))
            buf = io.BytesIO()
            img.save(buf, format='WEBP', lossless=True)
            content = buf.getvalue()
            original_ext = '.webp'
        except Exception as e:
            logger.warning(f"WebP 转换失败，使用原始格式: {e}")

    safe_filename = f"{file_id}{original_ext}"
    sub_dir = Path(f"persistent_storage/{file_type}/{user_id}/{year_month}")
    sub_dir.mkdir(parents=True, exist_ok=True)
    local_path = sub_dir / safe_filename
    local_path.write_bytes(content)

    file_url = f"/storage/{file_type}/{user_id}/{year_month}/{safe_filename}"

    _MIME_MAP = {
        '.webp': 'image/webp', '.png': 'image/png',
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
        '.mp4': 'video/mp4', '.txt': 'text/plain',
    }
    mime_type = _MIME_MAP.get(original_ext.lower(), f'{file_type}/{original_ext.lstrip(".")}')

    db_record = None
    try:
        db_record = await ContentFileDAO.create_file(
            version_id=None,
            user_id=user_id,
            file_type=file_type,
            file_name=safe_filename,
            file_path=str(local_path),
            file_url=file_url,
            file_size_bytes=len(content),
            mime_type=mime_type,
            metadata={**({'source': source, 'episode_id': episode_id}), **(extra_metadata or {})},
            file_id=file_id,
            entity_type=entity_type,
            entity_id=entity_id,
            file_role=file_role,
            is_selected=is_selected,
        )
    except Exception as e:
        logger.error(f"save_generated_file_to_db DB 写入失败: {e}", exc_info=True)

    if db_record and entity_type and entity_id and file_role:
        try:
            await _sync_legacy_on_file_create(entity_type, entity_id, file_role, file_url)
        except Exception as e:
            logger.warning(f"Legacy field sync failed (non-fatal): {e}")

    return {
        'file_id': db_record['file_id'] if db_record else None,
        'file_url': file_url,
        'file_path': str(local_path),
    }


async def _sync_legacy_on_file_create(entity_type: str, entity_id: str, file_role: str, file_url: str):
    """文件创建后自动同步旧业务表字段，确保下游页面数据联通。"""
    import json as _json
    from db_manager import get_db_manager

    db = get_db_manager()
    if not db:
        return

    if entity_type == "asset" and file_role == "reference_image":
        row = await db.fetchrow(
            "SELECT reference_images FROM assets WHERE asset_id = $1", entity_id
        )
        if row:
            existing = row.get("reference_images") or []
            if isinstance(existing, str):
                existing = _json.loads(existing) if existing else []
            if file_url not in existing:
                existing.append(file_url)
                await db.execute(
                    "UPDATE assets SET reference_images = $1::jsonb WHERE asset_id = $2",
                    _json.dumps(existing, ensure_ascii=False), entity_id,
                )

    elif entity_type == "storyboard_item":
        field_map = {
            "generated_image": "generated_image_url",
            "dialogue_audio": "dialogue_audio_url",
            "narration_audio": "narration_audio_url",
            "sfx": "sfx_audio_url",
        }
        col = field_map.get(file_role)
        if col:
            await db.execute(
                f"UPDATE storyboard_items SET {col} = $1 WHERE item_id = $2",
                file_url, entity_id,
            )

    elif entity_type == "video_segment":
        if file_role == "video":
            await db.execute(
                "UPDATE video_segments SET video_url = $1 WHERE segment_id = $2",
                file_url, entity_id,
            )
        elif file_role == "video_thumbnail":
            await db.execute(
                "UPDATE video_segments SET thumbnail_url = $1 WHERE segment_id = $2",
                file_url, entity_id,
            )
