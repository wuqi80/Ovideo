"""Runtime video capability decisions and the frontend model manifest."""
from __future__ import annotations

import logging
from typing import Any, Dict

from services.api_provider_registry import (
    MINIMAX_DEFAULT_VIDEO_MODEL,
    MINIMAX_FAST_VIDEO_MODEL,
    MODEL_USAGE_SCOPE_WORKFLOW,
    normalize_model_usage_scope,
)
from services.api_provider_runtime import resolve_seedance_model_name
from services.cluster_node_service import list_agent_nodes

logger = logging.getLogger(__name__)


def _is_seedance_omni_model(model_name: str) -> bool:
    normalized = (model_name or "").lower()
    return "2-0" in normalized or "2.0" in normalized


async def _has_online_comfyui_agent() -> bool:
    try:
        return bool(await list_agent_nodes())
    except Exception as exc:
        logger.debug("video capability ComfyUI agent probe failed: %s", exc)
        return False


def _seedance_manifest(model_name: str, *, key: str, label: str, omni: bool) -> Dict[str, Any]:
    media_inputs = ["text", "first_frame", "last_frame"]
    task_types = ["t2v", "i2v", "first_last_frame"]
    if omni:
        media_inputs.extend(["reference_image", "reference_video", "reference_audio"])
        task_types.append("multi_reference")
    max_duration = 12 if "1.5-pro" in (model_name or "").lower() else 15
    return {
        "key": key,
        "label": label,
        "provider": "seedance",
        "model_name": model_name,
        "task_types": task_types,
        "media_inputs": media_inputs,
        "supports_original_audio": omni,
        "supports_cancel": False,
        "query_mode": "async",
        "parameter_rules": {
            "resolution": ["480p", "720p", "1080p"],
            "ratio": ["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"],
            "duration": {"type": "integer", "minimum": 2, "maximum": max_duration},
            "normalization_policy": "reject_or_explain",
        },
    }


def build_video_model_manifest(
    *,
    standard_seedance_model: str,
    fast_seedance_model: str,
    seedance_omni: bool,
    comfyui_available: bool,
    model_scope: str = MODEL_USAGE_SCOPE_WORKFLOW,
) -> Dict[str, Any]:
    """Build the versioned, secret-free capability contract consumed by the UI."""
    return {
        "manifest_version": "2026-07-18.1",
        "model_scope": model_scope,
        "models": [
            _seedance_manifest(
                standard_seedance_model,
                key="Seedance2",
                label="飞升",
                omni=seedance_omni,
            ),
            _seedance_manifest(
                fast_seedance_model,
                key="Seedance2Fast",
                label="渡劫",
                omni=seedance_omni,
            ),
            {
                "key": "MINI",
                "label": "金丹",
                "provider": "minimax",
                "model_name": MINIMAX_DEFAULT_VIDEO_MODEL,
                "model_options": [MINIMAX_DEFAULT_VIDEO_MODEL, MINIMAX_FAST_VIDEO_MODEL],
                "task_types": ["i2v", "first_last_frame"],
                "media_inputs": ["first_frame", "last_frame"],
                "supports_original_audio": False,
                "supports_cancel": False,
                "query_mode": "async",
                "parameter_rules": {
                    "prompt_optimizer": {"type": "boolean", "default": True},
                    "valid_combinations": [
                        {"duration": 6, "resolution": ["768P", "1080P"]},
                        {"duration": 10, "resolution": ["768P"]},
                    ],
                    "normalization_policy": "reject",
                },
            },
            {
                "key": "COMFYUI",
                "label": "处理集群",
                "provider": "comfyui",
                "model_name": None,
                "task_types": ["workflow"],
                "media_inputs": ["workflow_defined"],
                "requires_gpu_node": True,
                "available": comfyui_available,
                "query_mode": "queue",
                "parameter_rules": {"normalization_policy": "workflow_defined"},
            },
        ],
    }


async def get_video_capabilities(
    usage_scope: str = MODEL_USAGE_SCOPE_WORKFLOW,
) -> Dict[str, Any]:
    """Return legacy feature flags plus a versioned model capability manifest."""
    model_scope = normalize_model_usage_scope(usage_scope)
    try:
        standard_seedance_model = resolve_seedance_model_name("standard", usage_scope=model_scope)
        fast_seedance_model = resolve_seedance_model_name("fast", usage_scope=model_scope)
    except Exception as exc:
        logger.debug("video capability Seedance model probe failed: %s", exc)
        standard_seedance_model = ""
        fast_seedance_model = ""

    seedance_omni = _is_seedance_omni_model(standard_seedance_model)
    comfyui_available = await _has_online_comfyui_agent()

    return {
        "seedance_omni": seedance_omni,
        "comfyui_available": comfyui_available,
        **build_video_model_manifest(
            standard_seedance_model=standard_seedance_model,
            fast_seedance_model=fast_seedance_model,
            seedance_omni=seedance_omni,
            comfyui_available=comfyui_available,
            model_scope=model_scope,
        ),
    }
