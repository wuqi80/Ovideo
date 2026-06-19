# -*- coding: utf-8 -*-
"""Storyboard item, script export, and storyboard audio mix routes."""

import json
import logging
import uuid
from typing import Any, Callable, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel


def create_storyboard_router(
    *,
    get_current_user_dependency: Any,
    storyboard_dao: Any,
    episode_script_dao: Any,
    asset_dao: Any,
    get_db_manager_func: Callable[[], Any],
    logger: logging.Logger,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency
    StoryboardDAO = storyboard_dao
    EpisodeScriptDAO = episode_script_dao
    AssetDAO = asset_dao

    class ExportScriptRequest(BaseModel):
        project_id: str
        original_content: str = ""
        script_content: str = ""
        storyboard_items: List[dict] = []
        characters: List[dict] = []
        scenes: List[dict] = []
        script_id: Optional[str] = None

    class StoryboardItemCreate(BaseModel):
        sort_order: int = 0
        scene_heading: Optional[str] = ""
        dialogue: Optional[str] = ""
        action_text: Optional[str] = ""
        camera_movement: Optional[str] = ""
        image_prompt: Optional[str] = ""
        video_prompt: Optional[str] = ""
        script_id: Optional[str] = None

    class StoryboardItemUpdate(BaseModel):
        sort_order: Optional[int] = None
        scene_heading: Optional[str] = None
        dialogue: Optional[str] = None
        action_text: Optional[str] = None
        camera_movement: Optional[str] = None
        image_prompt: Optional[str] = None
        video_prompt: Optional[str] = None
        generated_image_url: Optional[str] = None
        status: Optional[str] = None
        dialogue_audio_url: Optional[str] = None
        narration_audio_url: Optional[str] = None
        sfx_audio_url: Optional[str] = None
        audio_duration_ms: Optional[int] = None
        planned_duration_ms: Optional[int] = None
        bound_assets: Optional[list] = None

    class ReorderRequest(BaseModel):
        item_ids: List[str]

    class MixAudioRequest(BaseModel):
        item_id: str
        dialogue_url: Optional[str] = None
        narration_url: Optional[str] = None
        sfx_url: Optional[str] = None
        dialogue_gain_db: float = 0.0
        narration_gain_db: float = -3.0
        sfx_gain_db: float = -8.0

    class MixAudioResponse(BaseModel):
        success: bool
        mixed_audio_url: str
        cached: bool
        duration_ms: int

    class BatchStoryboardCreate(BaseModel):
        items: list
        script_id: Optional[str] = None

    class ExtractToAssetsRequest(BaseModel):
        characters: list
        scenes: list
        script_id: Optional[str] = None

    @router.get("/api/episodes/{episode_id}/storyboard-items")
    async def get_storyboard_items(
        episode_id: str,
        script_id: Optional[str] = None,
        limit: Optional[int] = None,
        offset: int = 0,
        include_total: bool = False,
        user_id: str = Depends(get_current_user),
    ):
        items = await StoryboardDAO.get_by_episode(
            episode_id,
            script_id=script_id,
            limit=limit,
            offset=offset,
        )
        result = []
        for i in items:
            d = dict(i)
            if isinstance(d.get("bound_assets"), str):
                try:
                    d["bound_assets"] = json.loads(d["bound_assets"]) if d["bound_assets"] else []
                except Exception:
                    d["bound_assets"] = []
            result.append(d)
        payload = {"success": True, "items": result}
        if include_total:
            payload["total"] = await StoryboardDAO.count_by_episode(episode_id, script_id=script_id)
            payload["limit"] = limit
            payload["offset"] = max(0, int(offset or 0))
        return payload

    @router.post("/api/episodes/{episode_id}/storyboard-items")
    async def create_storyboard_item(
        episode_id: str,
        data: StoryboardItemCreate,
        user_id: str = Depends(get_current_user),
    ):
        script_id = data.script_id
        if not script_id:
            try:
                scripts = await EpisodeScriptDAO.list_by_episode(episode_id)
                if scripts:
                    script_id = scripts[-1].get("script_id")
            except Exception as exc:
                logger.warning("create_storyboard_item: 回退 script_id 失败 ep=%s: %s", episode_id, exc)
        item = await StoryboardDAO.create(
            episode_id=episode_id,
            sort_order=data.sort_order,
            scene_heading=data.scene_heading,
            dialogue=data.dialogue,
            action_text=data.action_text,
            camera_movement=data.camera_movement,
            image_prompt=data.image_prompt,
            video_prompt=data.video_prompt,
            script_id=script_id,
        )
        if not item:
            raise HTTPException(status_code=500, detail="创建分镜失败")
        return {"success": True, "item": dict(item)}

    @router.put("/api/storyboard-items/{item_id}")
    async def update_storyboard_item(
        item_id: str,
        data: StoryboardItemUpdate,
        user_id: str = Depends(get_current_user),
    ):
        item = await StoryboardDAO.update(item_id, **data.dict(exclude_none=True))
        if not item:
            raise HTTPException(status_code=404, detail="分镜不存在")
        return {"success": True, "item": dict(item)}

    @router.delete("/api/storyboard-items/{item_id}")
    async def delete_storyboard_item(item_id: str, user_id: str = Depends(get_current_user)):
        ok = await StoryboardDAO.delete(item_id)
        if not ok:
            raise HTTPException(status_code=404, detail="分镜不存在")
        return {"success": True}

    @router.delete("/api/episodes/{episode_id}/storyboard-items/all")
    async def delete_all_storyboard_items(
        episode_id: str,
        script_id: Optional[str] = None,
        user_id: str = Depends(get_current_user),
    ):
        count = await StoryboardDAO.delete_by_episode(episode_id, script_id=script_id)
        return {"success": True, "deleted": count}

    @router.post("/api/episodes/{episode_id}/export-script")
    async def export_script(
        episode_id: str,
        req: ExportScriptRequest,
        user_id: str = Depends(get_current_user),
    ):
        db = get_db_manager_func()
        if not db:
            raise HTTPException(500, "数据库不可用")

        async with db.acquire() as conn:
            async with conn.transaction():
                await EpisodeScriptDAO.upsert_transactional(
                    conn,
                    episode_id,
                    original_content=req.original_content,
                    adapted_script=req.script_content,
                    metadata={
                        "extracted_characters": [c.get("name", "") for c in req.characters],
                        "extracted_scenes": [s.get("name", "") for s in req.scenes],
                    },
                )

                if req.script_id:
                    await conn.execute(
                        "DELETE FROM storyboard_items WHERE episode_id = $1 AND script_id = $2",
                        episode_id,
                        req.script_id,
                    )
                else:
                    await conn.execute("DELETE FROM storyboard_items WHERE episode_id = $1", episode_id)

                created = await StoryboardDAO.batch_create_transactional(
                    conn,
                    episode_id,
                    req.storyboard_items,
                    script_id=req.script_id,
                )

                if req.script_id:
                    existing_assets = await conn.fetch(
                        "SELECT asset_type, name FROM assets WHERE project_id = $1 AND episode_id = $2 AND script_id = $3",
                        req.project_id,
                        episode_id,
                        req.script_id,
                    )
                else:
                    existing_assets = await conn.fetch(
                        "SELECT asset_type, name FROM assets WHERE project_id = $1 AND episode_id = $2",
                        req.project_id,
                        episode_id,
                    )
                existing_names = {(r["asset_type"], r["name"]) for r in existing_assets}

                for char in req.characters:
                    name = char.get("name", "").strip()
                    if not name or ("character", name) in existing_names:
                        continue
                    await conn.execute(
                        """
                        INSERT INTO assets (asset_id, project_id, episode_id, script_id, asset_type, name, description, created_by)
                        VALUES ($1, $2, $3, $4, 'character', $5, $6, $7)
                        """,
                        f"asset_{uuid.uuid4().hex[:12]}",
                        req.project_id,
                        episode_id,
                        req.script_id,
                        name,
                        char.get("description", ""),
                        user_id,
                    )
                    existing_names.add(("character", name))

                for scene in req.scenes:
                    name = scene.get("name", "").strip()
                    if not name or ("scene", name) in existing_names:
                        continue
                    await conn.execute(
                        """
                        INSERT INTO assets (asset_id, project_id, episode_id, script_id, asset_type, name, description, created_by)
                        VALUES ($1, $2, $3, $4, 'scene', $5, $6, $7)
                        """,
                        f"asset_{uuid.uuid4().hex[:12]}",
                        req.project_id,
                        episode_id,
                        req.script_id,
                        name,
                        scene.get("description", ""),
                        user_id,
                    )
                    existing_names.add(("scene", name))

        return {
            "success": True,
            "storyboard_items_created": created,
            "characters_count": len(req.characters),
            "scenes_count": len(req.scenes),
        }

    @router.post("/api/episodes/{episode_id}/storyboard-items/reorder")
    async def reorder_storyboard_items(
        episode_id: str,
        data: ReorderRequest,
        user_id: str = Depends(get_current_user),
    ):
        ok = await StoryboardDAO.reorder(episode_id, data.item_ids)
        if not ok:
            raise HTTPException(status_code=500, detail="排序失败")
        return {"success": True}

    @router.post("/api/storyboard/mix-audio", response_model=MixAudioResponse)
    async def mix_storyboard_audio_endpoint(
        body: MixAudioRequest,
        user_id: str = Depends(get_current_user),
    ) -> MixAudioResponse:
        from audio_mix_service import MixInput, mix_storyboard_audio

        if not (body.dialogue_url or body.narration_url or body.sfx_url):
            raise HTTPException(status_code=400, detail="at least one of dialogue/narration/sfx url is required")

        try:
            result = await mix_storyboard_audio(
                body.item_id,
                MixInput(
                    dialogue_url=body.dialogue_url,
                    narration_url=body.narration_url,
                    sfx_url=body.sfx_url,
                    dialogue_gain_db=body.dialogue_gain_db,
                    narration_gain_db=body.narration_gain_db,
                    sfx_gain_db=body.sfx_gain_db,
                ),
                user_id=user_id,
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc))
        except RuntimeError as exc:
            msg = str(exc)
            if "ffmpeg not found" in msg:
                raise HTTPException(status_code=503, detail="ffmpeg unavailable on server")
            raise HTTPException(status_code=500, detail=msg)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        return MixAudioResponse(
            success=result.success,
            mixed_audio_url=result.mixed_audio_url,
            cached=result.cached,
            duration_ms=result.duration_ms,
        )

    @router.post("/api/episodes/{episode_id}/storyboard-items/batch")
    async def batch_create_storyboard_items(
        episode_id: str,
        data: BatchStoryboardCreate,
        user_id: str = Depends(get_current_user),
    ):
        items = await StoryboardDAO.batch_create(episode_id, data.items, script_id=data.script_id)
        return {"success": True, "items": items}

    @router.post("/api/episodes/{episode_id}/extract-to-assets")
    async def extract_to_assets(
        episode_id: str,
        data: ExtractToAssetsRequest,
        user_id: str = Depends(get_current_user),
    ):
        from dao_episode import EpisodeDAO

        episode = await EpisodeDAO.get_episode(episode_id)
        if not episode:
            raise HTTPException(status_code=404, detail="集不存在")
        project_id = str(episode["project_id"])

        existing_assets = await AssetDAO.get_by_project(project_id, episode_id, script_id=data.script_id)
        existing_names = {(a["asset_type"], a["name"]) for a in existing_assets}

        created = []
        for char in data.characters:
            name = char.get("name", "").strip()
            if not name or ("character", name) in existing_names:
                continue
            asset = await AssetDAO.create(
                project_id=project_id,
                asset_type="character",
                name=name,
                created_by=user_id,
                episode_id=episode_id,
                description=char.get("description", ""),
                script_id=data.script_id,
            )
            if asset:
                created.append(dict(asset))
                existing_names.add(("character", name))
        for scene in data.scenes:
            name = scene.get("name", "").strip()
            if not name or ("scene", name) in existing_names:
                continue
            asset = await AssetDAO.create(
                project_id=project_id,
                asset_type="scene",
                name=name,
                created_by=user_id,
                episode_id=episode_id,
                description=scene.get("description", ""),
                script_id=data.script_id,
            )
            if asset:
                created.append(dict(asset))
                existing_names.add(("scene", name))
        return {"success": True, "assets": created}

    return router
