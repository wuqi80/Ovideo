# -*- coding: utf-8 -*-
"""Runtime video capability flags used by the frontend."""

from fastapi import APIRouter


def create_video_capabilities_router() -> APIRouter:
    router = APIRouter()

    @router.get("/api/video/capabilities")
    async def video_capabilities():
        """Expose backend feature flags that let the UI avoid unsupported flows."""
        try:
            from services.api_provider_runtime import resolve_seedance_model_name
            std = resolve_seedance_model_name("standard")
        except Exception:
            std = ""

        comfyui_available = False
        try:
            from dao_agent import AgentDAO
            online = await AgentDAO.get_online_agents()
            comfyui_available = bool(online)
        except Exception:
            comfyui_available = False

        return {
            "seedance_omni": ("2-0" in std) or ("2.0" in std),
            "comfyui_available": comfyui_available,
        }

    return router
