"""Persistence helpers for AI proxy generated images."""
from __future__ import annotations

import logging
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Optional

from services.ai_proxy_service import generated_image_content


SaveGeneratedFile = Callable[..., Awaitable[Dict[str, Any]]]
GeneratedImageContentLoader = Callable[[str], bytes]
GetFileRecord = Callable[[str], Awaitable[Any]]
CreateMediaLibraryItem = Callable[..., Awaitable[Any]]


async def _default_save_generated_file_to_db(**kwargs: Any) -> Dict[str, Any]:
    from file_service import save_generated_file_to_db

    return await save_generated_file_to_db(**kwargs)


async def _default_get_file_record(file_id: str) -> Any:
    from dao_content import FileDAO

    return await FileDAO.get_file(file_id)


async def _default_create_media_library_item(**kwargs: Any) -> Any:
    import media_library_service

    return await media_library_service.create_from_file(**kwargs)


def _image_result_identity(image: str, *, include_url: bool) -> Dict[str, Optional[str]]:
    if include_url:
        return {
            "data_url": image if image.startswith("data:") else None,
            "url": None if image.startswith("data:") else image,
        }
    return {"data_url": image}


async def persist_generated_ai_images(
    images: Iterable[str],
    *,
    user_id: str,
    source: str,
    media_source: str,
    prompt: str,
    model: str,
    entity_type: Optional[str],
    entity_id: Optional[str],
    file_role: Optional[str],
    episode_id: Optional[str],
    file_metadata: Dict[str, Any],
    media_metadata: Optional[Dict[str, Any]] = None,
    source_task_id: Optional[str] = None,
    include_url: bool = False,
    logger: logging.Logger,
    image_content_loader: GeneratedImageContentLoader = generated_image_content,
    save_generated_file_to_db: SaveGeneratedFile = _default_save_generated_file_to_db,
    get_file_record: GetFileRecord = _default_get_file_record,
    create_media_library_item: CreateMediaLibraryItem = _default_create_media_library_item,
) -> List[Dict[str, Any]]:
    """Persist generated image outputs and create best-effort media-library rows."""

    results: List[Dict[str, Any]] = []
    for image in images:
        result = _image_result_identity(image, include_url=include_url)
        try:
            content = image_content_loader(image)
            saved = await save_generated_file_to_db(
                content=content,
                file_type="image",
                user_id=user_id,
                source=source,
                entity_type=entity_type,
                entity_id=entity_id,
                file_role=file_role or "generated_image",
                original_ext=".png",
                episode_id=episode_id,
                extra_metadata=file_metadata,
            )

            try:
                file_id = saved.get("file_id")
                file_record = await get_file_record(file_id) if file_id else None
                if file_record:
                    await create_media_library_item(
                        file_record=file_record,
                        source=media_source,
                        episode_id=episode_id,
                        source_task_id=source_task_id,
                        source_entity_type=entity_type,
                        source_entity_id=entity_id,
                        title=(prompt or "")[:80] or None,
                        metadata=media_metadata if media_metadata is not None else file_metadata,
                    )
            except Exception as exc:
                logger.warning("media_library sync failed (%s): %s", media_source, exc)

            result.update({"file_id": saved["file_id"], "file_url": saved["file_url"]})
        except Exception as exc:
            logger.warning("Generated AI image save failed (%s): %s", source, exc)
            result.update({"file_id": None, "file_url": None})
        results.append(result)
    return results
