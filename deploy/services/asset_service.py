"""Project asset business logic."""
from __future__ import annotations

import logging
from typing import Any, Dict, Iterable, Optional


class AssetServiceError(RuntimeError):
    pass


class AssetCreateFailed(AssetServiceError):
    pass


class AssetNotFound(AssetServiceError):
    pass


def _rows_to_dicts(rows: Iterable[Any]) -> list[Dict[str, Any]]:
    return [dict(row) for row in rows]


async def list_assets(
    project_id: str,
    *,
    episode_id: Optional[str],
    asset_type: Optional[str],
    script_id: Optional[str],
    asset_dao: Any,
    entity_file_dao: Any,
) -> Dict[str, Any]:
    assets = await asset_dao.get_by_project(project_id, episode_id, asset_type, script_id=script_id)
    assets_list = _rows_to_dicts(assets)
    asset_ids = [asset["asset_id"] for asset in assets_list]

    files_map = {}
    if asset_ids:
        files_map = await entity_file_dao.get_files_for_entities("asset", asset_ids)

    for asset in assets_list:
        asset["entity_files"] = files_map.get(asset["asset_id"], [])

    return {"success": True, "assets": assets_list}


async def create_asset(
    *,
    project_id: str,
    asset_type: str,
    name: str,
    user_id: str,
    episode_id: Optional[str],
    script_id: Optional[str],
    description: Optional[str],
    reference_images: Optional[list],
    asset_dao: Any,
) -> Dict[str, Any]:
    asset = await asset_dao.create(
        project_id=project_id,
        asset_type=asset_type,
        name=name,
        created_by=user_id,
        episode_id=episode_id,
        description=description or "",
        reference_images=reference_images,
        script_id=script_id,
    )
    if not asset:
        raise AssetCreateFailed("Asset create failed")
    return {"success": True, "asset": dict(asset)}


async def update_asset(
    asset_id: str,
    fields: Dict[str, Any],
    *,
    asset_dao: Any,
) -> Dict[str, Any]:
    asset = await asset_dao.update(asset_id, **fields)
    if not asset:
        raise AssetNotFound("Asset not found")
    return {"success": True, "asset": dict(asset)}


async def delete_asset(
    asset_id: str,
    *,
    asset_dao: Any,
) -> Dict[str, Any]:
    ok = await asset_dao.delete(asset_id)
    if not ok:
        raise AssetNotFound("Asset not found")
    return {"success": True}


async def share_asset(
    asset_id: str,
    *,
    target_episode_id: str,
    target_script_id: str,
    user_id: str,
    asset_dao: Any,
    entity_file_dao: Any,
    logger: Optional[logging.Logger] = None,
) -> Dict[str, Any]:
    new_asset = await asset_dao.copy_to(
        asset_id=asset_id,
        target_episode_id=target_episode_id,
        target_script_id=target_script_id,
        created_by=user_id,
    )
    if not new_asset:
        raise AssetNotFound("Source asset not found")

    copied_files = []
    try:
        source_files = await entity_file_dao.get_entity_files("asset", asset_id)
        for entity_file in source_files.get("items", []):
            copied = await entity_file_dao.copy_file(
                entity_file["file_id"],
                "asset",
                new_asset["asset_id"],
                entity_file.get("file_role", "reference_image"),
            )
            if copied:
                copied_files.append(copied)
    except Exception as exc:
        if logger:
            logger.warning("复制资产关联文件失败: %s", exc)

    return {"success": True, "asset": dict(new_asset), "copied_files": len(copied_files)}
