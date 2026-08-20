"""Authenticated final-product sharing and public review endpoints."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import media_library_service
from dao_final_product_share import FinalProductShareDAO
from dao_media_library import MediaLibraryDAO


class FeedbackCreateRequest(BaseModel):
    author_name: str = Field(default="访客", max_length=40)
    content: str = Field(min_length=1, max_length=1000)
    timestamp_seconds: Optional[float] = Field(default=None, ge=0)


def create_final_product_share_router(
    *,
    get_current_user_dependency: Any,
    share_dao: Any = FinalProductShareDAO,
    media_dao: Any = MediaLibraryDAO,
) -> APIRouter:
    router = APIRouter(tags=["final-product-sharing"])
    get_current_user = get_current_user_dependency

    async def require_final(library_item_id: str) -> dict:
        item = await media_dao.get(library_item_id)
        if not item or item.get("source") != "composed_final":
            raise HTTPException(status_code=404, detail="成品不存在")
        return item

    @router.get("/api/final-products/{library_item_id}/share")
    async def get_share(
        library_item_id: str,
        user_id: str = Depends(get_current_user),
    ):
        item = await require_final(library_item_id)
        if not await media_library_service.can_view(item, user_id):
            raise HTTPException(status_code=404, detail="成品不存在")
        share = await share_dao.get_active_for_item(library_item_id)
        return {"success": True, "share": share}

    @router.post("/api/final-products/{library_item_id}/share")
    async def create_share(
        library_item_id: str,
        user_id: str = Depends(get_current_user),
    ):
        item = await require_final(library_item_id)
        if not await media_library_service.can_mutate(item, user_id):
            raise HTTPException(status_code=403, detail="无权分享该成品")
        project_id = str(item.get("project_id") or "").strip()
        if not project_id:
            raise HTTPException(status_code=400, detail="成品未关联项目，无法分享")
        share = await share_dao.create_or_get(
            library_item_id=library_item_id,
            owner_user_id=user_id,
            project_id=project_id,
            episode_id=item.get("episode_id"),
        )
        return {"success": True, "share": share}

    @router.delete("/api/final-products/{library_item_id}/share/{share_id}")
    async def deactivate_share(
        library_item_id: str,
        share_id: str,
        user_id: str = Depends(get_current_user),
    ):
        item = await require_final(library_item_id)
        if not await media_library_service.can_mutate(item, user_id):
            raise HTTPException(status_code=403, detail="无权停止分享该成品")
        if not await share_dao.deactivate(share_id, user_id):
            raise HTTPException(status_code=404, detail="分享链接不存在或已停止")
        return {"success": True}

    @router.get("/api/final-products/{library_item_id}/feedback")
    async def list_owner_feedback(
        library_item_id: str,
        user_id: str = Depends(get_current_user),
    ):
        item = await require_final(library_item_id)
        if not await media_library_service.can_view(item, user_id):
            raise HTTPException(status_code=404, detail="成品不存在")
        feedback = await share_dao.list_feedback_for_item(library_item_id)
        return {"success": True, "feedback": feedback}

    @router.get("/api/public/final-products/{share_token}")
    async def get_public_final(share_token: str):
        share = await share_dao.get_public(share_token)
        if not share:
            raise HTTPException(status_code=404, detail="分享链接不存在或已停止")
        await share_dao.increment_access(share["share_id"])
        feedback = await share_dao.list_feedback_for_share(share["share_id"], limit=50)
        return {"success": True, "final": share, "feedback": feedback}

    @router.post("/api/public/final-products/{share_token}/feedback")
    async def create_public_feedback(share_token: str, payload: FeedbackCreateRequest):
        share = await share_dao.get_public(share_token)
        if not share:
            raise HTTPException(status_code=404, detail="分享链接不存在或已停止")
        content = payload.content.strip()
        if not content:
            raise HTTPException(status_code=400, detail="请输入意见")
        duration = float(share.get("duration_seconds") or 0)
        if payload.timestamp_seconds is not None and duration > 0 and payload.timestamp_seconds > duration + 1:
            raise HTTPException(status_code=400, detail="意见时间点超出成品时长")
        feedback = await share_dao.add_feedback(
            share_id=share["share_id"],
            author_name=payload.author_name.strip() or "访客",
            content=content,
            timestamp_seconds=payload.timestamp_seconds,
        )
        return {"success": True, "feedback": feedback}

    return router


__all__ = ["FeedbackCreateRequest", "create_final_product_share_router"]
