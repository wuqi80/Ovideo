"""Project-level character video voice reference endpoints."""
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from services.project_access_service import ProjectAccessDenied, require_project_access
from services.video_voice_reference_service import (
    VideoVoiceReferenceError,
    VideoVoiceReferenceValidationError,
    create_from_video,
    extract_audio_reference_from_video,
)


class VideoVoiceReferenceCreate(BaseModel):
    project_id: str
    episode_id: str
    character_name: str
    source_video_url: str
    storyboard_item_id: Optional[str] = None
    video_segment_id: Optional[str] = None
    video_model: Optional[str] = None


class VideoReferenceAudioExtract(BaseModel):
    project_id: str
    episode_id: str
    source_video_url: str
    storyboard_item_id: Optional[str] = None
    video_segment_id: Optional[str] = None
    video_model: Optional[str] = None


def create_video_voice_references_router(
    *,
    get_current_user_dependency: Any,
    video_voice_reference_dao: Any,
    episode_dao: Any,
    project_access_checker: Any = require_project_access,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency

    async def require_project(project_id: str, identity: str, role: str) -> None:
        try:
            await project_access_checker(project_id, identity, role)
        except ProjectAccessDenied as exc:
            raise HTTPException(status_code=404, detail="项目不存在或无权访问") from exc

    async def require_episode_project(episode_id: str, project_id: str, identity: str) -> None:
        actual_project_id = await episode_dao.get_project_id(episode_id)
        if actual_project_id != project_id:
            raise HTTPException(status_code=404, detail="集不存在")
        await require_project(project_id, identity, 'member')

    @router.get("/api/projects/{project_id}/video-voice-references")
    async def list_video_voice_references(
        project_id: str,
        user_id: str = Depends(get_current_user),
    ):
        await require_project(project_id, user_id, 'readonly')
        rows = await video_voice_reference_dao.get_by_project(project_id)
        return {"success": True, "references": [dict(row) for row in rows]}

    @router.post("/api/video-voice-references/from-video")
    async def create_video_voice_reference(
        data: VideoVoiceReferenceCreate,
        user_id: str = Depends(get_current_user),
    ):
        await require_episode_project(data.episode_id, data.project_id, user_id)
        try:
            return await create_from_video(
                project_id=data.project_id,
                episode_id=data.episode_id,
                character_name=data.character_name,
                source_video_url=data.source_video_url,
                storyboard_item_id=data.storyboard_item_id,
                video_segment_id=data.video_segment_id,
                video_model=data.video_model,
                user_id=user_id,
                video_voice_reference_dao=video_voice_reference_dao,
                episode_dao=episode_dao,
            )
        except VideoVoiceReferenceValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except VideoVoiceReferenceError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.post("/api/video-voice-references/extract-audio")
    async def extract_video_reference_audio(
        data: VideoReferenceAudioExtract,
        user_id: str = Depends(get_current_user),
    ):
        await require_episode_project(data.episode_id, data.project_id, user_id)
        try:
            return await extract_audio_reference_from_video(
                project_id=data.project_id,
                episode_id=data.episode_id,
                source_video_url=data.source_video_url,
                storyboard_item_id=data.storyboard_item_id,
                video_segment_id=data.video_segment_id,
                video_model=data.video_model,
                user_id=user_id,
                episode_dao=episode_dao,
            )
        except VideoVoiceReferenceValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except VideoVoiceReferenceError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.delete("/api/video-voice-references/{reference_id}")
    async def delete_video_voice_reference(
        reference_id: str,
        user_id: str = Depends(get_current_user),
    ):
        reference = await video_voice_reference_dao.get_by_id(reference_id)
        if not reference:
            raise HTTPException(status_code=404, detail="Video voice reference not found")
        await require_project(reference['project_id'], user_id, 'member')
        if not await video_voice_reference_dao.delete(reference_id):
            raise HTTPException(status_code=404, detail="Video voice reference not found")
        return {"success": True}

    return router
