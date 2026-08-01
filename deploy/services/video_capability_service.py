"""Runtime video capability decisions and the frontend model manifest."""
from __future__ import annotations

import logging
from typing import Any, Dict, Iterable, List, Optional, Tuple

from services.api_provider_registry import (
    DASHSCOPE_DEFAULT_MODEL_MAP,
    MINIMAX_DEFAULT_VIDEO_MODEL,
    MINIMAX_FAST_VIDEO_MODEL,
    MODEL_USAGE_SCOPE_WORKFLOW,
    SEEDANCE_AGENT_PLAN_MODEL_MAP,
    SORA2_DEFAULT_VIDEO_MODEL,
    VEO_DEFAULT_VIDEO_MODEL,
    normalize_model_usage_scope,
    seedance_access_mode as resolve_seedance_access_mode,
)
from services.api_provider_runtime import (
    resolve_dashscope_model_name,
    resolve_provider,
    resolve_seedance_model_name,
)
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


def _provider_runtime_state(
    provider: str,
    model_name: Optional[str] = None,
    *,
    usage_scope: str = MODEL_USAGE_SCOPE_WORKFLOW,
) -> Tuple[bool, str]:
    """Return whether a provider is callable plus the model name it will use."""
    try:
        config = resolve_provider(provider, model_name, usage_scope=usage_scope)
        return bool(config.has_key), str(config.model_name or model_name or "").strip()
    except Exception as exc:
        logger.debug(
            "video capability provider probe failed: provider=%s model=%s error=%s",
            provider,
            model_name,
            exc,
        )
        return False, str(model_name or "").strip()


def _resolve_dashscope_model_options(
    sub_models: Iterable[str],
    *,
    usage_scope: str,
) -> List[str]:
    out: List[str] = []
    for sub_model in sub_models:
        try:
            model_name = resolve_dashscope_model_name(sub_model, usage_scope=usage_scope)
        except Exception as exc:
            logger.debug(
                "video capability DashScope model probe failed: sub_model=%s error=%s",
                sub_model,
                exc,
            )
            model_name = DASHSCOPE_DEFAULT_MODEL_MAP.get(sub_model, "")
        if model_name and model_name not in out:
            out.append(model_name)
    return out


