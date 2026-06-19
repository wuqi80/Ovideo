# -*- coding: utf-8 -*-
"""Project asset CRUD and asset sharing routes."""

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel


def create_assets_router(
    *,
    get_current_user_dependency: Any,
    asset_dao: Any,
    entity_file_dao: Any,
    logger: logging.Logger,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency
    AssetDAO = asset_dao
    EntityFileDAO = entity_file_dao

    class AssetCreate(BaseModel):
        project_id: str
        asset_type: str
        name: str
        episode_id: Optional[str] = None
        script_id: Optional[str] = None
        description: Optional[str] = ""
        reference_images: Optional[list] = None

    class AssetUpdate(BaseModel):
        name: Optional[str] = None
        description: Optional[str] = None
        thumbnail_url: Optional[str] = None
        episode_id: Optional[str] = None
        reference_images: Optional[list] = None
        style_params: Optional[dict] = None
        tags: Optional[list] = None

    class AssetShareRequest(BaseModel):
        target_episode_id: str
        target_script_id: str

    @router.get("/api/projects/{project_id}/assets")
    async def get_assets(
        project_id: str,
        episode_id: Optional[str] = None,
        asset_type: Optional[str] = None,
        script_id: Optional[str] = None,
        user_id: str = Depends(get_current_user),
    ):
        assets = await AssetDAO.get_by_project(project_id, episode_id, asset_type, script_id=script_id)
        assets_list = [dict(a) for a in assets]

        asset_ids = [a["asset_id"] for a in assets_list]
        if asset_ids:
            files_map = await EntityFileDAO.get_files_for_entities("asset", asset_ids)
            for asset in assets_list:
                asset["entity_files"] = files_map.get(asset["asset_id"], [])
        else:
            for asset in assets_list:
                asset["entity_files"] = []

        return {"success": True, "assets": assets_list}

    @router.post("/api/assets")
    async def create_asset(data: AssetCreate, user_id: str = Depends(get_current_user)):
        asset = await AssetDAO.create(
            project_id=data.project_id,
            asset_type=data.asset_type,
            name=data.name,
            created_by=user_id,
            episode_id=data.episode_id,
            description=data.description or "",
            reference_images=data.reference_images,
            script_id=data.script_id,
        )
        if not asset:
            raise HTTPException(status_code=500, detail="创建资产失败")
        return {"success": True, "asset": dict(asset)}

    @router.put("/api/assets/{asset_id}")
    async def update_asset(asset_id: str, data: AssetUpdate, user_id: str = Depends(get_current_user)):
        asset = await AssetDAO.update(asset_id, **data.dict(exclude_none=True))
        if not asset:
            raise HTTPException(status_code=404, detail="资产不存在")
        return {"success": True, "asset": dict(asset)}

    @router.delete("/api/assets/{asset_id}")
    async def delete_asset(asset_id: str, user_id: str = Depends(get_current_user)):
        ok = await AssetDAO.delete(asset_id)
        if not ok:
            raise HTTPException(status_code=404, detail="资产不存在")
        return {"success": True}

    @router.post("/api/assets/{asset_id}/share")
    async def share_asset(asset_id: str, data: AssetShareRequest, user_id: str = Depends(get_current_user)):
        """Copy an asset to a target episode/script, including linked entity files."""
        new_asset = await AssetDAO.copy_to(
            asset_id=asset_id,
            target_episode_id=data.target_episode_id,
            target_script_id=data.target_script_id,
            created_by=user_id,
        )
        if not new_asset:
            raise HTTPException(status_code=404, detail="源资产不存在")

        copied_files = []
        try:
            source_files = await EntityFileDAO.get_entity_files("asset", asset_id)
            items = source_files.get("items", [])
            for ef in items:
                copied = await EntityFileDAO.copy_file(
                    ef["file_id"],
                    "asset",
                    new_asset["asset_id"],
                    ef.get("file_role", "reference_image"),
                )
                if copied:
                    copied_files.append(copied)
        except Exception as exc:
            logger.warning("复制资产关联文件失败: %s", exc)

        return {"success": True, "asset": dict(new_asset), "copied_files": len(copied_files)}

    return router
