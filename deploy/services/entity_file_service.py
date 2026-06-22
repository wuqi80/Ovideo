"""Entity file business logic for shared file attachments."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, Optional


class EntityFileServiceError(RuntimeError):
    pass


class EntityFileNotFound(EntityFileServiceError):
    pass


class EntityFileBatchTooLarge(EntityFileServiceError):
    pass


class EntityFileMigrationFailed(EntityFileServiceError):
    pass


def _normalize_file_rows(rows: Iterable[Any]) -> list[Dict[str, Any]]:
    items = []
    for row in rows:
        item = dict(row)
        if isinstance(item.get("metadata"), str):
            try:
                item["metadata"] = json.loads(item["metadata"])
            except Exception:
                item["metadata"] = {}
        items.append(item)
    return items


def _detect_file_type(content_type: Optional[str]) -> str:
    if content_type and content_type.startswith("image"):
        return "image"
    if content_type and content_type.startswith("audio"):
        return "audio"
    if content_type and content_type.startswith("video"):
        return "video"
    return "other"


async def list_user_files(
    *,
    user_id: str,
    file_type: Optional[str],
    limit: int,
    offset: int,
    file_dao: Any,
    entity_file_dao: Any,
) -> Dict[str, Any]:
    capped_limit = min(limit, 500)
    rows = await file_dao.get_user_files(user_id, file_type, capped_limit, offset)
    total = await entity_file_dao.count_user_files(user_id, file_type)
    return {"success": True, "items": _normalize_file_rows(rows), "total": total}


async def list_entity_files(
    *,
    entity_type: str,
    entity_id: str,
    file_role: Optional[str],
    limit: int,
    offset: int,
    entity_file_dao: Any,
) -> Dict[str, Any]:
    capped_limit = min(limit, 200)
    result = await entity_file_dao.get_entity_files(
        entity_type,
        entity_id,
        file_role,
        capped_limit,
        offset,
    )
    return {"success": True, **result}


async def link_entity_file(
    *,
    file_id: str,
    entity_type: str,
    entity_id: str,
    file_role: str,
    is_selected: bool,
    entity_file_dao: Any,
) -> Dict[str, Any]:
    row = await entity_file_dao.link_file(
        file_id,
        entity_type,
        entity_id,
        file_role,
        is_selected,
    )
    if not row:
        raise EntityFileNotFound("File not found or deleted")
    return {"success": True, "file": row}


async def select_entity_file(
    *,
    file_id: str,
    entity_type: str,
    entity_id: str,
    file_role: str,
    entity_file_dao: Any,
    logger: Optional[logging.Logger] = None,
) -> Dict[str, Any]:
    row = await entity_file_dao.select_file(file_id, entity_type, entity_id, file_role)
    if not row:
        raise EntityFileNotFound("File not found or not linked to entity")

    try:
        await entity_file_dao.sync_legacy_url(entity_type, entity_id, file_role, row["file_url"])
    except Exception as exc:
        if logger:
            logger.warning("同步旧URL字段失败: %s", exc)
    return {"success": True, "file": row}


async def upload_entity_file(
    *,
    content: bytes,
    filename: Optional[str],
    content_type: Optional[str],
    entity_type: Optional[str],
    entity_id: Optional[str],
    file_role: Optional[str],
    episode_id: Optional[str],
    user_id: str,
    save_generated_file_to_db: Callable[..., Any],
    media_library_create_from_file: Optional[Callable[..., Any]] = None,
    logger: Optional[logging.Logger] = None,
) -> Dict[str, Any]:
    original_ext = Path(filename).suffix if filename else ".bin"
    file_type = _detect_file_type(content_type)

    saved = await save_generated_file_to_db(
        content=content,
        file_type=file_type,
        user_id=user_id,
        source="upload",
        entity_type=entity_type,
        entity_id=entity_id,
        file_role=file_role,
        original_ext=original_ext,
        episode_id=episode_id,
    )

    if file_type in ("image", "video", "audio"):
        try:
            create_from_file = media_library_create_from_file
            if create_from_file is None:
                import media_library_service

                create_from_file = media_library_service.create_from_file
            await create_from_file(
                file_record=saved,
                source="upload",
                episode_id=episode_id,
                source_entity_type=entity_type,
                source_entity_id=entity_id,
                title=(filename or "")[:80] or None,
            )
        except Exception as exc:
            if logger:
                logger.warning("media_library 同步失败 (entity-files upload): %s", exc)

    return {"success": True, "file_id": saved["file_id"], "file_url": saved["file_url"]}


async def soft_delete_entity_file(
    *,
    file_id: str,
    entity_file_dao: Any,
) -> Dict[str, Any]:
    ok = await entity_file_dao.soft_delete(file_id)
    if not ok:
        raise EntityFileNotFound("File not found or deleted")
    return {"success": True}


async def hard_delete_entity_file(
    *,
    file_id: str,
    entity_file_dao: Any,
) -> Dict[str, Any]:
    result = await entity_file_dao.hard_delete(file_id)
    if not result:
        raise EntityFileNotFound("File not found")
    return {"success": True, "freed_bytes": result["freed_bytes"]}


async def hard_delete_entity_files_batch(
    *,
    file_ids: list[str],
    entity_file_dao: Any,
) -> Dict[str, Any]:
    if len(file_ids) > 200:
        raise EntityFileBatchTooLarge("Batch hard delete accepts at most 200 files")
    result = await entity_file_dao.hard_delete_batch(file_ids)
    return {"success": True, **result}


async def run_entity_file_migration(
    *,
    migration_runner: Optional[Callable[[], Any]] = None,
) -> Dict[str, Any]:
    try:
        if migration_runner is not None:
            recovered = await migration_runner()
            return {"success": True, "recovered": recovered}

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
        raise EntityFileMigrationFailed(str(exc)) from exc
