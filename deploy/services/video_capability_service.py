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
    provider_health_status,
    resolve_dashscope_model_name,
    resolve_provider,
    resolve_seedance_model_name,
)
from services.api_provider_health_monitor import list_cached_provider_health
from services.cluster_node_service import list_agent_instances, list_agent_nodes

logger = logging.getLogger(__name__)
MINIMAX_H3_CAPABILITY_KEY = "minimax_h3_fl2va"
MINIMAX_H3_PREFERRED_PORT = 8188
GPU2_ROUTING_NAME = "GPU2"


def _is_seedance_omni_model(model_name: str) -> bool:
    normalized = (model_name or "").lower()
    return "2-0" in normalized or "2.0" in normalized


async def _has_online_comfyui_agent() -> bool:
    try:
        return bool(await list_agent_nodes())
    except Exception as exc:
        logger.debug("video capability ComfyUI agent probe failed: %s", exc)
        return False


def _node_matches_routing_name(node: Dict[str, Any], routing_name: str) -> bool:
    requested = str(routing_name or "").strip().lower()
    return any(
        str(node.get(field) or "").strip().lower() == requested
        for field in ("routing_name", "name", "node_id", "agent_id", "id")
    )


def _node_target(node: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not node:
        return {}
    agent_id = str(node.get("agent_id") or node.get("id") or "").strip()
    node_id = str(node.get("node_id") or agent_id or node.get("id") or "").strip()
    target: Dict[str, Any] = {}
    if agent_id:
        target["preferred_agent_id"] = agent_id
    if node_id:
        target["preferred_node_id"] = node_id
    target["strict_preferred_routing"] = True
    return target


def _find_node_target(nodes: Iterable[Dict[str, Any]], routing_name: str) -> Dict[str, Any]:
    for node in nodes or []:
        if _node_matches_routing_name(node, routing_name):
            return _node_target(node)
    return {}


def _is_minimax_h3_instance(instance: Dict[str, Any]) -> bool:
    try:
        if int(instance.get("port") or 0) != MINIMAX_H3_PREFERRED_PORT:
            return False
    except (TypeError, ValueError):
        return False
    capabilities = instance.get("capabilities") or {}
    if not isinstance(capabilities, dict):
        return False
    # GPU2 keeps the baseline runtime resident and switches to H3 only after a
    # queued H3 task is claimed. Mini/Fast installation capabilities are
    # therefore valid even when the live object-info probe belongs to the
    # baseline runtime and minimax_h3_fl2va is temporarily false.
    return any(
        capabilities.get(key) is True
        for key in (
            MINIMAX_H3_CAPABILITY_KEY,
            "minimax_h3_fast",
            "minimax_h3_mini",
        )
    )


async def find_minimax_h3_agent_instance() -> Optional[Dict[str, Any]]:
    """Return the healthy agent instance that owns the local MiniMax H3 sidecar."""
    try:
        instances = await list_agent_instances()
    except Exception as exc:
        logger.debug("video capability MiniMax H3 agent probe failed: %s", exc)
        return None
    for instance in instances or []:
        if _is_minimax_h3_instance(instance):
            return instance
    return None


async def resolve_minimax_h3_agent_target() -> Dict[str, Any]:
    """Return routing fields for MiniMax H3 tasks, or an empty dict when unavailable."""
    instance = await find_minimax_h3_agent_instance()
    if not instance:
        try:
            return _minimax_h3_gpu2_fallback_target(await list_agent_nodes())
        except Exception as exc:
            logger.debug("video capability MiniMax H3 GPU2 fallback failed: %s", exc)
            return {}
    return _minimax_h3_target_from_instance(instance)


def _minimax_h3_target_from_instance(instance: Dict[str, Any]) -> Dict[str, Any]:
    """Build stable routing fields from the same capability snapshot."""
    agent_id = str(instance.get("agent_id") or instance.get("node_id") or "").strip()
    node_id = str(instance.get("node_id") or agent_id).strip()
    target: Dict[str, Any] = {
        "preferred_comfyui_port": MINIMAX_H3_PREFERRED_PORT,
        "strict_preferred_comfyui_port": True,
    }
    if agent_id:
        target["preferred_agent_id"] = agent_id
    if node_id:
        target["preferred_node_id"] = node_id
    return target


def _minimax_h3_gpu2_fallback_target(agent_nodes: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    """Keep local H3 visible while the GPU2 sidecar capability heartbeat catches up."""
    target = _find_node_target(agent_nodes, GPU2_ROUTING_NAME)
    if not target:
        return {}
    target["preferred_comfyui_port"] = MINIMAX_H3_PREFERRED_PORT
    target["strict_preferred_comfyui_port"] = True
    target["strict_preferred_routing"] = True
    return target


async def _has_minimax_h3_agent() -> bool:
    return bool(await find_minimax_h3_agent_instance())


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


def _minimax_h3_video_manifest(
    *,
    key: str = "MiniMaxH3",
    label: str = "一阶 · 节点标准模型",
    model_name: str = "MiniMax-H3 FL2VA",
    profile: str = "standard",
    available: bool,
    target: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    target = target or {}
    return {
        "key": key,
        "label": label,
        "provider": "processing_cluster",
        "model_name": model_name,
        "task_types": ["i2v", "first_last_frame"],
        "media_inputs": ["first_frame", "last_frame"],
        "supports_original_audio": False,
        "supports_generated_audio": True,
        "supports_cancel": True,
        "requires_processing_node": True,
        "preferred_agent_id": target.get("preferred_agent_id"),
        "preferred_node_id": target.get("preferred_node_id"),
        "preferred_comfyui_port": MINIMAX_H3_PREFERRED_PORT,
        "strict_preferred_routing": True,
        "available": available,
        "query_mode": "queue",
        "parameter_rules": {
            "duration": {"type": "integer", "default": 5, "minimum": 4, "maximum": 15},
            "fps": {"type": "integer", "default": 24},
            "resolution": ["low_vram_16:9"],
            "seed": {"type": "integer", "default": -1, "minimum": -1},
            "negative_prompt": {"type": "string", "default": ""},
            "h3_profile": profile,
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
    minimax_h3_available: bool = False,
    minimax_h3_fast_available: bool = False,
    minimax_h3_mini_available: bool = False,
    minimax_h3_target: Optional[Dict[str, Any]] = None,
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
                label="四阶 · 多模态标准视频模型",
                omni=seedance_omni and _is_seedance_omni_model(standard_seedance_model),
                available=is_available("Seedance2"),
            ),
            _seedance_manifest(
                fast_seedance_model,
                key="Seedance2Fast",
                label="五阶 · 多模态快速视频模型",
                omni=seedance_omni and _is_seedance_omni_model(fast_seedance_model),
                available=is_available("Seedance2Fast"),
            ),
            _seedance_manifest(
                mini_seedance_model,
                key="Seedance2Mini",
                label="六阶 · 多模态简化视频模型",
                omni=seedance_omni and _is_seedance_omni_model(mini_seedance_model),
                available=is_available("Seedance2Mini"),
                resolutions=["480p", "720p"],
            ),
        ]

    return {
        "manifest_version": "2026-08-21.1",
        "model_scope": model_scope,
        "models": [
            *[
                _minimax_h3_video_manifest(
                    key=key,
                    label=label,
                    model_name=model_name,
                    profile=profile,
                    available={
                        "standard": minimax_h3_available,
                        "fast": minimax_h3_fast_available,
                        "mini": minimax_h3_mini_available,
                    }[profile],
                    target=minimax_h3_target,
                )
                for key, label, model_name, profile in (
                    ("MiniMaxH3", "一阶 · 节点标准模型", "MiniMax-H3 FL2VA", "standard"),
                    ("MiniMaxH3Fast", "二阶 · 节点快速模型", "MiniMax-H3 FL2VA + SageAttention", "fast"),
                    ("MiniMaxH3Mini", "三阶 · 节点简化模型", "MiniMax-H3 FL2VA + Qwen3-VL-4B ClipProj", "mini"),
                )
            ],
            _fixed_api_video_manifest(
                "Veo",
                "八阶 · 高质量快速视频模型",
                "veo",
                runtime_model("Veo", VEO_DEFAULT_VIDEO_MODEL),
                available=is_available("Veo"),
            ),
            _fixed_api_video_manifest(
                "Sora2",
                "九阶 · 长镜头视频模型",
                "sora2",
                runtime_model("Sora2", SORA2_DEFAULT_VIDEO_MODEL),
                available=is_available("Sora2"),
            ),
            {
                "key": "大能",
                "label": "十阶 · 镜头叙事视频模型",
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
                "label": "七阶 · 首尾帧标准视频模型",
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
                "label": "十一阶 · 全能音画视频模型",
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
                "label": "十二阶 · 多参考视频模型",
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
                "label": "十三阶 · 角色一致性视频模型",
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

    try:
        agent_nodes = await list_agent_nodes()
    except Exception as exc:
        logger.debug("video capability ComfyUI agent probe failed: %s", exc)
        agent_nodes = []
    comfyui_available = bool(agent_nodes)
    minimax_h3_instance = await find_minimax_h3_agent_instance()
    minimax_h3_target = (
        _minimax_h3_target_from_instance(minimax_h3_instance)
        if minimax_h3_instance
        else _minimax_h3_gpu2_fallback_target(agent_nodes)
    )
    minimax_h3_available = bool(minimax_h3_target.get("preferred_agent_id"))
    minimax_h3_capabilities = (
        minimax_h3_instance.get("capabilities")
        if isinstance(minimax_h3_instance, dict)
        else {}
    ) or {}
    minimax_h3_fast_available = bool(
        minimax_h3_available and minimax_h3_capabilities.get("minimax_h3_fast") is True
    )
    minimax_h3_mini_available = bool(
        minimax_h3_available and minimax_h3_capabilities.get("minimax_h3_mini") is True
    )
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
        and any(_is_seedance_omni_model(model) for model in (
            standard_seedance_model,
            fast_seedance_model,
            mini_seedance_model,
        ))
    )
    try:
        seedance_health = await list_cached_provider_health(targets=[
            {"provider": "seedance", "model_name": standard_seedance_model or None},
            {"provider": "seedance", "model_name": fast_seedance_model or None},
            {"provider": "seedance", "model_name": mini_seedance_model or None},
        ])
    except Exception as exc:
        logger.debug("video capability Seedance health cache probe failed: %s", exc)
        seedance_health = []

    def seedance_model_available(model_name: str) -> bool:
        if not seedance_key_available or not model_name:
            return False
        return provider_health_status("seedance", seedance_health, model_name=model_name) not in {"error", "no_key"}

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
            minimax_h3_available=minimax_h3_available,
            minimax_h3_fast_available=minimax_h3_fast_available,
            minimax_h3_mini_available=minimax_h3_mini_available,
            minimax_h3_target=minimax_h3_target,
            model_scope=model_scope,
            api_availability={
                "Veo": veo_available,
                "Sora2": sora2_available,
                "大能": dashscope_available,
                "Seedance2": seedance_model_available(standard_seedance_model),
                "Seedance2Fast": seedance_model_available(fast_seedance_model),
                "Seedance2Mini": seedance_model_available(mini_seedance_model),
                "Seedance15": seedance_model_available(standard_seedance_model),
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
