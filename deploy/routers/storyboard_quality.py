# -*- coding: utf-8 -*-
"""Storyboard image consistency review route."""
from __future__ import annotations

from typing import Any, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from services.storyboard_quality_service import review_storyboard_image


class StoryboardQualityReviewRequest(BaseModel):
    image_url: str
    file_id: Optional[str] = None
    generation_model: Optional[str] = None
    generation_attempt: int = 1
    prompt: str = ""
    script_segment: str = ""
    scene: str = ""
    characters: List[dict] = []
    reference_images: List[dict] = []


def create_storyboard_quality_router(
    *,
    get_current_user_dependency: Any,
    file_dao: Any,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency

    @router.post("/api/storyboard-items/{item_id}/quality-review")
    async def review_storyboard_generation(
        item_id: str,
        data: StoryboardQualityReviewRequest,
        user_id: str = Depends(get_current_user),
    ):
        review = await review_storyboard_image(
            image_url=data.image_url,
            prompt=data.prompt,
            script_segment=data.script_segment,
            characters=data.characters,
            scene=data.scene,
            reference_images=data.reference_images,
        )
        if data.file_id:
            file_record = await file_dao.get_file(data.file_id)
            if file_record and str(file_record.get("user_id") or "") == str(user_id):
                await file_dao.merge_metadata(data.file_id, {
                    "storyboard_quality_review": review,
                    "storyboard_generation_model": data.generation_model,
                    "storyboard_generation_attempt": data.generation_attempt,
                    "storyboard_item_id": item_id,
                })
        return review

    return router
