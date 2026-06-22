"""Storyboard item, export, asset extraction, and audio mix business logic."""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, Iterable, Optional


SUPPORTED_STORYBOARD_FIELDS = {"audio", "video", "audio_stage", "materials"}


class StoryboardServiceError(RuntimeError):
    pass


class UnsupportedStoryboardFields(StoryboardServiceError):
    pass


class StoryboardItemNotFound(StoryboardServiceError):
    pass


class StoryboardCreateFailed(StoryboardServiceError):
    pass


class StoryboardReorderFailed(StoryboardServiceError):
    pass


class EpisodeNotFound(StoryboardServiceError):
    pass


def _row_to_dict(row: Any) -> Optional[Dict[str, Any]]:
    return dict(row) if row is not None else None


def _rows_to_dicts(rows: Iterable[Any]) -> list[Dict[str, Any]]:
    return [dict(row) for row in rows]


def normalize_storyboard_fields(fields: Optional[str]) -> Optional[str]:
    selected_fields = (fields or "").strip().lower() or None
    if selected_fields and selected_fields not in SUPPORTED_STORYBOARD_FIELDS:
        raise UnsupportedStoryboardFields(f"unsupported storyboard fields: {selected_fields}")
    return selected_fields


def _normalize_bound_assets(item: Dict[str, Any]) -> Dict[str, Any]:
    if isinstance(item.get("bound_assets"), str):
        try:
            item["bound_assets"] = json.loads(item["bound_assets"]) if item["bound_assets"] else []
        except Exception:
            item["bound_assets"] = []
    return item


async def get_storyboard_items(
    episode_id: str,
    *,
    script_id: Optional[str],
    limit: Optional[int],
    offset: int,
    include_total: bool,
    fields: Optional[str],
    storyboard_dao: Any,
    episode_script_dao: Any,
    logger: Optional[logging.Logger] = None,
) -> Dict[str, Any]:
    selected_fields = normalize_storyboard_fields(fields)
    items = await storyboard_dao.get_by_episode(
        episode_id,
        script_id=script_id,
        limit=limit,
        offset=offset,
        fields=selected_fields,
    )
    fallback_script_id: Optional[str] = None
    fallback_reason: Optional[str] = None
    fallback_total: Optional[int] = None
    requested_script_total: Optional[int] = None

    if script_id:
        try:
            script = await episode_script_dao.get_by_id(script_id)
            script_belongs_to_episode = bool(script and script.get("episode_id") == episode_id)
        except Exception as exc:
            if logger:
                logger.warning(
                    "get_storyboard_items: script ownership check failed ep=%s script=%s: %s",
                    episode_id,
                    script_id,
                    exc,
                )
            script_belongs_to_episode = True

        if not script_belongs_to_episode:
            requested_script_total = await storyboard_dao.count_by_episode(episode_id, script_id=script_id)
            fallback_total = await storyboard_dao.count_by_episode(episode_id, script_id=None)
            should_fallback = fallback_total > requested_script_total
        else:
            should_fallback = False

        if should_fallback:
            fallback_items = await storyboard_dao.get_by_episode(
                episode_id,
                script_id=None,
                limit=limit,
                offset=offset,
                fields=selected_fields,
            )
            if fallback_items:
                items = fallback_items
                fallback_script_id = script_id
                fallback_reason = "stale_script_storyboard"

    result = [_normalize_bound_assets(dict(item)) for item in items]
    payload: Dict[str, Any] = {"success": True, "items": result}
    if fallback_script_id:
        payload["fallback_script_id"] = fallback_script_id
        payload["fallback_reason"] = fallback_reason
        payload["fallback_scope"] = "episode"
    if include_total:
        if fallback_script_id and fallback_total is not None:
            total = fallback_total
        elif script_id and requested_script_total is not None:
            total = requested_script_total
        else:
            total = await storyboard_dao.count_by_episode(
                episode_id,
                script_id=None if fallback_script_id else script_id,
            )
        payload["total"] = total
        payload["limit"] = limit
        payload["offset"] = max(0, int(offset or 0))
    return payload


async def create_storyboard_item(
    episode_id: str,
    *,
    sort_order: int,
    scene_heading: Optional[str],
    dialogue: Optional[str],
    action_text: Optional[str],
    camera_movement: Optional[str],
    image_prompt: Optional[str],
    video_prompt: Optional[str],
    script_id: Optional[str],
    storyboard_dao: Any,
    episode_script_dao: Any,
    logger: Optional[logging.Logger] = None,
) -> Dict[str, Any]:
    resolved_script_id = script_id
    if not resolved_script_id:
        try:
            scripts = await episode_script_dao.list_by_episode(episode_id)
            if scripts:
                resolved_script_id = scripts[-1].get("script_id")
        except Exception as exc:
            if logger:
                logger.warning("create_storyboard_item: fallback script_id failed ep=%s: %s", episode_id, exc)

    item = await storyboard_dao.create(
        episode_id=episode_id,
        sort_order=sort_order,
        scene_heading=scene_heading,
        dialogue=dialogue,
        action_text=action_text,
        camera_movement=camera_movement,
        image_prompt=image_prompt,
        video_prompt=video_prompt,
        script_id=resolved_script_id,
    )
    if not item:
        raise StoryboardCreateFailed("Storyboard create failed")
    return {"success": True, "item": dict(item)}


