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


def _workflow_video_manifest(key: str, label: str, *, available: bool) -> Dict[str, Any]:
    """Describe the parameters that the processing-cluster workflow really accepts."""
    return {
        "key": key,
        "label": label,
        "provider": "processing_cluster",
        "model_name": None,
        "task_types": ["i2v", "first_last_frame"],
        "media_inputs": ["first_frame", "last_frame"],
        "supports_original_audio": False,
        "supports_cancel": True,
        "requires_processing_node": True,
        "available": available,
        "query_mode": "queue",
        "parameter_rules": {
            "duration": {"type": "integer", "default": 5, "options": [5, 10, 15]},
            "seed": {"type": "integer", "default": -1, "minimum": -1},
            "negative_prompt": {
                "type": "string",
                "default": "nsfw, bad quality, worst quality",
            },
            "normalization_policy": "workflow_defined",
        },
    }


def _fixed_api_video_manifest(key: str, label: str, provider: str) -> Dict[str, Any]:
    """Describe API video models whose remaining parameters are provider-managed."""
    return {
        "key": key,
        "label": label,
        "provider": provider,
        "model_name": None,
        "task_types": ["i2v", "first_last_frame"],
        "media_inputs": ["first_frame", "last_frame"],
        "supports_original_audio": False,
        "supports_cancel": False,
        "query_mode": "async",
        "parameter_rules": {"normalization_policy": "provider_default"},
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
        "manifest_version": "2026-08-01.1",
        "model_scope": model_scope,
        "models": [
            *[
                _workflow_video_manifest(key, label, available=comfyui_available)
                for key, label in (
                    ("Wan2", "处理集群视频"),
                    ("一阶", "一阶"),
                    ("二阶", "二阶"),
                    ("三阶", "三阶"),
                    ("四阶", "四阶"),
                    ("五阶", "五阶"),
                    ("六阶", "六阶"),
                    ("七阶", "七阶"),
                )
            ],
            _fixed_api_video_manifest("Veo", "筑基", "veo"),
            _fixed_api_video_manifest("Sora2", "化神", "sora2"),
            {
                "key": "大能",
                "label": "大能",
                "provider": "dashscope",
                "model_name": "wan2.6-i2v",
                "task_types": ["i2v"],
                "media_inputs": ["first_frame"],
                "supports_original_audio": False,
                "supports_cancel": False,
                "query_mode": "async",
                "parameter_rules": {
                    "resolution": ["720P", "1080P"],
                    "duration": {"type": "integer", "default": 5, "options": [5, 10, 15]},
                    "shot_type": ["multi", "single"],
                    "seed": {"type": "integer", "default": -1, "minimum": -1},
                    "normalization_policy": "reject_or_explain",
                },
            },
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
                "key": "Kling",
                "label": "合体",
                "provider": "dashscope",
                "model_name": None,
                "task_types": ["t2v", "i2v", "first_last_frame", "multi_reference"],
                "media_inputs": ["first_frame", "last_frame", "reference_image"],
                "supports_original_audio": True,
                "supports_cancel": False,
                "query_mode": "async",
                "parameter_rules": {
                    "mode": ["std", "pro"],
                    "duration": {"type": "integer", "minimum": 1, "maximum": 15, "default": 5},
                    "aspect_ratio": ["16:9", "9:16", "1:1"],
                    "audio": {"type": "boolean", "default": False},
                    "watermark": {"type": "boolean", "default": False},
                    "normalization_policy": "reject_or_explain",
                },
            },
            {
                "key": "Vidu",
                "label": "大乘",
                "provider": "dashscope",
                "model_name": None,
                "task_types": ["i2v", "first_last_frame", "multi_reference"],
                "media_inputs": ["first_frame", "last_frame", "reference_image"],
                "supports_original_audio": True,
                "supports_cancel": False,
                "query_mode": "async",
                "parameter_rules": {
                    "resolution": ["540P", "720P", "1080P"],
                    "duration": {"type": "integer", "minimum": 1, "maximum": 16, "default": 5},
                    "watermark": {"type": "boolean", "default": False},
                    "normalization_policy": "reject_or_explain",
                },
            },
            {
                "key": "HappyHorse",
                "label": "炼虚",
                "provider": "dashscope",
                "model_name": None,
                "task_types": ["multi_reference"],
                "media_inputs": ["reference_image"],
                "supports_original_audio": False,
                "supports_cancel": False,
                "query_mode": "async",
                "parameter_rules": {
                    "resolution": ["720P", "1080P"],
                    "ratio": ["16:9", "9:16", "3:4", "4:3", "4:5", "5:4", "1:1", "9:21", "21:9"],
                    "duration": {"type": "integer", "minimum": 1, "maximum": 15, "default": 5},
                    "watermark": {"type": "boolean", "default": True},
                    "normalization_policy": "reject_or_explain",
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
