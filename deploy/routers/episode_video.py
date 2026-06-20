# -*- coding: utf-8 -*-
"""Episode video segment and composition route handlers."""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel


class VideoSegmentCreate(BaseModel):
    sort_order: int = 0
    storyboard_item_id: Optional[str] = None
    generation_mode: str = 'i2v'
    model: str = ''
    input_params: Optional[dict] = None


class VideoSegmentUpdate(BaseModel):
    sort_order: Optional[int] = None
    generation_mode: Optional[str] = None
    model: Optional[str] = None
    video_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    duration_ms: Optional[int] = None
    task_id: Optional[str] = None
    status: Optional[str] = None
    input_params: Optional[dict] = None


def create_episode_video_router(
    *,
    get_current_user_dependency: Any,
    video_segment_dao: Any,
    episode_dao: Any,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency
    VideoSegmentDAO = video_segment_dao
    EpisodeDAO = episode_dao

    @router.get("/api/episodes/{episode_id}/video-segments")
    async def get_video_segments(episode_id: str, user_id: str = Depends(get_current_user)):
        segments = await VideoSegmentDAO.get_by_episode(episode_id)
        return {"success": True, "segments": [dict(s) for s in segments]}

    @router.get("/api/episodes/{episode_id}/video-takes")
    async def video_takes_endpoint(episode_id: str, user_id: str = Depends(get_current_user)):
        """Return all generated video takes grouped by storyboard item for composition selection."""
        import compose_service

        shots = await compose_service.get_takes(episode_id)
        return {"success": True, "shots": shots}

    @router.post("/api/episodes/{episode_id}/compose")
    async def compose_episode_endpoint(episode_id: str, request: Request, user_id: str = Depends(get_current_user)):
        """Start async episode composition; frontend polls `/compose/status`."""
        project_id = await EpisodeDAO.get_project_id(episode_id)
        if not project_id:
            raise HTTPException(status_code=404, detail="集不存在")
        selections = None
        try:
            body = await request.json()
            selections = (body or {}).get("selections")
        except Exception:
            selections = None
        import compose_service

        job = compose_service.start_compose(episode_id, user_id, project_id, selections)
        return {"success": True, "status": job["status"], "total": job["total"], "done": job["done"]}

    @router.get("/api/episodes/{episode_id}/compose/status")
    async def compose_status_endpoint(episode_id: str, user_id: str = Depends(get_current_user)):
        """Return episode composition status."""
        import compose_service

        return {"success": True, **compose_service.get_status(episode_id)}

    @router.post("/api/episodes/{episode_id}/video-segments")
    async def create_video_segment(episode_id: str, data: VideoSegmentCreate, user_id: str = Depends(get_current_user)):
        seg = await VideoSegmentDAO.create(
            episode_id=episode_id, sort_order=data.sort_order,
            storyboard_item_id=data.storyboard_item_id,
            generation_mode=data.generation_mode,
            model=data.model, input_params=data.input_params
        )
        if not seg:
            raise HTTPException(status_code=500, detail="创建视频片段失败")
        return {"success": True, "segment": dict(seg)}

    @router.put("/api/video-segments/{segment_id}")
    async def update_video_segment(segment_id: str, data: VideoSegmentUpdate, user_id: str = Depends(get_current_user)):
        seg = await VideoSegmentDAO.update(segment_id, **data.dict(exclude_none=True))
        if not seg:
            raise HTTPException(status_code=404, detail="视频片段不存在")
        return {"success": True, "segment": dict(seg)}

    @router.delete("/api/video-segments/{segment_id}")
    async def delete_video_segment(segment_id: str, user_id: str = Depends(get_current_user)):
        ok = await VideoSegmentDAO.delete(segment_id)
        if not ok:
            raise HTTPException(404, "视频段不存在")
        return {"success": True}

    return router
