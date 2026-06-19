# -*- coding: utf-8 -*-
"""Unified entity file routes for storyboard items, assets, and video segments."""

import json
import logging
from pathlib import Path
from typing import Any, Callable, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel


def create_entity_files_router(
    *,
    get_current_user_dependency: Any,
    file_dao: Any,
    entity_file_dao: Any,
    get_db_manager_func: Callable[[], Any],
    save_generated_file_to_db_provider: Callable[[], Callable[..., Any]],
    logger: logging.Logger,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency
    FileDAO = file_dao
    EntityFileDAO = entity_file_dao

    async def save_generated_file_to_db(*args, **kwargs):
        return await save_generated_file_to_db_provider()(*args, **kwargs)

    class EntityFileLinkRequest(BaseModel):
        file_id: str
        entity_type: str
        entity_id: str
        file_role: str
        is_selected: bool = False

    class EntityFileSelectRequest(BaseModel):
        entity_type: str
        entity_id: str
        file_role: str

    class HardDeleteBatchRequest(BaseModel):
        file_ids: List[str]

    async def _sync_legacy_url(entity_type: str, entity_id: str, file_role: str, url: str):
        """Keep legacy URL columns in sync with selected entity files."""
        db = get_db_manager_func()
        if not db:
            return
        try:
            if entity_type == "storyboard_item":
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
                        url,
                        entity_id,
                    )
            elif entity_type == "asset":
                if file_role == "asset_thumbnail":
                    await db.execute(
                        "UPDATE assets SET thumbnail_url = $1 WHERE asset_id = $2",
                        url,
                        entity_id,
                    )
                elif file_role == "reference_image":
                    row = await db.fetchrow(
                        "SELECT reference_images FROM assets WHERE asset_id = $1",
                        entity_id,
                    )
                    if row:
                        existing = row.get("reference_images") or []
                        if isinstance(existing, str):
                            existing = json.loads(existing) if existing else []
                        if url not in existing:
                            existing.append(url)
                            await db.execute(
                                "UPDATE assets SET reference_images = $1::jsonb WHERE asset_id = $2",
                                json.dumps(existing, ensure_ascii=False),
                                entity_id,
                            )
            elif entity_type == "video_segment":
                if file_role == "video":
                    await db.execute(
                        "UPDATE video_segments SET video_url = $1 WHERE segment_id = $2",
                        url,
                        entity_id,
                    )
                elif file_role == "video_thumbnail":
                    await db.execute(
                        "UPDATE video_segments SET thumbnail_url = $1 WHERE segment_id = $2",
                        url,
                        entity_id,
                    )
        except Exception as exc:
            logger.warning("同步旧URL字段失败: %s", exc)

    @router.get("/api/user-files")
    async def get_user_files(
        file_type: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
        user_id: str = Depends(get_current_user),
    ):
        if limit > 500:
            limit = 500
        rows = await FileDAO.get_user_files(user_id, file_type, limit, offset)
        items = []
        for r in rows:
            item = dict(r)
            if isinstance(item.get("metadata"), str):
                try:
                    item["metadata"] = json.loads(item["metadata"])
                except Exception:
                    item["metadata"] = {}
            items.append(item)
        count_query = "SELECT COUNT(*) FROM files WHERE user_id = $1 AND is_deleted = FALSE"
        args = [user_id]
        if file_type:
            count_query += " AND file_type = $2"
            args.append(file_type)
        db = get_db_manager_func()
        total = await db.fetchval(count_query, *args) or 0
        return {"success": True, "items": items, "total": total}

    @router.get("/api/entity-files")
    async def get_entity_files(
        entity_type: str,
        entity_id: str,
        file_role: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        user_id: str = Depends(get_current_user),
    ):
        if limit > 200:
            limit = 200
        result = await EntityFileDAO.get_entity_files(
            entity_type,
            entity_id,
            file_role,
            limit,
            offset,
        )
        return {"success": True, **result}

    @router.post("/api/entity-files/link")
    async def link_entity_file(
        req: EntityFileLinkRequest,
        user_id: str = Depends(get_current_user),
    ):
        row = await EntityFileDAO.link_file(
            req.file_id,
            req.entity_type,
            req.entity_id,
            req.file_role,
            req.is_selected,
        )
        if not row:
            raise HTTPException(404, "文件不存在或已删除")
        return {"success": True, "file": row}

    @router.put("/api/entity-files/{file_id}/select")
    async def select_entity_file(
        file_id: str,
        req: EntityFileSelectRequest,
        user_id: str = Depends(get_current_user),
    ):
        row = await EntityFileDAO.select_file(
            file_id,
            req.entity_type,
            req.entity_id,
            req.file_role,
        )
        if not row:
            raise HTTPException(404, "文件不存在或不属于指定实体")

        await _sync_legacy_url(req.entity_type, req.entity_id, req.file_role, row["file_url"])
        return {"success": True, "file": row}

    @router.post("/api/entity-files/upload")
    async def upload_entity_file(
        file: UploadFile = File(...),
        entity_type: str = Form(None),
        entity_id: str = Form(None),
        file_role: str = Form(None),
        episode_id: str = Form(None),
        user_id: str = Depends(get_current_user),
    ):
        content = await file.read()
        ext = Path(file.filename).suffix if file.filename else ".bin"
        file_type = (
            "image" if file.content_type and file.content_type.startswith("image")
            else "audio" if file.content_type and file.content_type.startswith("audio")
            else "video" if file.content_type and file.content_type.startswith("video")
            else "other"
        )

        saved = await save_generated_file_to_db(
            content=content,
            file_type=file_type,
            user_id=user_id,
            source="upload",
            entity_type=entity_type,
            entity_id=entity_id,
            file_role=file_role,
            original_ext=ext,
            episode_id=episode_id,
        )
        try:
            if file_type in ("image", "video", "audio"):
                import media_library_service

                await media_library_service.create_from_file(
                    file_record=saved,
                    source="upload",
                    episode_id=episode_id,
                    source_entity_type=entity_type,
                    source_entity_id=entity_id,
                    title=(file.filename or "")[:80] or None,
                )
        except Exception as exc:
            logger.warning("media_library 同步失败 (entity-files upload): %s", exc)
        return {"success": True, "file_id": saved["file_id"], "file_url": saved["file_url"]}

    @router.delete("/api/entity-files/{file_id}")
    async def delete_entity_file(
        file_id: str,
        user_id: str = Depends(get_current_user),
    ):
        ok = await EntityFileDAO.soft_delete(file_id)
        if not ok:
            raise HTTPException(404, "文件不存在或已删除")
        return {"success": True}

    @router.delete("/api/entity-files/{file_id}/hard")
    async def hard_delete_entity_file(
        file_id: str,
        user_id: str = Depends(get_current_user),
    ):
        result = await EntityFileDAO.hard_delete(file_id)
        if not result:
            raise HTTPException(404, "文件不存在")
        return {"success": True, "freed_bytes": result["freed_bytes"]}

    @router.post("/api/entity-files/hard-delete-batch")
    async def hard_delete_entity_files_batch(
        request: HardDeleteBatchRequest,
        user_id: str = Depends(get_current_user),
    ):
        if len(request.file_ids) > 200:
            raise HTTPException(400, "单次最多删除 200 个文件")
        result = await EntityFileDAO.hard_delete_batch(request.file_ids)
        return {"success": True, **result}

    @router.post("/api/entity-files/migrate")
    async def run_entity_file_migration(user_id: str = Depends(get_current_user)):
        try:
            from migrate_existing_files import (
                migrate_assets,
                migrate_storyboard_items,
                migrate_video_segments,
                recover_orphan_files,
            )

            await migrate_storyboard_items()
            await migrate_assets()
            await migrate_video_segments()
            recovered = await recover_orphan_files()
            return {"success": True, "recovered": recovered}
        except Exception as exc:
            raise HTTPException(500, f"迁移失败: {str(exc)}")

    return router