def _seedance_manifest(
    model_name: str,
    *,
    key: str,
    label: str,
    omni: bool,
    available: bool,
    resolutions: Optional[List[str]] = None,
) -> Dict[str, Any]:
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
        "available": available,
        "task_types": task_types,
        "media_inputs": media_inputs,
        "supports_original_audio": omni,
        "supports_cancel": False,
        "query_mode": "async",
        "parameter_rules": {
            "resolution": resolutions or ["480p", "720p", "1080p"],
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


def _fixed_api_video_manifest(
    key: str,
    label: str,
    provider: str,
    model_name: Optional[str],
    *,
    available: bool,
) -> Dict[str, Any]:
    """Describe API video models whose remaining parameters are provider-managed."""
    return {
        "key": key,
        "label": label,
        "provider": provider,
        "model_name": model_name,
        "available": available,
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
    mini_seedance_model: str,
    seedance_omni: bool,
    comfyui_available: bool,
    seedance_billing_mode: str = "standard",
    model_scope: str = MODEL_USAGE_SCOPE_WORKFLOW,
    api_availability: Optional[Dict[str, bool]] = None,
    runtime_model_names: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build the versioned, secret-free capability contract consumed by the UI."""
    availability = api_availability or {}
    runtime_models = runtime_model_names or {}

    def is_available(key: str, default: bool = True) -> bool:
        return bool(availability.get(key, default))

    def runtime_model(key: str, fallback: Optional[str] = None) -> Optional[str]:
        value = runtime_models.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, list):
            for item in value:
                candidate = str(item or "").strip()
                if candidate:
                    return candidate
        return fallback

    def runtime_options(key: str, fallback: Iterable[str] = ()) -> List[str]:
        raw = runtime_models.get(key)
        values = raw if isinstance(raw, list) else list(fallback)
        out: List[str] = []
        for item in values:
            value = str(item or "").strip()
            if value and value not in out:
                out.append(value)
        return out

    if seedance_billing_mode == "agent_plan":
        seedance_models = [
            _seedance_manifest(
                standard_seedance_model or SEEDANCE_AGENT_PLAN_MODEL_MAP["standard"],
                key="Seedance15",
                label="Seedance 1.5",
                omni=False,
                available=is_available("Seedance15"),
            )
        ]
    else:
        seedance_models = [
            _seedance_manifest(
                standard_seedance_model,
                key="Seedance2",
                label="飞升",
                omni=seedance_omni,
                available=is_available("Seedance2"),
            ),
            _seedance_manifest(
                fast_seedance_model,
                key="Seedance2Fast",
                label="渡劫",
                omni=seedance_omni,
                available=is_available("Seedance2Fast"),
            ),
            _seedance_manifest(
                mini_seedance_model,
                key="Seedance2Mini",
                label="元婴",
                omni=seedance_omni,
                available=is_available("Seedance2Mini"),
                resolutions=["480p", "720p"],
            ),
        ]

    return {
        "manifest_version": "2026-08-01.3",
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
            _fixed_api_video_manifest(
                "Veo",
                "筑基",
                "veo",
                runtime_model("Veo", VEO_DEFAULT_VIDEO_MODEL),
                available=is_available("Veo"),
            ),
            _fixed_api_video_manifest(
                "Sora2",
                "化神",
                "sora2",
                runtime_model("Sora2", SORA2_DEFAULT_VIDEO_MODEL),
                available=is_available("Sora2"),
            ),
            {
                "key": "大能",
                "label": "大能",
                "provider": "dashscope",
                "model_name": runtime_model("大能", DASHSCOPE_DEFAULT_MODEL_MAP["wan26"]),
                "available": is_available("大能"),
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
            *seedance_models,
            {
                "key": "MINI",
                "label": "金丹",
                "provider": "minimax",
                "model_name": runtime_model("MINI", MINIMAX_DEFAULT_VIDEO_MODEL),
                "model_options": runtime_options(
                    "MINI",
                    [
                        runtime_model("MINI", MINIMAX_DEFAULT_VIDEO_MODEL) or MINIMAX_DEFAULT_VIDEO_MODEL,
                        MINIMAX_FAST_VIDEO_MODEL,
                    ],
                ),
                "available": is_available("MINI"),
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
                "model_name": runtime_model("Kling"),
                "model_options": runtime_options("Kling"),
                "available": is_available("Kling"),
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
                "model_name": runtime_model("Vidu"),
                "model_options": runtime_options("Vidu"),
                "available": is_available("Vidu"),
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
                "model_name": runtime_model("HappyHorse", DASHSCOPE_DEFAULT_MODEL_MAP["happyhorse"]),
                "available": is_available("HappyHorse"),
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
        mini_seedance_model = resolve_seedance_model_name("mini", usage_scope=model_scope)
    except Exception as exc:
        logger.debug("video capability Seedance model probe failed: %s", exc)
        standard_seedance_model = ""
        fast_seedance_model = ""
        mini_seedance_model = ""

    comfyui_available = await _has_online_comfyui_agent()
    seedance_billing_mode = "standard"
    try:
        seedance_provider_config = resolve_provider(
            "seedance",
            standard_seedance_model or None,
            usage_scope=model_scope,
        )
        seedance_key_available = bool(seedance_provider_config.has_key)
        seedance_billing_mode = resolve_seedance_access_mode(seedance_provider_config.endpoint)
    except Exception as exc:
        logger.debug(
            "video capability Seedance provider probe failed: model=%s error=%s",
            standard_seedance_model,
            exc,
        )
        seedance_key_available = False

    seedance_omni = (
        seedance_billing_mode != "agent_plan"
        and _is_seedance_omni_model(standard_seedance_model)
    )
    minimax_available, minimax_model = _provider_runtime_state(
        "minimax",
        None,
        usage_scope=model_scope,
    )
    sora2_available, sora2_model = _provider_runtime_state(
        "sora2",
        None,
        usage_scope=model_scope,
    )
    veo_available, veo_model = _provider_runtime_state(
        "veo",
        None,
        usage_scope=model_scope,
    )
    dashscope_available, _dashscope_provider_model = _provider_runtime_state(
        "dashscope",
        None,
        usage_scope=model_scope,
    )

    wan26_options = _resolve_dashscope_model_options(["wan26"], usage_scope=model_scope)
    kling_options = _resolve_dashscope_model_options(["kling-standard", "kling-omni"], usage_scope=model_scope)
    vidu_options = _resolve_dashscope_model_options(
        [
            "vidu-reference-q3-mix",
            "vidu-reference-q3",
            "vidu-reference-q3-turbo",
            "vidu-reference-q2-pro",
            "vidu-reference-q2",
            "vidu-startend-q3-pro",
            "vidu-startend-q3-turbo",
            "vidu-startend-q2-pro",
            "vidu-startend-q2-turbo",
        ],
        usage_scope=model_scope,
    )
    happyhorse_options = _resolve_dashscope_model_options(["happyhorse"], usage_scope=model_scope)

    return {
        "seedance_omni": seedance_omni,
        "comfyui_available": comfyui_available,
        **build_video_model_manifest(
            standard_seedance_model=standard_seedance_model,
            fast_seedance_model=fast_seedance_model,
            mini_seedance_model=mini_seedance_model,
            seedance_omni=seedance_omni,
            seedance_billing_mode=seedance_billing_mode,
            comfyui_available=comfyui_available,
            model_scope=model_scope,
            api_availability={
                "Veo": veo_available,
                "Sora2": sora2_available,
                "大能": dashscope_available,
                "Seedance2": seedance_key_available and bool(standard_seedance_model),
                "Seedance2Fast": seedance_key_available and bool(fast_seedance_model),
                "Seedance2Mini": seedance_key_available and bool(mini_seedance_model),
                "Seedance15": seedance_key_available and bool(standard_seedance_model),
                "MINI": minimax_available,
                "Kling": dashscope_available,
                "Vidu": dashscope_available,
                "HappyHorse": dashscope_available,
            },
            runtime_model_names={
                "Veo": veo_model or VEO_DEFAULT_VIDEO_MODEL,
                "Sora2": sora2_model or SORA2_DEFAULT_VIDEO_MODEL,
                "大能": (wan26_options[0] if wan26_options else DASHSCOPE_DEFAULT_MODEL_MAP["wan26"]),
                "MINI": minimax_model or MINIMAX_DEFAULT_VIDEO_MODEL,
                "HappyHorse": (
                    happyhorse_options[0]
                    if happyhorse_options
                    else DASHSCOPE_DEFAULT_MODEL_MAP["happyhorse"]
                ),
                "Kling": kling_options,
                "Vidu": vidu_options,
            },
        ),
    }
