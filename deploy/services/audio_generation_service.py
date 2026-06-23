"""Generated audio persistence helpers for audio routes."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Awaitable, Callable, Mapping, MutableMapping, Optional


SaveGeneratedFile = Callable[..., Awaitable[dict[str, Any]]]
CreateMediaLibraryItem = Callable[..., Awaitable[Any]]


async def _default_create_media_library_item(**kwargs: Any) -> Any:
    import media_library_service

    return await media_library_service.create_from_file(**kwargs)


async def attach_local_generated_audio_file(
    result: Mapping[str, Any] | None,
    *,
    audio_upload_dir: str | Path,
    user_id: str,
    source: str,
    entity_type: Optional[str],
    entity_id: Optional[str],
    file_role: str,
    episode_id: Optional[str],
    media_source: str,
    title: Optional[str],
    logger: Any,
    save_generated_file_to_db: SaveGeneratedFile,
    create_media_library_item: Optional[CreateMediaLibraryItem] = None,
) -> MutableMapping[str, Any]:
    """Attach a DB file record for a provider-generated local audio URL.

    Providers return an `audio_url` that often points at a file already written
    under the local audio upload directory. This helper performs the shared
    best-effort tail work: read local bytes, register the generated file, and
    create a media-library index row with caller-specific metadata.
    """

    enriched: MutableMapping[str, Any] = dict(result or {})
    audio_url = enriched.get("audio_url") or ""
    if not audio_url:
        return enriched

    audio_filename = os.path.basename(str(audio_url))
    if not audio_filename:
        return enriched

    audio_file_path = Path(audio_upload_dir) / audio_filename
    if not audio_file_path.exists():
        logger.warning("Generated audio file not found for url=%s path=%s", audio_url, audio_file_path)
        return enriched

    try:
        saved = await save_generated_file_to_db(
            content=audio_file_path.read_bytes(),
            file_type="audio",
            user_id=user_id,
            source=source,
            entity_type=entity_type,
            entity_id=entity_id,
            file_role=file_role,
            original_ext=audio_file_path.suffix,
            episode_id=episode_id,
        )
        enriched["file_id"] = saved["file_id"]
        enriched["file_url"] = saved["file_url"]
    except Exception as exc:
        logger.warning("Failed to save generated audio to files table: %s", exc)
        return enriched

    media_library_creator = create_media_library_item or _default_create_media_library_item
    try:
        await media_library_creator(
            file_record=saved,
            source=media_source,
            episode_id=episode_id,
            source_entity_type=entity_type,
            source_entity_id=entity_id,
            title=title,
        )
    except Exception as exc:
        logger.warning("media_library sync failed (%s): %s", media_source, exc)

    return enriched
