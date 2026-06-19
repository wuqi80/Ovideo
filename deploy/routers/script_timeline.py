# -*- coding: utf-8 -*-
"""Script, script segment, and timeline route handlers."""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel


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
        if script_id:
            rows = await EpisodeScriptSegmentDAO.list_by_script(episode_id, script_id)
        else:
            rows = await EpisodeScriptSegmentDAO.list_by_episode(episode_id)
        return {"success": True, "segments": rows}


    @router.put("/api/episodes/{episode_id}/script-segments/batch")
    async def batch_save_script_segments(episode_id: str, data: ScriptSegmentBatchBody,
                                         user_id: str = Depends(get_current_user)):
        rows = await EpisodeScriptSegmentDAO.batch_replace(episode_id, data.script_id, data.segments)
        return {"success": True, "segments": rows}


    @router.delete("/api/episodes/{episode_id}/script-segments")
    async def delete_script_segments(episode_id: str, script_id: Optional[str] = None,
                                     user_id: str = Depends(get_current_user)):
        count = await EpisodeScriptSegmentDAO.delete_by_script(episode_id, script_id)
        return {"success": True, "deleted": count}


    @router.get("/api/episodes/{episode_id}/script")
    async def get_script(episode_id: str, user_id: str = Depends(get_current_user)):
        script = await EpisodeScriptDAO.get_by_episode(episode_id)
        if not script:
            return {"success": True, "script": None}
        return {"success": True, "script": dict(script)}


    @router.put("/api/episodes/{episode_id}/script")
    async def update_script(episode_id: str, data: ScriptUpdate, user_id: str = Depends(get_current_user)):
        script = await EpisodeScriptDAO.save_or_update(
            episode_id=episode_id,
            original_content=data.original_content or '',
            adapted_script=data.adapted_script or '',
            metadata=data.metadata
        )
        if not script:
            raise HTTPException(status_code=500, detail="保存剧本失败")
        return {"success": True, "script": dict(script)}


    # ---------- 多文件剧本 API ----------

    @router.get("/api/episodes/{episode_id}/scripts")
    async def list_scripts(episode_id: str, user_id: str = Depends(get_current_user)):
        scripts = await EpisodeScriptDAO.list_by_episode(episode_id)
        return {"success": True, "scripts": scripts}


    @router.post("/api/episodes/{episode_id}/scripts")
    async def create_script(episode_id: str, data: ScriptCreate, user_id: str = Depends(get_current_user)):
        sort_order = data.sort_order
        if sort_order is None:
            sort_order = await EpisodeScriptDAO.get_next_sort_order(episode_id)
        script = await EpisodeScriptDAO.create(
            episode_id=episode_id,
            file_name=data.file_name,
            original_content=data.original_content,
            adapted_script=data.adapted_script,
            sort_order=sort_order,
            metadata=data.metadata,
        )
        if not script:
            raise HTTPException(status_code=500, detail="创建剧本文件失败")
        return {"success": True, "script": dict(script)}


    @router.put("/api/episodes/{episode_id}/scripts/{script_id}")
    async def update_script_by_id(episode_id: str, script_id: str, data: ScriptUpdate, user_id: str = Depends(get_current_user)):
        script = await EpisodeScriptDAO.update(
            script_id=script_id,
            file_name=data.file_name,
            original_content=data.original_content,
            adapted_script=data.adapted_script,
            metadata=data.metadata,
        )
        if not script:
            raise HTTPException(status_code=404, detail="剧本文件不存在")
        return {"success": True, "script": dict(script)}


    @router.delete("/api/episodes/{episode_id}/scripts/{script_id}")
    async def delete_script_by_id(episode_id: str, script_id: str, user_id: str = Depends(get_current_user)):
        ok = await EpisodeScriptDAO.delete_by_id(script_id)
        if not ok:
            raise HTTPException(status_code=404, detail="剧本文件不存在")
        return {"success": True}


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
        tracks = await TimelineDAO.get_by_episode(episode_id)
        return {"success": True, "tracks": [dict(t) for t in tracks]}


    @router.post("/api/episodes/{episode_id}/timeline-tracks")
    async def create_timeline_track(episode_id: str, data: TimelineTrackCreate, user_id: str = Depends(get_current_user)):
        track = await TimelineDAO.create(
            episode_id=episode_id, track_type=data.track_type,
            track_name=data.track_name, sort_order=data.sort_order,
            items=data.items
        )
        if not track:
            raise HTTPException(status_code=500, detail="创建时间轴轨道失败")
        return {"success": True, "track": dict(track)}


    @router.put("/api/timeline-tracks/{track_id}")
    async def update_timeline_track(track_id: str, data: TimelineTrackUpdate, user_id: str = Depends(get_current_user)):
        track = await TimelineDAO.update(track_id, **data.dict(exclude_none=True))
        if not track:
            raise HTTPException(status_code=404, detail="时间轴轨道不存在")
        return {"success": True, "track": dict(track)}


    # ============================================
    # 人物音色 API

    return router
