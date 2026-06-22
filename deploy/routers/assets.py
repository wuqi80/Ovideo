# -*- coding: utf-8 -*-
"""Project asset CRUD and asset sharing routes."""

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from services.asset_service import (
    AssetCreateFailed,
    AssetNotFound,
    create_asset as create_asset_service,
    delete_asset as delete_asset_service,
    list_assets,
    share_asset as share_asset_service,
    update_asset as update_asset_service,
)


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
        return await list_assets(
            project_id,
            episode_id=episode_id,
            asset_type=asset_type,
            script_id=script_id,
            asset_dao=AssetDAO,
            entity_file_dao=EntityFileDAO,
        )

    @router.post("/api/assets")
    async def create_asset(data: AssetCreate, user_id: str = Depends(get_current_user)):
        try:
            return await create_asset_service(
                project_id=data.project_id,
                asset_type=data.asset_type,
                name=data.name,
                user_id=user_id,
                episode_id=data.episode_id,
                script_id=data.script_id,
                description=data.description,
                reference_images=data.reference_images,
                asset_dao=AssetDAO,
            )
        except AssetCreateFailed as exc:
            raise HTTPException(status_code=500, detail="创建资产失败") from exc

    @router.put("/api/assets/{asset_id}")
    async def update_asset(asset_id: str, data: AssetUpdate, user_id: str = Depends(get_current_user)):
        try:
            return await update_asset_service(
                asset_id,
                data.dict(exclude_none=True),
                asset_dao=AssetDAO,
            )
        except AssetNotFound as exc:
            raise HTTPException(status_code=404, detail="资产不存在") from exc

    @router.delete("/api/assets/{asset_id}")
    async def delete_asset(asset_id: str, user_id: str = Depends(get_current_user)):
        try:
            return await delete_asset_service(asset_id, asset_dao=AssetDAO)
        except AssetNotFound as exc:
            raise HTTPException(status_code=404, detail="资产不存在") from exc

    @router.post("/api/assets/{asset_id}/share")
    async def share_asset(asset_id: str, data: AssetShareRequest, user_id: str = Depends(get_current_user)):
        """Copy an asset to a target episode/script, including linked entity files."""
        try:
            return await share_asset_service(
                asset_id,
                target_episode_id=data.target_episode_id,
                target_script_id=data.target_script_id,
                user_id=user_id,
                asset_dao=AssetDAO,
                entity_file_dao=EntityFileDAO,
                logger=logger,
            )
        except AssetNotFound as exc:
            raise HTTPException(status_code=404, detail="源资产不存在") from exc

    return router
