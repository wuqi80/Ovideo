# -*- coding: utf-8 -*-
"""Script, script segment, and timeline route handlers."""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from services.script_timeline_service import (
    ScriptFileCreateFailed,
    ScriptFileNotFound,
    ScriptSaveFailed,
    TimelineTrackCreateFailed,
    TimelineTrackNotFound,
    batch_save_script_segments as batch_save_script_segments_service,
    create_script_file,
    create_timeline_track as create_timeline_track_service,
    delete_script_file,
    delete_script_segments as delete_script_segments_service,
    get_primary_script,
    list_script_segments as list_script_segments_service,
    list_scripts as list_scripts_service,
    list_timeline_tracks,
    update_primary_script,
    update_script_file,
    update_timeline_track as update_timeline_track_service,
)


def create_script_timeline_router(
    *,
    get_current_user_dependency: Any,
    episode_script_dao: Any,
    episode_script_segment_dao: Any,
    timeline_dao: Any,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency
    EpisodeScriptDAO = episode_script_dao
    EpisodeScriptSegmentDAO = episode_script_segment_dao
    TimelineDAO = timeline_dao

    # ============================================

    class ScriptUpdate(BaseModel):
        original_content: Optional[str] = None
        adapted_script: Optional[str] = None
        metadata: Optional[dict] = None
        file_name: Optional[str] = None


    class ScriptCreate(BaseModel):
        file_name: str = '未命名文件'
        original_content: str = ''
        adapted_script: str = ''
        sort_order: Optional[int] = None
        metadata: Optional[dict] = None


    # ---------- 剧本分段 API（2026-05-29 三步生成 Stage 1 产物）----------

    class ScriptSegmentBatchBody(BaseModel):
        script_id: Optional[str] = None
        segments: list = []


    @router.get("/api/episodes/{episode_id}/script-segments")
    async def list_script_segments(episode_id: str, script_id: Optional[str] = None,
                                   user_id: str = Depends(get_current_user)):
        return await list_script_segments_service(
            episode_id,
            script_id,
            episode_script_segment_dao=EpisodeScriptSegmentDAO,
        )


    @router.put("/api/episodes/{episode_id}/script-segments/batch")
    async def batch_save_script_segments(episode_id: str, data: ScriptSegmentBatchBody,
                                         user_id: str = Depends(get_current_user)):
        return await batch_save_script_segments_service(
            episode_id,
            data.script_id,
            data.segments,
            episode_script_segment_dao=EpisodeScriptSegmentDAO,
        )


    @router.delete("/api/episodes/{episode_id}/script-segments")
    async def delete_script_segments(episode_id: str, script_id: Optional[str] = None,
                                     user_id: str = Depends(get_current_user)):
        return await delete_script_segments_service(
            episode_id,
            script_id,
            episode_script_segment_dao=EpisodeScriptSegmentDAO,
        )


    @router.get("/api/episodes/{episode_id}/script")
    async def get_script(episode_id: str, user_id: str = Depends(get_current_user)):
        return await get_primary_script(episode_id, episode_script_dao=EpisodeScriptDAO)


    @router.put("/api/episodes/{episode_id}/script")
    async def update_script(episode_id: str, data: ScriptUpdate, user_id: str = Depends(get_current_user)):
        try:
            return await update_primary_script(
                episode_id,
                original_content=data.original_content,
                adapted_script=data.adapted_script,
                metadata=data.metadata,
                episode_script_dao=EpisodeScriptDAO,
            )
        except ScriptSaveFailed as exc:
            raise HTTPException(status_code=500, detail="保存剧本失败") from exc


    # ---------- 多文件剧本 API ----------

    @router.get("/api/episodes/{episode_id}/scripts")
    async def list_scripts(episode_id: str, user_id: str = Depends(get_current_user)):
        return await list_scripts_service(episode_id, episode_script_dao=EpisodeScriptDAO)


    @router.post("/api/episodes/{episode_id}/scripts")
    async def create_script(episode_id: str, data: ScriptCreate, user_id: str = Depends(get_current_user)):
        try:
            return await create_script_file(
                episode_id,
                file_name=data.file_name,
                original_content=data.original_content,
                adapted_script=data.adapted_script,
                sort_order=data.sort_order,
                metadata=data.metadata,
                episode_script_dao=EpisodeScriptDAO,
            )
        except ScriptFileCreateFailed as exc:
            raise HTTPException(status_code=500, detail="创建剧本文件失败") from exc


    @router.put("/api/episodes/{episode_id}/scripts/{script_id}")
    async def update_script_by_id(episode_id: str, script_id: str, data: ScriptUpdate, user_id: str = Depends(get_current_user)):
        try:
            return await update_script_file(
                script_id,
                file_name=data.file_name,
                original_content=data.original_content,
                adapted_script=data.adapted_script,
                metadata=data.metadata,
                episode_script_dao=EpisodeScriptDAO,
            )
        except ScriptFileNotFound as exc:
            raise HTTPException(status_code=404, detail="剧本文件不存在") from exc


    @router.delete("/api/episodes/{episode_id}/scripts/{script_id}")
    async def delete_script_by_id(episode_id: str, script_id: str, user_id: str = Depends(get_current_user)):
        try:
            return await delete_script_file(script_id, episode_script_dao=EpisodeScriptDAO)
        except ScriptFileNotFound as exc:
            raise HTTPException(status_code=404, detail="剧本文件不存在") from exc


    # ============================================
    # 时间轴 API
    # ============================================

    class TimelineTrackCreate(BaseModel):
        track_type: str
        track_name: str = ''
        sort_order: int = 0
        items: Optional[list] = None

    class TimelineTrackUpdate(BaseModel):
        track_name: Optional[str] = None
        sort_order: Optional[int] = None
        items: Optional[list] = None


    @router.get("/api/episodes/{episode_id}/timeline-tracks")
    async def get_timeline_tracks(episode_id: str, user_id: str = Depends(get_current_user)):
        return await list_timeline_tracks(episode_id, timeline_dao=TimelineDAO)


    @router.post("/api/episodes/{episode_id}/timeline-tracks")
    async def create_timeline_track(episode_id: str, data: TimelineTrackCreate, user_id: str = Depends(get_current_user)):
        try:
            return await create_timeline_track_service(
                episode_id,
                track_type=data.track_type,
                track_name=data.track_name,
                sort_order=data.sort_order,
                items=data.items,
                timeline_dao=TimelineDAO,
            )
        except TimelineTrackCreateFailed as exc:
            raise HTTPException(status_code=500, detail="创建时间轴轨道失败") from exc


    @router.put("/api/timeline-tracks/{track_id}")
    async def update_timeline_track(track_id: str, data: TimelineTrackUpdate, user_id: str = Depends(get_current_user)):
        try:
            return await update_timeline_track_service(
                track_id,
                data.dict(exclude_none=True),
                timeline_dao=TimelineDAO,
            )
        except TimelineTrackNotFound as exc:
            raise HTTPException(status_code=404, detail="时间轴轨道不存在") from exc


    # ============================================
    # 人物音色 API

    return router
