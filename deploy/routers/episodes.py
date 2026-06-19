# -*- coding: utf-8 -*-
"""Episode CRUD, duplication, and reorder route handlers."""

import json
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel


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
            episodes = await EpisodeDAO.get_episodes(project_id)
            return {"success": True, "episodes": episodes}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/api/projects/{project_id}/episodes")
    async def create_episode(project_id: str, data: EpisodeCreate, user_id: str = Depends(get_current_user)):
        try:
            ep_num = await EpisodeDAO.get_next_episode_number(project_id)
            episode = await EpisodeDAO.create_episode(
                project_id=project_id,
                episode_number=ep_num,
                episode_name=data.episode_name or f"第{ep_num}集",
                description=data.description
            )
            return {"success": True, "episode": episode}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/api/episodes/{episode_id}")
    async def get_episode(episode_id: str, user_id: str = Depends(get_current_user)):
        try:
            episode = await EpisodeDAO.get_episode(episode_id)
            if not episode:
                raise HTTPException(status_code=404, detail="集数不存在")
            return {"success": True, "episode": episode}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.put("/api/episodes/{episode_id}")
    async def update_episode(episode_id: str, data: EpisodeUpdate, user_id: str = Depends(get_current_user)):
        try:
            await EpisodeDAO.update_episode(
                episode_id=episode_id,
                episode_name=data.episode_name,
                description=data.description,
                status=data.status,
                settings=data.settings,
                sort_order=data.sort_order
            )
            return {"success": True}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.delete("/api/episodes/{episode_id}")
    async def delete_episode(episode_id: str, user_id: str = Depends(get_current_user)):
        try:
            await EpisodeDAO.delete_episode(episode_id)
            return {"success": True}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/api/episodes/{episode_id}/duplicate")
    async def duplicate_episode(episode_id: str, user_id: str = Depends(get_current_user)):
        """复制一个分集：新建副本并拷贝剧本内容。"""
        try:
            src = await EpisodeDAO.get_episode(episode_id)
            if not src:
                raise HTTPException(status_code=404, detail="集数不存在")

            settings = src.get("settings")
            if isinstance(settings, str):
                try:
                    settings = json.loads(settings)
                except (ValueError, TypeError):
                    settings = {}

            project_id = src["project_id"]
            ep_num = await EpisodeDAO.get_next_episode_number(project_id)
            src_name = src.get("episode_name") or "未命名分集"
            new_ep = await EpisodeDAO.create_episode(
                project_id=project_id,
                episode_number=ep_num,
                episode_name=f"{src_name} 副本",
                description=src.get("description") or "",
                settings=settings or None,
            )
            if not new_ep:
                raise HTTPException(status_code=500, detail="复制分集失败")
            new_episode_id = new_ep["episode_id"]

            scripts = await EpisodeScriptDAO.list_by_episode(episode_id)
            for s in scripts:
                meta = s.get("metadata")
                if isinstance(meta, str):
                    try:
                        meta = json.loads(meta)
                    except (ValueError, TypeError):
                        meta = {}
                await EpisodeScriptDAO.create(
                    episode_id=new_episode_id,
                    file_name=s.get("file_name") or "未命名文件",
                    original_content=s.get("original_content") or "",
                    adapted_script=s.get("adapted_script") or "",
                    sort_order=s.get("sort_order") or 0,
                    metadata=meta or None,
                )

            return {"success": True, "episode": new_ep, "copied_scripts": len(scripts)}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/api/projects/{project_id}/episodes/reorder")
    async def reorder_episodes(project_id: str, data: EpisodeReorder, user_id: str = Depends(get_current_user)):
        try:
            await EpisodeDAO.reorder_episodes(project_id, data.episode_ids)
            return {"success": True}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    return router