async def update_storyboard_item(
    item_id: str,
    fields: Dict[str, Any],
    *,
    storyboard_dao: Any,
) -> Dict[str, Any]:
    item = await storyboard_dao.update(item_id, **fields)
    if not item:
        raise StoryboardItemNotFound("Storyboard item not found")
    return {"success": True, "item": dict(item)}


async def delete_storyboard_item(
    item_id: str,
    *,
    storyboard_dao: Any,
) -> Dict[str, Any]:
    ok = await storyboard_dao.delete(item_id)
    if not ok:
        raise StoryboardItemNotFound("Storyboard item not found")
    return {"success": True}


async def delete_all_storyboard_items(
    episode_id: str,
    *,
    script_id: Optional[str],
    storyboard_dao: Any,
) -> Dict[str, Any]:
    count = await storyboard_dao.delete_by_episode(episode_id, script_id=script_id)
    return {"success": True, "deleted": count}


async def export_script(
    episode_id: str,
    *,
    project_id: str,
    original_content: str,
    script_content: str,
    storyboard_items: list[dict],
    characters: list[dict],
    scenes: list[dict],
    script_id: Optional[str],
    user_id: str,
    storyboard_dao: Any,
    episode_script_dao: Any,
    asset_dao: Any,
) -> Dict[str, Any]:
    created = await storyboard_dao.export_script_transaction(
        episode_script_dao=episode_script_dao,
        asset_dao=asset_dao,
        episode_id=episode_id,
        project_id=project_id,
        original_content=original_content,
        script_content=script_content,
        storyboard_items=storyboard_items,
        characters=characters,
        scenes=scenes,
        script_id=script_id,
        created_by=user_id,
    )
    return {
        "success": True,
        "storyboard_items_created": created,
        "characters_count": len(characters),
        "scenes_count": len(scenes),
    }


async def reorder_storyboard_items(
    episode_id: str,
    item_ids: list[str],
    *,
    storyboard_dao: Any,
) -> Dict[str, Any]:
    ok = await storyboard_dao.reorder(episode_id, item_ids)
    if not ok:
        raise StoryboardReorderFailed("Storyboard reorder failed")
    return {"success": True}


async def mix_storyboard_audio(
    *,
    item_id: str,
    dialogue_url: Optional[str],
    narration_url: Optional[str],
    sfx_url: Optional[str],
    dialogue_gain_db: float,
    narration_gain_db: float,
    sfx_gain_db: float,
    user_id: str,
    audio_mixer: Optional[Any] = None,
    mix_input_cls: Optional[Any] = None,
) -> Dict[str, Any]:
    if not (dialogue_url or narration_url or sfx_url):
        raise ValueError("at least one of dialogue/narration/sfx url is required")

    if audio_mixer is None or mix_input_cls is None:
        from audio_mix_service import MixInput, mix_storyboard_audio as default_audio_mixer

        audio_mixer = audio_mixer or default_audio_mixer
        mix_input_cls = mix_input_cls or MixInput

    result = await audio_mixer(
        item_id,
        mix_input_cls(
            dialogue_url=dialogue_url,
            narration_url=narration_url,
            sfx_url=sfx_url,
            dialogue_gain_db=dialogue_gain_db,
            narration_gain_db=narration_gain_db,
            sfx_gain_db=sfx_gain_db,
        ),
        user_id=user_id,
    )
    return {
        "success": result.success,
        "mixed_audio_url": result.mixed_audio_url,
        "cached": result.cached,
        "duration_ms": result.duration_ms,
    }


async def batch_create_storyboard_items(
    episode_id: str,
    *,
    items: list,
    script_id: Optional[str],
    storyboard_dao: Any,
) -> Dict[str, Any]:
    created = await storyboard_dao.batch_create(episode_id, items, script_id=script_id)
    return {"success": True, "items": _rows_to_dicts(created)}


async def extract_to_assets(
    episode_id: str,
    *,
    characters: list,
    scenes: list,
    script_id: Optional[str],
    user_id: str,
    episode_dao: Any,
    asset_dao: Any,
) -> Dict[str, Any]:
    episode = await episode_dao.get_episode(episode_id)
    if not episode:
        raise EpisodeNotFound("Episode not found")
    project_id = str(episode["project_id"])

    existing_assets = await asset_dao.get_by_project(project_id, episode_id, script_id=script_id)
    existing_names = {(asset["asset_type"], asset["name"]) for asset in existing_assets}

    created = []
    for asset_type, rows in (("character", characters), ("scene", scenes)):
        for row in rows:
            name = row.get("name", "").strip()
            if not name or (asset_type, name) in existing_names:
                continue
            asset = await asset_dao.create(
                project_id=project_id,
                asset_type=asset_type,
                name=name,
                created_by=user_id,
                episode_id=episode_id,
                description=row.get("description", ""),
                script_id=script_id,
            )
            if asset:
                created.append(dict(asset))
                existing_names.add((asset_type, name))
    return {"success": True, "assets": created}
