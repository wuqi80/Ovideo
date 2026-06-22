# -*- coding: utf-8 -*-
"""Episode video segment and composition route handlers."""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from services.episode_video_service import (
    EpisodeNotFound,
    VideoSegmentCreateFailed,
    VideoSegmentNotFound,
    create_video_segment as create_video_segment_service,
    delete_video_segment as delete_video_segment_service,
    get_episode_compose_status,
    get_video_takes,
    list_video_segments,
    start_episode_compose,
    update_video_segment as update_video_segment_service,
)


class VideoSegmentCreate(BaseModel):
    sort_order: int = 0
    storyboard_item_id: Optional[str] = None
    generation_mode: str = "i2v"
    model: str = ""
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
        return await list_video_segments(episode_id, video_segment_dao=VideoSegmentDAO)

    @router.get("/api/episodes/{episode_id}/video-takes")
    async def video_takes_endpoint(episode_id: str, user_id: str = Depends(get_current_user)):
        """Return all generated video takes grouped by storyboard item for composition selection."""
        return await get_video_takes(episode_id)

    @router.post("/api/episodes/{episode_id}/compose")
    async def compose_episode_endpoint(episode_id: str, request: Request, user_id: str = Depends(get_current_user)):
        """Start async episode composition; frontend polls `/compose/status`."""
        selections = None
        try:
            body = await request.json()
            selections = (body or {}).get("selections")
        except Exception:
            selections = None

        try:
            return await start_episode_compose(
                episode_id,
                user_id,
                selections,
                episode_dao=EpisodeDAO,
            )
        except EpisodeNotFound as exc:
            raise HTTPException(status_code=404, detail="剧集不存在") from exc

    @router.get("/api/episodes/{episode_id}/compose/status")
    async def compose_status_endpoint(episode_id: str, user_id: str = Depends(get_current_user)):
        """Return episode composition status."""
        return get_episode_compose_status(episode_id)

    @router.post("/api/episodes/{episode_id}/video-segments")
    async def create_video_segment(episode_id: str, data: VideoSegmentCreate, user_id: str = Depends(get_current_user)):
        try:
            return await create_video_segment_service(
                episode_id,
                sort_order=data.sort_order,
                storyboard_item_id=data.storyboard_item_id,
                generation_mode=data.generation_mode,
                model=data.model,
                input_params=data.input_params,
                video_segment_dao=VideoSegmentDAO,
            )
        except VideoSegmentCreateFailed as exc:
            raise HTTPException(status_code=500, detail="创建视频片段失败") from exc

    @router.put("/api/video-segments/{segment_id}")
    async def update_video_segment(segment_id: str, data: VideoSegmentUpdate, user_id: str = Depends(get_current_user)):
        try:
            return await update_video_segment_service(
                segment_id,
                data.dict(exclude_none=True),
                video_segment_dao=VideoSegmentDAO,
            )
        except VideoSegmentNotFound as exc:
            raise HTTPException(status_code=404, detail="视频片段不存在") from exc

    @router.delete("/api/video-segments/{segment_id}")
    async def delete_video_segment(segment_id: str, user_id: str = Depends(get_current_user)):
        try:
            return await delete_video_segment_service(segment_id, video_segment_dao=VideoSegmentDAO)
        except VideoSegmentNotFound as exc:
            raise HTTPException(status_code=404, detail="视频段不存在") from exc

    return router
