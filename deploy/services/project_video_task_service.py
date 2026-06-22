"""Project video-task export and cleanup service."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Awaitable, Callable, Iterable

from services.project_image_service import (
    is_data_image,
    persist_export_storyboard_base64_image,
)
from utils.json_helpers import parse_jsonb_field


class ProjectVideoTaskError(RuntimeError):
    pass


class ProjectVideoTaskNotFound(ProjectVideoTaskError):
    pass


class ProjectVideoTaskForbidden(ProjectVideoTaskError):
    pass


ImagePersister = Callable[..., Awaitable[Any]]


async def _get_owned_project(
    project_id: str,
    *,
    username: str,
    project_dao: Any,
) -> dict[str, Any]:
    db_project = await project_dao.get_project(project_id)
    if not db_project:
        raise ProjectVideoTaskNotFound("project not found")
    if db_project.get("user_id") != username:
        raise ProjectVideoTaskForbidden("project access denied")
    return db_project


async def _ensure_export_version(
    project_id: str,
    *,
    username: str,
    version_dao: Any,
    logger: Any,
) -> str:
    versions = await version_dao.get_project_versions(project_id)
    if versions:
        version_id = versions[0]["version_id"]
        logger.info("Using existing export version: %s", version_id)
        return version_id

    export_version = await version_dao.create_version(
        project_id=project_id,
        user_id=username,
        version_name="\u5bfc\u51fa\u7248\u672c",
        description="\u753b\u9762\u5206\u955c\u5bfc\u51fa\u5230\u89c6\u9891\u751f\u6210",
    )
    version_id = export_version["version_id"]
    logger.info("Created export version: %s", version_id)
    return version_id


def _select_image_url(shot_images_data: Any, logger: Any, item_id: str) -> tuple[str, Any]:
    if not isinstance(shot_images_data, dict):
        return "", None

    generated_images = shot_images_data.get("images", [])
    selected_image_id = shot_images_data.get("selectedImageId")
    logger.info("Shot %s has %s generated images, selected=%s", item_id, len(generated_images), selected_image_id)

    selected_img = None
    image_url = ""
    if selected_image_id and generated_images:
        selected_img = next((img for img in generated_images if img.get("id") == selected_image_id), None)
        if selected_img:
            image_url = selected_img.get("url") or selected_img.get("thumbnail") or ""
            if image_url:
                logger.info("Selected image found for shot %s: %s...", item_id, image_url[:50])
            else:
                logger.warning("Selected image has no url or thumbnail: %s", item_id)

    if not selected_img and generated_images:
        selected_img = generated_images[0]
        image_url = selected_img.get("url") or selected_img.get("thumbnail") or ""
        if image_url:
            logger.info("Selected image missing for shot %s, using first image: %s...", item_id, image_url[:50])
        else:
            logger.warning("First image has no url or thumbnail: %s", item_id)

    return image_url, selected_img


async def _persist_image_if_needed(
    *,
    image_url: str,
    item: dict[str, Any],
    username: str,
    version_id: str,
    file_dao: Any,
    logger: Any,
    persist_image: ImagePersister,
) -> str:
    if image_url and is_data_image(image_url):
        logger.info("Detected base64 storyboard image for export: %s", image_url[:50])
        try:
            persisted = await persist_image(
                username=username,
                image_data=image_url,
                storyboard_item=item,
                version_id=version_id,
                file_dao=file_dao,
                logger=logger,
            )
            logger.info("Export image persisted: file_id=%s", persisted.file_id)
            return persisted.file_url
        except Exception as exc:
            logger.error("Base64 export image conversion failed: %s", exc, exc_info=True)
            logger.warning("Using original base64 image as fallback")
            return image_url
    if image_url:
        logger.info("Image already uses URL format: %s", image_url[:100])
    return image_url


def _iter_selected_items(items: Iterable[dict[str, Any]], selected_items: set[str]) -> Iterable[dict[str, Any]]:
    for item in items:
        if item.get("id") in selected_items:
            yield item


async def export_project_to_video_response(
    project_id: str,
    *,
    selected_items: Iterable[str],
    username: str,
    project_dao: Any,
    version_dao: Any,
    file_dao: Any,
    logger: Any,
    now_provider: Callable[[], datetime] = datetime.now,
    persist_image: ImagePersister = persist_export_storyboard_base64_image,
) -> dict[str, Any]:
    db_project = await _get_owned_project(project_id, username=username, project_dao=project_dao)
    version_id = await _ensure_export_version(
        project_id,
        username=username,
        version_dao=version_dao,
        logger=logger,
    )

    data = parse_jsonb_field(db_project.get("settings"))
    storyboard = data.get("storyboard", {})
    items = storyboard.get("items", [])
    generated_images_data = data.get("generated_images", {})
    selected_item_ids = set(selected_items)
    logger.info(
        "Export data: storyboard_items=%s generated_image_entries=%s selected=%s",
        len(items),
        len(generated_images_data),
        len(selected_item_ids),
    )

    video_tasks = []
    for item in _iter_selected_items(items, selected_item_ids):
        item_id = item.get("id")
        shot_images_data = generated_images_data.get(item_id, {})
        image_url, _selected_img = _select_image_url(shot_images_data, logger, item_id)
        image_url = await _persist_image_if_needed(
            image_url=image_url,
            item=item,
            username=username,
            version_id=version_id,
            file_dao=file_dao,
            logger=logger,
            persist_image=persist_image,
        )
        if not image_url:
            logger.warning("Shot %s has no image", item_id)

        logger.info("Exporting shot %s image=%s...", item_id, image_url[:50] if image_url else "(none)")
        video_tasks.append(
            {
                "storyboard_id": item["id"],
                "image_url": image_url or "",
                "video_prompt": item.get("videoPrompt", ""),
                "dialogue": item.get("dialogue", ""),
                "characters": item.get("characters", []),
                "scene": item.get("scene", ""),
            }
        )

    data["video_tasks"] = video_tasks
    data["stage"] = 4
    data["updated_at"] = now_provider().isoformat()
    await project_dao.save_or_update_project(
        user_id=username,
        project_id=project_id,
        project_name=db_project.get("project_name", "Untitled"),
        project_data=data,
        description=db_project.get("description", ""),
    )

    logger.info("Exported storyboard shots to video tasks: count=%s", len(video_tasks))
    return {"success": True, "exported_count": len(video_tasks), "video_tasks": video_tasks}


async def clear_project_video_tasks_response(
    project_id: str,
    *,
    username: str,
    project_dao: Any,
    logger: Any,
) -> dict[str, Any]:
    db_project = await _get_owned_project(project_id, username=username, project_dao=project_dao)
    data = parse_jsonb_field(db_project.get("settings"))

    if "video_tasks" not in data:
        return {"success": True, "cleared_count": 0}

    cleared_count = len(data["video_tasks"])
    data["video_tasks"] = []
    await project_dao.save_or_update_project(
        user_id=username,
        project_id=project_id,
        project_name=db_project.get("project_name", "Untitled"),
        project_data=data,
        description=db_project.get("description", ""),
    )

    logger.info("Cleared project video tasks: project=%s count=%s", project_id, cleared_count)
    return {"success": True, "cleared_count": cleared_count}
