# -*- coding: utf-8 -*-
"""Episode CRUD, duplication, and reorder route handlers."""

from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from services.episode_service import (
    EpisodeDuplicateFailed,
    EpisodeNotFound,
    create_episode as create_episode_service,
    delete_episode as delete_episode_service,
    duplicate_episode as duplicate_episode_service,
    get_episode as get_episode_service,
    list_episodes as list_episodes_service,
    reorder_episodes as reorder_episodes_service,
    update_episode as update_episode_service,
)


class EpisodeCreate(BaseModel):
    episode_name: str = ''
    description: str = ''


class EpisodeUpdate(BaseModel):
    episode_name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    settings: Optional[dict] = None
    sort_order: Optional[int] = None


class EpisodeReorder(BaseModel):
    episode_ids: List[str]


def create_episodes_router(
    *,
    get_current_user_dependency: Any,
    episode_dao: Any,
    episode_script_dao: Any,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency
    EpisodeDAO = episode_dao
    EpisodeScriptDAO = episode_script_dao

    @router.get("/api/projects/{project_id}/episodes")
    async def list_episodes(project_id: str, user_id: str = Depends(get_current_user)):
        try:
            return await list_episodes_service(project_id, episode_dao=EpisodeDAO)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.post("/api/projects/{project_id}/episodes")
    async def create_episode(project_id: str, data: EpisodeCreate, user_id: str = Depends(get_current_user)):
        try:
            return await create_episode_service(
                project_id,
                episode_name=data.episode_name,
                description=data.description,
                episode_dao=EpisodeDAO,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.get("/api/episodes/{episode_id}")
    async def get_episode(episode_id: str, user_id: str = Depends(get_current_user)):
        try:
            return await get_episode_service(episode_id, episode_dao=EpisodeDAO)
        except EpisodeNotFound as e:
            raise HTTPException(status_code=404, detail="集数不存在") from e
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.put("/api/episodes/{episode_id}")
    async def update_episode(episode_id: str, data: EpisodeUpdate, user_id: str = Depends(get_current_user)):
        try:
            return await update_episode_service(
                episode_id,
                data.model_dump(),
                episode_dao=EpisodeDAO,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.delete("/api/episodes/{episode_id}")
    async def delete_episode(episode_id: str, user_id: str = Depends(get_current_user)):
        try:
            return await delete_episode_service(episode_id, episode_dao=EpisodeDAO)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.post("/api/episodes/{episode_id}/duplicate")
    async def duplicate_episode(episode_id: str, user_id: str = Depends(get_current_user)):
        """复制一个分集：新建副本并拷贝剧本内容。"""
        try:
            return await duplicate_episode_service(
                episode_id,
                episode_dao=EpisodeDAO,
                episode_script_dao=EpisodeScriptDAO,
            )
        except EpisodeNotFound as e:
            raise HTTPException(status_code=404, detail="集数不存在") from e
        except EpisodeDuplicateFailed as e:
            raise HTTPException(status_code=500, detail="复制分集失败") from e
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.post("/api/projects/{project_id}/episodes/reorder")
    async def reorder_episodes(project_id: str, data: EpisodeReorder, user_id: str = Depends(get_current_user)):
        try:
            return await reorder_episodes_service(
                project_id,
                data.episode_ids,
                episode_dao=EpisodeDAO,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    return router
