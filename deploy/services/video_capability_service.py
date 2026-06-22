"""Runtime video capability decisions for the frontend."""
from __future__ import annotations

import logging
from typing import Dict

from services.api_provider_runtime import resolve_seedance_model_name

logger = logging.getLogger(__name__)


def _is_seedance_omni_model(model_name: str) -> bool:
    normalized = (model_name or "").lower()
    return "2-0" in normalized or "2.0" in normalized


async def _has_online_comfyui_agent() -> bool:
    try:
        from dao_agent import AgentDAO

        online = await AgentDAO.get_online_agents()
        return bool(online)
    except Exception as exc:
        logger.debug("video capability ComfyUI agent probe failed: %s", exc)
        return False


async def get_video_capabilities() -> Dict[str, bool]:
    """Return feature flags that let the UI avoid unsupported video flows."""
    try:
        seedance_model = resolve_seedance_model_name("standard")
    except Exception as exc:
        logger.debug("video capability Seedance model probe failed: %s", exc)
        seedance_model = ""

    return {
        "seedance_omni": _is_seedance_omni_model(seedance_model),
        "comfyui_available": await _has_online_comfyui_agent(),
    }
