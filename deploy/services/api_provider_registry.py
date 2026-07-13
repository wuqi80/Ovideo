"""Central registry for external API provider configuration.

This module is intentionally data-only. Runtime callers should import from here
instead of duplicating provider -> environment-variable and preset-model lists.
It is the first step toward a unified API management surface.
"""
from __future__ import annotations

from copy import deepcopy
import json
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit, urlunsplit

from services.api_provider_endpoints import derive_models_health_urls
from utils.config_helpers import _config_get


PROVIDER_ENV_MAP: Dict[str, str] = {
    "gemini-text": "GEMINI_TEXT_API_KEY",
    "gemini-image": "GEMINI_IMAGE_API_KEY",
    "gemini-tts": "GEMINI_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
    "doubao": "ARK_API_KEY",
    "minimax": "MINIMAX_API_KEY",
    "sora2": "SORA2_API_KEY",
    "veo": "VEO_API_KEY",
    "dashscope": "DASHSCOPE_API_KEY",
    "seedance": "SEEDANCE_API_KEY",
    "laozhang-gpt-image": "GPT_IMAGE_API_KEY",
    "laozhang-sora2": "SORA2_GPT_IMAGE_API_KEY",
}

PROVIDER_EXTRA_ENV_MAP: Dict[str, Dict[str, str]] = {
    "minimax": {
        "group_id": "MINIMAX_GROUP_ID",
    },
}

PROVIDER_EXTRA_FIELD_CATALOG: Dict[str, List[Dict[str, Any]]] = {
    "minimax": [
        {
            "field": "group_id",
            "label": "MiniMax Group ID",
            "target": "request_template",
            "input_type": "text",
            "placeholder": "MiniMax console GroupId",
            "help": "Used by MiniMax TTS, voice design, and voice clone. Hot-reloads into MINIMAX_GROUP_ID.",
            "aliases": ["minimax_group_id"],
        }
    ],
}

VENDOR_CREDENTIAL_LINKS: Dict[str, Dict[str, str]] = {
    "deepseek": {
        "docs_url": "https://api-docs.deepseek.com/api/deepseek-api",
        "console_url": "https://platform.deepseek.com/api_keys",
    },
    "google": {
        "docs_url": "https://ai.google.dev/gemini-api/docs/api-key",
        "console_url": "https://aistudio.google.com/app/apikey",
    },
    "volcengine": {
        "docs_url": "https://www.volcengine.com/docs/82379/1399008",
        "console_url": "https://console.volcengine.com/ark",
    },
    "alibaba": {
        "docs_url": "https://www.alibabacloud.com/help/en/model-studio/first-api-call-to-qwen",
        "console_url": "https://bailian.console.aliyun.com/",
    },
    "minimax": {
        "docs_url": "https://platform.minimax.io/docs/guides/quickstart-preparation",
        "console_url": "https://platform.minimax.io/",
    },
    "laozhang": {
        "docs_url": "https://docs.laozhang.ai/en/getting-started",
        "console_url": "https://api.laozhang.ai/",
    },
}

PROVIDER_KEY_HELP: Dict[str, str] = {
    "deepseek": "Create a DeepSeek platform API key and paste it as DEEPSEEK_API_KEY.",
    "gemini-text": "Create a Google AI Studio API key and paste it as GEMINI_TEXT_API_KEY.",
    "gemini-image": "Create a Google AI Studio API key and paste it as GEMINI_IMAGE_API_KEY.",
    "gemini-tts": "Create a Google AI Studio API key and paste it as GEMINI_API_KEY.",
    "doubao": "Create a Volcengine Ark API key and paste it as ARK_API_KEY.",
    "seedance": (
        "Create a Volcengine Ark pay-as-you-go or Agent Plan API key, select the matching "
        "Seedance channel, and paste it as SEEDANCE_API_KEY; ARK_API_KEY remains a fallback."
    ),
    "dashscope": "Create an Alibaba Cloud Model Studio / DashScope API key and paste it as DASHSCOPE_API_KEY.",
    "minimax": "Create a MiniMax API key and paste it as MINIMAX_API_KEY. Group ID is configured separately when needed.",
    "sora2": "Create a LaoZhang API token and paste it as SORA2_API_KEY.",
    "veo": "Create a LaoZhang API token and paste it as VEO_API_KEY; SORA2_API_KEY remains a fallback.",
    "laozhang-gpt-image": "Create a LaoZhang API token and paste it as GPT_IMAGE_API_KEY.",
    "laozhang-sora2": "Create a LaoZhang API token and paste it as SORA2_GPT_IMAGE_API_KEY.",
}


DOUBAO_IMAGE_DEFAULT_MODEL = "doubao-seedream-4-0-250828"
DOUBAO_IMAGE_PAYG_MODEL = "doubao-seedream-5-0-pro-260628"
DOUBAO_IMAGE_AGENT_PLAN_MODEL = "doubao-seedream-5-0-lite-260128"
DOUBAO_IMAGE_MODEL_ALIASES: Dict[str, str] = {
    "doubao-seedream-5.0-pro": "doubao-seedream-5-0-pro-260628",
    "doubao-seedream-5-0-pro": "doubao-seedream-5-0-pro-260628",
    "doubao-seedream-5-0-pro-260628": "doubao-seedream-5-0-pro-260628",
    "seedream-5.0-pro": "doubao-seedream-5-0-pro-260628",
    "seedream-5-0-pro": "doubao-seedream-5-0-pro-260628",
    "doubao-seedream-5.0": DOUBAO_IMAGE_AGENT_PLAN_MODEL,
    "doubao-seedream-5-0": DOUBAO_IMAGE_AGENT_PLAN_MODEL,
    "doubao-seedream-5-0-260128": DOUBAO_IMAGE_AGENT_PLAN_MODEL,
    "seedream-5.0": DOUBAO_IMAGE_AGENT_PLAN_MODEL,
    "seedream-5-0": DOUBAO_IMAGE_AGENT_PLAN_MODEL,
    "seedream-5-0-260128": DOUBAO_IMAGE_AGENT_PLAN_MODEL,
    "doubao-seedream-4.0": DOUBAO_IMAGE_DEFAULT_MODEL,
    "doubao-seedream-4-0": DOUBAO_IMAGE_DEFAULT_MODEL,
    "doubao-seedream-4-0-250828": DOUBAO_IMAGE_DEFAULT_MODEL,
    "seedream-4.0": DOUBAO_IMAGE_DEFAULT_MODEL,
    "seedream-4-0": DOUBAO_IMAGE_DEFAULT_MODEL,
    "doubao-seedream-5.0-lite": DOUBAO_IMAGE_AGENT_PLAN_MODEL,
    "doubao-seedream-5-0-lite": DOUBAO_IMAGE_AGENT_PLAN_MODEL,
    "doubao-seedream-5-0-lite-260128": DOUBAO_IMAGE_AGENT_PLAN_MODEL,
    "seedream-5.0-lite": DOUBAO_IMAGE_AGENT_PLAN_MODEL,
    "seedream-5-0-lite": DOUBAO_IMAGE_AGENT_PLAN_MODEL,
    "seedream-5-0-lite-260128": DOUBAO_IMAGE_AGENT_PLAN_MODEL,
}

DOUBAO_IMAGE_STANDARD_ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/images/generations"
DOUBAO_IMAGE_AGENT_PLAN_ENDPOINT = "https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks"
DOUBAO_IMAGE_MODEL_BINDING_OPTIONS: List[Dict[str, str]] = [
    {
        "operation": "generate",
        "label": "筑基境界",
        "model_name": DOUBAO_IMAGE_PAYG_MODEL,
    },
]
DOUBAO_IMAGE_ACCESS_MODES: List[Dict[str, Any]] = [
    {
        "mode": "standard",
        "label": "按量付费",
        "endpoint": DOUBAO_IMAGE_STANDARD_ENDPOINT,
        "console_url": "https://console.volcengine.com/ark/region:ark+cn-beijing/apikey",
        "model_map": {"generate": DOUBAO_IMAGE_PAYG_MODEL},
    },
    {
        "mode": "agent_plan",
        "label": "Agent Plan",
        "endpoint": DOUBAO_IMAGE_AGENT_PLAN_ENDPOINT,
        "console_url": "https://console.volcengine.com/ark/region:cn-beijing/subscription/agent-plan",
        "model_map": {"generate": DOUBAO_IMAGE_AGENT_PLAN_MODEL},
    },
]


SEEDANCE_DEFAULT_MODEL_MAP: Dict[str, str] = {
    "standard": "doubao-seedance-2-0-260128",
    "fast": "doubao-seedance-2-0-fast-260128",
}

SEEDANCE_AGENT_PLAN_MODEL_MAP: Dict[str, str] = {
    "standard": "doubao-seedance-1.5-pro",
    "fast": "doubao-seedance-1.5-pro",
}
SEEDANCE_LEGACY_AGENT_PLAN_MODELS = frozenset(
    {"doubao-seedance-2.0", "doubao-seedance-2.0-fast"}
)

SEEDANCE_STANDARD_ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks"
SEEDANCE_AGENT_PLAN_ENDPOINT = "https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks"

SEEDANCE_ACCESS_MODES: List[Dict[str, Any]] = [
    {
        "mode": "standard",
        "label": "按量付费",
        "endpoint": SEEDANCE_STANDARD_ENDPOINT,
        "console_url": "https://console.volcengine.com/ark/region:ark+cn-beijing/apikey",
        "model_map": deepcopy(SEEDANCE_DEFAULT_MODEL_MAP),
    },
    {
        "mode": "agent_plan",
        "label": "Agent Plan",
        "endpoint": SEEDANCE_AGENT_PLAN_ENDPOINT,
        "console_url": "https://console.volcengine.com/ark/region:cn-beijing/subscription/agent-plan",
        "model_map": deepcopy(SEEDANCE_AGENT_PLAN_MODEL_MAP),
    },
]

SEEDANCE_SUB_MODEL_ENV_MAP: Dict[str, str] = {
    "standard": "SEEDANCE_MODEL_STANDARD",
    "fast": "SEEDANCE_MODEL_FAST",
}

ARK_OFFICIAL_HOST = "ark.cn-beijing.volces.com"

MINIMAX_DEFAULT_VIDEO_MODEL = "MiniMax-Hailuo-2.3"
MINIMAX_DEFAULT_PROVIDER_MODEL = MINIMAX_DEFAULT_VIDEO_MODEL
MINIMAX_FAST_VIDEO_MODEL = "MiniMax-Hailuo-2.3-Fast"
MINIMAX_LEGACY_VIDEO_MODELS = frozenset({"MiniMax-Hailuo-02"})
MINIMAX_TTS_HD_MODEL = "speech-2.8-hd"
MINIMAX_TTS_TURBO_MODEL = "speech-2.8-turbo"
MINIMAX_DOMESTIC_ENDPOINT = "https://api.minimaxi.com/v1"
MINIMAX_INTERNATIONAL_ENDPOINT = "https://api.minimax.io/v1"
MINIMAX_ACCESS_MODES: List[Dict[str, Any]] = [
    {
        "mode": "domestic",
        "label": "国内站",
        "endpoint": MINIMAX_DOMESTIC_ENDPOINT,
        "console_url": "https://platform.minimaxi.com/",
        "docs_url": "https://platform.minimaxi.com/document/",
        "description": "使用 MiniMax 国内站创建的 API Key。",
    },
    {
        "mode": "international",
        "label": "国际站",
        "endpoint": MINIMAX_INTERNATIONAL_ENDPOINT,
        "console_url": "https://platform.minimax.io/",
        "docs_url": "https://platform.minimax.io/docs/guides/quickstart-preparation",
        "description": "使用 MiniMax 国际站创建的 API Key；国际 Key 不能用于国内 Endpoint。",
    },
]
GEMINI_TTS_DEFAULT_MODEL = "gemini-3.1-flash-tts-preview"
SORA2_DEFAULT_VIDEO_MODEL = "sora_video2-landscape-15s"
SORA2_LEGACY_VIDEO_MODELS = frozenset({"sora-2"})
VEO_DEFAULT_VIDEO_MODEL = "veo-3.1-landscape-fast-fl"
VEO_LEGACY_VIDEO_MODELS = frozenset({"veo-3", "veo-3.1"})

DASHSCOPE_DEFAULT_MODEL_MAP: Dict[str, str] = {
    "wan26": "wan2.6-i2v",
    "kling-standard": "kling/kling-v3-video-generation",
    "kling-omni": "kling/kling-v3-omni-video-generation",
    "vidu-reference-q3-mix": "vidu/viduq3-mix_reference2video",
    "vidu-reference-q3": "vidu/viduq3_reference2video",
    "vidu-reference-q3-turbo": "vidu/viduq3-turbo_reference2video",
    "vidu-reference-q2-pro": "vidu/viduq2-pro_reference2video",
    "vidu-reference-q2": "vidu/viduq2_reference2video",
    "vidu-startend-q3-pro": "vidu/viduq3-pro_start-end2video",
    "vidu-startend-q3-turbo": "vidu/viduq3-turbo_start-end2video",
    "vidu-startend-q2-pro": "vidu/viduq2-pro_start-end2video",
    "vidu-startend-q2-turbo": "vidu/viduq2-turbo_start-end2video",
    "happyhorse": "happyhorse-1.0-r2v",
}

DASHSCOPE_VIDU_REFERENCE_SUB_MODEL_MAP: Dict[str, str] = {
    "q3-mix": "vidu-reference-q3-mix",
    "q3": "vidu-reference-q3",
    "q3-turbo": "vidu-reference-q3-turbo",
    "q2-pro": "vidu-reference-q2-pro",
    "q2": "vidu-reference-q2",
}

DASHSCOPE_VIDU_STARTEND_SUB_MODEL_MAP: Dict[str, str] = {
    "q3-pro": "vidu-startend-q3-pro",
    "q3-turbo": "vidu-startend-q3-turbo",
    "q2-pro": "vidu-startend-q2-pro",
    "q2-turbo": "vidu-startend-q2-turbo",
}

DASHSCOPE_SUB_MODEL_ENV_MAP: Dict[str, str] = {
    "wan26": "DASHSCOPE_MODEL_WAN26",
    "kling-standard": "DASHSCOPE_MODEL_KLING_STANDARD",
    "kling-omni": "DASHSCOPE_MODEL_KLING_OMNI",
    "vidu-reference-q3-mix": "DASHSCOPE_MODEL_VIDU_REFERENCE_Q3_MIX",
    "vidu-reference-q3": "DASHSCOPE_MODEL_VIDU_REFERENCE_Q3",
    "vidu-reference-q3-turbo": "DASHSCOPE_MODEL_VIDU_REFERENCE_Q3_TURBO",
    "vidu-reference-q2-pro": "DASHSCOPE_MODEL_VIDU_REFERENCE_Q2_PRO",
    "vidu-reference-q2": "DASHSCOPE_MODEL_VIDU_REFERENCE_Q2",
    "vidu-startend-q3-pro": "DASHSCOPE_MODEL_VIDU_STARTEND_Q3_PRO",
    "vidu-startend-q3-turbo": "DASHSCOPE_MODEL_VIDU_STARTEND_Q3_TURBO",
    "vidu-startend-q2-pro": "DASHSCOPE_MODEL_VIDU_STARTEND_Q2_PRO",
    "vidu-startend-q2-turbo": "DASHSCOPE_MODEL_VIDU_STARTEND_Q2_TURBO",
    "happyhorse": "DASHSCOPE_MODEL_HAPPYHORSE",
}

SEEDANCE_MODEL_BINDING_OPTIONS: List[Dict[str, str]] = [
    {
        "operation": "standard",
        "label": "飞升 (Seedance 2.0)",
        "model_name": SEEDANCE_DEFAULT_MODEL_MAP["standard"],
    },
    {
        "operation": "fast",
        "label": "渡劫 (Seedance 2.0 Fast)",
        "model_name": SEEDANCE_DEFAULT_MODEL_MAP["fast"],
    },
]

DASHSCOPE_MODEL_BINDING_LABELS: Dict[str, str] = {
    "wan26": "大能 (Wan2.6)",
    "kling-standard": "合体 (Kling Standard)",
    "kling-omni": "合体 (Kling Omni)",
    "vidu-reference-q3-mix": "大乘 (Vidu Q3 Mix 参考生视频)",
    "vidu-reference-q3": "大乘 (Vidu Q3 参考生视频)",
    "vidu-reference-q3-turbo": "大乘 (Vidu Q3 Turbo 参考生视频)",
    "vidu-reference-q2-pro": "大乘 (Vidu Q2 Pro 参考生视频)",
    "vidu-reference-q2": "大乘 (Vidu Q2 参考生视频)",
    "vidu-startend-q3-pro": "大乘 (Vidu Q3 Pro 首尾帧)",
    "vidu-startend-q3-turbo": "大乘 (Vidu Q3 Turbo 首尾帧)",
    "vidu-startend-q2-pro": "大乘 (Vidu Q2 Pro 首尾帧)",
    "vidu-startend-q2-turbo": "大乘 (Vidu Q2 Turbo 首尾帧)",
    "happyhorse": "炼虚 (HappyHorse)",
}

DASHSCOPE_MODEL_BINDING_OPTIONS: List[Dict[str, str]] = [
    {
        "operation": operation,
        "label": DASHSCOPE_MODEL_BINDING_LABELS[operation],
        "model_name": model_name,
    }
    for operation, model_name in DASHSCOPE_DEFAULT_MODEL_MAP.items()
]

MINIMAX_MODEL_BINDING_OPTIONS: List[Dict[str, str]] = [
    {
        "operation": "video-standard",
        "label": "金丹 (Hailuo 2.3)",
        "model_name": MINIMAX_DEFAULT_VIDEO_MODEL,
    },
    {
        "operation": "video-fast",
        "label": "金丹 Fast (Hailuo 2.3 Fast)",
        "model_name": MINIMAX_FAST_VIDEO_MODEL,
    },
    {
        "operation": "speech-hd",
        "label": "语音生成 (Speech 2.8 HD)",
        "model_name": MINIMAX_TTS_HD_MODEL,
    },
    {
        "operation": "speech-turbo",
        "label": "语音生成 (Speech 2.8 Turbo)",
        "model_name": MINIMAX_TTS_TURBO_MODEL,
    },
]


def normalize_seedance_sub_model(sub_model: Optional[str]) -> str:
    normalized = (sub_model or "standard").strip().lower()
    if normalized not in SEEDANCE_SUB_MODEL_ENV_MAP:
        raise ValueError(f"Unsupported Seedance sub_model: {sub_model}")
    return normalized


def get_seedance_sub_model_env_key(sub_model: Optional[str]) -> str:
    return SEEDANCE_SUB_MODEL_ENV_MAP[normalize_seedance_sub_model(sub_model)]


def is_seedance_fast_model(model_name: Optional[str]) -> bool:
    return "fast" in (model_name or "").strip().lower()


def doubao_image_access_mode(endpoint: Optional[str]) -> str:
    """Identify the Ark billing surface from a Doubao image endpoint."""
    value = _with_default_https_for_host(str(endpoint or "").strip(), ARK_OFFICIAL_HOST)
    try:
        path = urlsplit(value).path.rstrip("/").lower()
    except ValueError:
        path = value.rstrip("/").lower()
    return "agent_plan" if path == "/api/plan" or path.startswith("/api/plan/") else "standard"


def _with_default_https_for_host(value: str, host: str) -> str:
    """Allow admins to paste official API hosts without the URL scheme."""
    trimmed = (value or "").strip()
    if "://" in trimmed:
        return trimmed
    normalized = trimmed.lower()
    if normalized == host or normalized.startswith(f"{host}/"):
        return f"https://{trimmed}"
    return trimmed


def normalize_doubao_image_endpoint(endpoint: Optional[str]) -> str:
    """Expand official Ark base URLs to the matching image-generation endpoint."""
    value = _with_default_https_for_host(str(endpoint or "").strip(), ARK_OFFICIAL_HOST).rstrip("/")
    if not value:
        return value
    try:
        parsed = urlsplit(value)
    except ValueError:
        return value
    if parsed.netloc.lower() != "ark.cn-beijing.volces.com":
        return value

    path = parsed.path.rstrip("/").lower()
    if path in {"/api/plan", "/api/plan/v3"}:
        target_path = "/api/plan/v3/contents/generations/tasks"
    elif path in {"/api", "/api/v3"}:
        target_path = "/api/v3/images/generations"
    elif path in {
        "/api/plan/v3/contents/generations/tasks",
        "/api/plan/v3/images/generations",
        "/api/v3/images/generations",
    }:
        target_path = "/api/plan/v3/contents/generations/tasks" if path.startswith("/api/plan/") else parsed.path.rstrip("/")
    else:
        return value
    return urlunsplit((parsed.scheme or "https", parsed.netloc, target_path, "", ""))


def normalize_doubao_image_model_for_endpoint(
    model_name: Optional[str],
    endpoint: Optional[str],
) -> str:
    """Use the Agent Plan Seedream model while preserving pay-as-you-go choices."""
    value = normalize_doubao_image_model(model_name) or ""
    if doubao_image_access_mode(endpoint) == "agent_plan":
        known_models = {
            DOUBAO_IMAGE_DEFAULT_MODEL.lower(),
            DOUBAO_IMAGE_PAYG_MODEL.lower(),
            DOUBAO_IMAGE_AGENT_PLAN_MODEL.lower(),
            *(item.lower() for item in DOUBAO_IMAGE_MODEL_ALIASES.values()),
        }
        if not value or value.lower() in known_models:
            return DOUBAO_IMAGE_AGENT_PLAN_MODEL
    elif value.lower() == DOUBAO_IMAGE_AGENT_PLAN_MODEL.lower():
        return DOUBAO_IMAGE_PAYG_MODEL
    return value or DOUBAO_IMAGE_DEFAULT_MODEL


def seedance_access_mode(endpoint: Optional[str]) -> str:
    """Identify the Ark billing surface from a Seedance endpoint."""
    value = _with_default_https_for_host(str(endpoint or "").strip(), ARK_OFFICIAL_HOST)
    try:
        path = urlsplit(value).path.rstrip("/").lower()
    except ValueError:
        path = value.rstrip("/").lower()
    return "agent_plan" if path == "/api/plan" or path.startswith("/api/plan/") else "standard"


def normalize_seedance_endpoint(endpoint: Optional[str]) -> str:
    """Expand Ark base URLs to the native Seedance task endpoint.

    Custom gateways are intentionally left untouched. Only the official Ark
    host is normalized so an admin can still configure a compatible proxy.
    """
    value = _with_default_https_for_host(str(endpoint or "").strip(), ARK_OFFICIAL_HOST).rstrip("/")
    if not value:
        return value
    try:
        parsed = urlsplit(value)
    except ValueError:
        return value
    if parsed.netloc.lower() != "ark.cn-beijing.volces.com":
        return value

    path = parsed.path.rstrip("/").lower()
    if path in {"/api/plan", "/api/plan/v3"}:
        target_path = "/api/plan/v3/contents/generations/tasks"
    elif path in {"/api", "/api/v3"}:
        target_path = "/api/v3/contents/generations/tasks"
    elif path in {
        "/api/plan/v3/contents/generations/tasks",
        "/api/v3/contents/generations/tasks",
    }:
        target_path = parsed.path.rstrip("/")
    else:
        return value
    return urlunsplit((parsed.scheme or "https", parsed.netloc, target_path, "", ""))


def seedance_model_map_for_endpoint(endpoint: Optional[str]) -> Dict[str, str]:
    if seedance_access_mode(endpoint) == "agent_plan":
        return SEEDANCE_AGENT_PLAN_MODEL_MAP
    return SEEDANCE_DEFAULT_MODEL_MAP


def normalize_seedance_model_for_endpoint(
    model_name: Optional[str],
    endpoint: Optional[str],
    sub_model: Optional[str] = None,
) -> str:
    """Translate built-in Seedance model IDs between pay-as-you-go and Plan."""
    value = str(model_name or "").strip()
    operation = normalize_seedance_sub_model(
        sub_model or ("fast" if is_seedance_fast_model(value) else "standard")
    )
    known_models = {
        item.lower()
        for model_map in (SEEDANCE_DEFAULT_MODEL_MAP, SEEDANCE_AGENT_PLAN_MODEL_MAP)
        for item in model_map.values()
    }
    known_models.update(item.lower() for item in SEEDANCE_LEGACY_AGENT_PLAN_MODELS)
    if not value or value.lower() in known_models:
        return seedance_model_map_for_endpoint(endpoint)[operation]
    return value


def normalize_dashscope_sub_model(sub_model: Optional[str]) -> str:
    normalized = (sub_model or "wan26").strip().lower()
    if normalized not in DASHSCOPE_SUB_MODEL_ENV_MAP:
        raise ValueError(f"Unsupported DashScope sub_model: {sub_model}")
    return normalized


def get_dashscope_sub_model_env_key(sub_model: Optional[str]) -> str:
    return DASHSCOPE_SUB_MODEL_ENV_MAP[normalize_dashscope_sub_model(sub_model)]


def dashscope_vidu_reference_sub_model(value: Optional[str]) -> str:
    variant = (value or "q3").strip().lower()
    return DASHSCOPE_VIDU_REFERENCE_SUB_MODEL_MAP.get(variant, "vidu-reference-q3")


def dashscope_vidu_startend_sub_model(value: Optional[str]) -> str:
    variant = (value or "q3-turbo").strip().lower()
    return DASHSCOPE_VIDU_STARTEND_SUB_MODEL_MAP.get(variant, "vidu-startend-q3-turbo")


def is_dashscope_wan26_model(model_name: Optional[str]) -> bool:
    return (model_name or "").strip().lower().startswith("wan2.6")


def is_dashscope_kling_standard_model(model_name: Optional[str]) -> bool:
    normalized = (model_name or "").strip().lower()
    return "kling-v3-video-generation" in normalized and "omni" not in normalized


def is_dashscope_kling_omni_model(model_name: Optional[str]) -> bool:
    return "kling-v3-omni-video-generation" in (model_name or "").strip().lower()


def dashscope_model_matches_sub_model(sub_model: str, model_name: Optional[str]) -> bool:
    normalized_sub_model = normalize_dashscope_sub_model(sub_model)
    normalized_model = (model_name or "").strip().lower()
    default_model = DASHSCOPE_DEFAULT_MODEL_MAP.get(normalized_sub_model, "").lower()
    if normalized_model and normalized_model == default_model:
        return True
    if normalized_sub_model == "wan26":
        return is_dashscope_wan26_model(model_name)
    if normalized_sub_model == "kling-standard":
        return is_dashscope_kling_standard_model(model_name)
    if normalized_sub_model == "kling-omni":
        return is_dashscope_kling_omni_model(model_name)
    return False


def dashscope_sub_model_for_model(model_name: Optional[str]) -> Optional[str]:
    normalized_model = (model_name or "").strip().lower()
    if not normalized_model:
        return None
    for sub_model, default_model in DASHSCOPE_DEFAULT_MODEL_MAP.items():
        if normalized_model == default_model.lower():
            return sub_model
    if is_dashscope_wan26_model(model_name):
        return "wan26"
    if is_dashscope_kling_omni_model(model_name):
        return "kling-omni"
    if is_dashscope_kling_standard_model(model_name):
        return "kling-standard"
    return None


DEFAULT_PROVIDER_PROXY_MODE = "direct"
DEFAULT_PROVIDER_SUPPORTS_PROXY = True
DEFAULT_PROVIDER_FALLBACK_ENV: List[str] = []

PROVIDER_FALLBACK_ENV_OVERRIDES: Dict[str, List[str]] = {
    "seedance": ["ARK_API_KEY"],
    "veo": ["SORA2_API_KEY"],
}


PROVIDER_CATALOG: Dict[str, dict] = {
    "deepseek": {
        "label": "DeepSeek",
        "vendor": "deepseek",
        "capabilities": ["text"],
        "notes": "Text/chat provider used by script and reasoning flows.",
    },
    "gemini-text": {
        "label": "Gemini Text",
        "vendor": "google",
        "capabilities": ["text"],
        "fallback": [
            {
                "provider": "deepseek",
                "model_name": "deepseek-reasoner",
                "when": ["missing_key", "health_error"],
            }
        ],
        "notes": "Google Gemini text generation.",
    },
    "gemini-image": {
        "label": "Gemini Image",
        "vendor": "google",
        "capabilities": ["image"],
        "notes": "Google Gemini image generation.",
    },
    "gemini-tts": {
        "label": "Gemini TTS",
        "vendor": "google",
        "capabilities": ["audio"],
        "notes": "Fallback TTS provider.",
    },
    "doubao": {
        "label": "Volcengine Ark / Doubao",
        "vendor": "volcengine",
        "capabilities": ["image"],
        "notes": "Ark-compatible image generation provider, including Agent Plan.",
        "access_modes": DOUBAO_IMAGE_ACCESS_MODES,
    },
    "seedance": {
        "label": "Seedance 2.0",
        "vendor": "volcengine",
        "capabilities": ["video"],
        "notes": "Volcengine Ark Seedance video generation, including Agent Plan.",
        "access_modes": SEEDANCE_ACCESS_MODES,
    },
    "dashscope": {
        "label": "DashScope / Model Studio",
        "vendor": "alibaba",
        "capabilities": ["video"],
        "notes": "Wan2.6, Kling, Vidu, and HappyHorse share this key.",
    },
    "minimax": {
        "label": "MiniMax / Hailuo",
        "vendor": "minimax",
        "capabilities": ["video", "audio"],
        "notes": "Video generation plus TTS, voice design, and voice clone.",
        "access_modes": MINIMAX_ACCESS_MODES,
    },
    "sora2": {
        "label": "Sora2 Gateway",
        "vendor": "laozhang",
        "capabilities": ["video"],
        "notes": "Laozhang Sora2-compatible video gateway.",
    },
    "veo": {
        "label": "Veo Gateway",
        "vendor": "laozhang",
        "capabilities": ["video"],
        "notes": "Laozhang Veo-compatible video gateway.",
    },
    "laozhang-gpt-image": {
        "label": "GPT Image VIP Gateway",
        "vendor": "laozhang",
        "capabilities": ["image"],
        "notes": "Default/VIP GPT Image token group.",
    },
    "laozhang-sora2": {
        "label": "GPT Image Official Gateway",
        "vendor": "laozhang",
        "capabilities": ["image"],
        "notes": "Official GPT Image token group.",
    },
}


DEFAULT_PROVIDER_HEALTH_CHECK: Dict[str, Any] = {
    "method": "GET",
    "path": "/models",
    "billable": False,
}

PROVIDER_HEALTH_CHECK_OVERRIDES: Dict[str, Dict[str, Any]] = {
    "dashscope": {
        "path": "/compatible-mode/v1/models",
    },
}

for _provider_id, _provider_meta in PROVIDER_CATALOG.items():
    _provider_meta.setdefault("required_env", [PROVIDER_ENV_MAP[_provider_id]])
    _provider_meta.setdefault(
        "fallback_env",
        list(PROVIDER_FALLBACK_ENV_OVERRIDES.get(_provider_id, DEFAULT_PROVIDER_FALLBACK_ENV)),
    )
    _provider_meta.setdefault("default_proxy_mode", DEFAULT_PROVIDER_PROXY_MODE)
    _provider_meta.setdefault("supports_proxy", DEFAULT_PROVIDER_SUPPORTS_PROXY)
    _health_check = deepcopy(DEFAULT_PROVIDER_HEALTH_CHECK)
    _health_check.update(PROVIDER_HEALTH_CHECK_OVERRIDES.get(_provider_id, {}))
    _provider_meta.setdefault("health_check", _health_check)
    _credential_links = deepcopy(VENDOR_CREDENTIAL_LINKS.get(_provider_meta.get("vendor", ""), {}))
    if _provider_id in PROVIDER_KEY_HELP:
        _credential_links["key_help"] = PROVIDER_KEY_HELP[_provider_id]
    for _link_key, _link_value in _credential_links.items():
        _provider_meta.setdefault(_link_key, _link_value)


PROVIDER_DEFAULT_ENDPOINTS: Dict[str, str] = {
    "gemini-text": "https://api.laozhang.ai/v1",
    "deepseek": "https://api.deepseek.com",
    "gemini-image": "https://api.laozhang.ai/v1beta",
    "doubao": DOUBAO_IMAGE_STANDARD_ENDPOINT,
    "minimax": MINIMAX_DOMESTIC_ENDPOINT,
    "sora2": "https://api.laozhang.ai/v1",
    "veo": "https://api.laozhang.ai/v1",
    "dashscope": "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
    "seedance": SEEDANCE_STANDARD_ENDPOINT,
    "laozhang-gpt-image": "https://api.laozhang.ai/v1",
    "laozhang-sora2": "https://api.laozhang.ai/v1",
    "gemini-tts": "https://generativelanguage.googleapis.com/v1beta",
}

PROVIDER_API_PATHS: Dict[str, Dict[str, str]] = {
    "deepseek": {
        "chat_completions": "chat/completions",
    },
    "gemini-text": {
        "chat_completions": "chat/completions",
    },
    "gemini-image": {
        "generate_content": "models/{model}:generateContent",
    },
    "gemini-tts": {
        "interactions": "interactions",
        "models": "models",
    },
    "doubao": {
        "image_generations": "images/generations",
        "content_generation_tasks": "contents/generations/tasks",
        "task": "{task_id}",
    },
    "minimax": {
        "video_generation": "video_generation",
        "query_video_generation": "query/video_generation",
        "files_retrieve": "files/retrieve",
        "files_upload": "files/upload",
        "files_delete": "files/delete",
        "voice_design": "voice_design",
        "voice_clone": "voice_clone",
        "get_voice": "get_voice",
        "delete_voice": "delete_voice",
        "tts_sync": "t2a_v2",
        "tts_async": "t2a_async_v2",
        "tts_query": "query/t2a_async_query_v2",
        "music_generation": "music_generation",
        "lyrics_generation": "lyrics_generation",
    },
    "sora2": {
        "videos": "videos",
        "video": "videos/{video_id}",
        "video_content": "videos/{video_id}/content",
    },
    "veo": {
        "chat_completions": "chat/completions",
        "video": "videos/{video_id}",
        "video_content": "videos/{video_id}/content",
    },
    "seedance": {
        "task": "{task_id}",
    },
    "laozhang-gpt-image": {
        "image_edits": "images/edits",
        "image_generations": "images/generations",
    },
    "laozhang-sora2": {
        "image_edits": "images/edits",
        "image_generations": "images/generations",
    },
}


API_MODEL_PRESETS: List[dict] = [
    {
        "name": "Gemini 2.5 Flash (文本)",
        "provider": "gemini-text",
        "model_name": "gemini-2.5-flash",
    },
    {
        "name": "DeepSeek Reasoner",
        "provider": "deepseek",
        "model_name": "deepseek-reasoner",
    },
    {
        "name": "化神1阶（快速）",
        "provider": "gemini-image",
        "operation": "gemini-2.5-flash-image",
        "operation_label": "化神1阶（快速）",
        "model_name": "gemini-2.5-flash-image",
    },
    {
        "name": "化神2阶（高质量）",
        "provider": "gemini-image",
        "operation": "gemini-3-pro-image-preview",
        "operation_label": "化神2阶（高质量）",
        "model_name": "gemini-3.1-flash-image-preview",
    },
    {
        "name": "筑基境界",
        "provider": "doubao",
        "model_name": DOUBAO_IMAGE_DEFAULT_MODEL,
    },
    {
        "name": "Doubao SeedDream 5.0 Pro",
        "provider": "doubao",
        "model_name": "doubao-seedream-5-0-pro-260628",
    },
    {
        "name": "MiniMax Hailuo 2.3",
        "provider": "minimax",
        "model_name": MINIMAX_DEFAULT_VIDEO_MODEL,
        "operation": "video-standard",
        "operation_label": "金丹 (Hailuo 2.3)",
        "category": "video",
    },
    {
        "name": "MiniMax Hailuo 2.3 Fast",
        "provider": "minimax",
        "model_name": MINIMAX_FAST_VIDEO_MODEL,
        "operation": "video-fast",
        "operation_label": "金丹 Fast (Hailuo 2.3 Fast)",
        "category": "video",
    },
    {
        "name": "MiniMax Speech 2.8 HD",
        "provider": "minimax",
        "model_name": MINIMAX_TTS_HD_MODEL,
        "operation": "speech-hd",
        "operation_label": "语音生成 (Speech 2.8 HD)",
        "category": "audio",
    },
    {
        "name": "MiniMax Speech 2.8 Turbo",
        "provider": "minimax",
        "model_name": MINIMAX_TTS_TURBO_MODEL,
        "operation": "speech-turbo",
        "operation_label": "语音生成 (Speech 2.8 Turbo)",
        "category": "audio",
    },
    {
        "name": "Sora2",
        "provider": "sora2",
        "model_name": SORA2_DEFAULT_VIDEO_MODEL,
    },
    {
        "name": "Veo",
        "provider": "veo",
        "model_name": VEO_DEFAULT_VIDEO_MODEL,
    },
    {
        "name": "大能 Wan2.6 (DashScope)",
        "provider": "dashscope",
        "model_name": DASHSCOPE_DEFAULT_MODEL_MAP["wan26"],
    },
    {
        "name": "阿里云百炼共享 API · 合体 (Kling)",
        "provider": "dashscope",
        "model_name": "kling/kling-v3-video-generation",
    },
    {
        "name": "阿里云百炼共享 API · 大乘 (Vidu)",
        "provider": "dashscope",
        "model_name": "vidu/viduq3-turbo_reference2video",
    },
    {
        "name": "阿里云百炼共享 API · 炼虚 (HappyHorse)",
        "provider": "dashscope",
        "model_name": "happyhorse-1.0-r2v",
    },
    {
        "name": "飞升 (Seedance 2.0)",
        "provider": "seedance",
        "model_name": "doubao-seedance-2-0-260128",
    },
    {
        "name": "渡劫 (Seedance 2.0 Fast)",
        "provider": "seedance",
        "model_name": "doubao-seedance-2-0-fast-260128",
    },
    {
        "name": "laozhang GPT Image (VIP)",
        "provider": "laozhang-gpt-image",
        "model_name": "gpt-image-2-vip",
    },
    {
        "name": "laozhang GPT Image (Official)",
        "provider": "laozhang-sora2",
        "model_name": "gpt-image-2",
    },
    {
        "name": "Gemini TTS (语音)",
        "provider": "gemini-tts",
        "model_name": GEMINI_TTS_DEFAULT_MODEL,
    },
]


GEMINI_IMAGE_MODEL_ALIASES: Dict[str, str] = {
    "gemini-3-pro-image-preview": "gemini-3.1-flash-image-preview",
    "nanobanana": "gemini-3.1-flash-image-preview",
}


GPT_IMAGE_TIERS: Dict[str, dict] = {
    "vip": {
        "provider": "laozhang-gpt-image",
        "model": "gpt-image-2-vip",
        "key_hint": "GPT_IMAGE_API_KEY (laozhang default group)",
    },
    "official": {
        "provider": "laozhang-sora2",
        "model": "gpt-image-2",
        "key_hint": "SORA2_GPT_IMAGE_API_KEY (laozhang Sora2Official group)",
    },
}


def normalize_gemini_image_model(model: Optional[str]) -> Optional[str]:
    requested = (model or "").strip()
    if not requested:
        return None
    return GEMINI_IMAGE_MODEL_ALIASES.get(requested, requested)


def normalize_doubao_image_model(model: Optional[str]) -> Optional[str]:
    requested = (model or "").strip()
    if not requested:
        return None
    return DOUBAO_IMAGE_MODEL_ALIASES.get(requested.lower(), requested)


def _runtime_model_override(
    model: Optional[str],
    *,
    default_model: str,
    legacy_models: frozenset[str],
) -> Optional[str]:
    normalized = (model or "").strip()
    if not normalized or normalized == default_model or normalized in legacy_models:
        return None
    return normalized


def _normalize_video_model(
    model: Optional[str],
    *,
    default_model: str,
    legacy_models: frozenset[str],
) -> str:
    normalized = (model or "").strip()
    if not normalized or normalized in legacy_models:
        return default_model
    return normalized


def minimax_runtime_model_override(model: Optional[str]) -> Optional[str]:
    """Treat MiniMax empty/default names as fallback so runtime config can win."""
    return _runtime_model_override(
        model,
        default_model=MINIMAX_DEFAULT_VIDEO_MODEL,
        legacy_models=MINIMAX_LEGACY_VIDEO_MODELS,
    )


def normalize_minimax_video_model(model: Optional[str]) -> str:
    return _normalize_video_model(
        model,
        default_model=MINIMAX_DEFAULT_VIDEO_MODEL,
        legacy_models=MINIMAX_LEGACY_VIDEO_MODELS,
    )


def sora2_runtime_model_override(model: Optional[str]) -> Optional[str]:
    """Treat legacy/default Sora2 names as fallback so runtime config can win."""
    return _runtime_model_override(
        model,
        default_model=SORA2_DEFAULT_VIDEO_MODEL,
        legacy_models=SORA2_LEGACY_VIDEO_MODELS,
    )


def normalize_sora2_video_model(model: Optional[str]) -> str:
    return _normalize_video_model(
        model,
        default_model=SORA2_DEFAULT_VIDEO_MODEL,
        legacy_models=SORA2_LEGACY_VIDEO_MODELS,
    )


def veo_runtime_model_override(model: Optional[str]) -> Optional[str]:
    """Treat legacy/default Veo names as fallback so runtime config can win."""
    return _runtime_model_override(
        model,
        default_model=VEO_DEFAULT_VIDEO_MODEL,
        legacy_models=VEO_LEGACY_VIDEO_MODELS,
    )


def normalize_veo_video_model(model: Optional[str]) -> str:
    return _normalize_video_model(
        model,
        default_model=VEO_DEFAULT_VIDEO_MODEL,
        legacy_models=VEO_LEGACY_VIDEO_MODELS,
    )


def normalize_provider(provider: str) -> str:
    return (provider or "").strip().lower()


def get_provider_env_key(provider: str) -> str | None:
    return PROVIDER_ENV_MAP.get(normalize_provider(provider))


def get_provider_extra_env_keys(provider: str) -> Dict[str, str]:
    return deepcopy(PROVIDER_EXTRA_ENV_MAP.get(normalize_provider(provider), {}))


def get_provider_extra_env_key(provider: str, field: str) -> str | None:
    return get_provider_extra_env_keys(provider).get((field or "").strip().lower())


def get_provider_extra_fields(provider: str) -> List[Dict[str, Any]]:
    provider_id = normalize_provider(provider)
    env_keys = get_provider_extra_env_keys(provider_id)
    fields = deepcopy(PROVIDER_EXTRA_FIELD_CATALOG.get(provider_id, []))
    for item in fields:
        field = str(item.get("field") or "").strip().lower()
        if field:
            item["field"] = field
            item.setdefault("env_key", env_keys.get(field))
        item.setdefault("target", "request_template")
        item.setdefault("input_type", "text")
        item.setdefault("secret", False)
        item.setdefault("aliases", [])
    return fields


def get_endpoint_env_key(env_key: str) -> str:
    return env_key.replace("_API_KEY", "_ENDPOINT").replace("_KEY", "_ENDPOINT")


def get_proxy_mode_env_key(env_key: str) -> str:
    return env_key.replace("_API_KEY", "_PROXY_MODE").replace("_KEY", "_PROXY_MODE")


def get_custom_proxy_env_key(env_key: str) -> str:
    return env_key.replace("_API_KEY", "_CUSTOM_PROXY").replace("_KEY", "_CUSTOM_PROXY")


def get_model_env_key(env_key: str) -> str:
    return env_key.replace("_API_KEY", "_MODEL").replace("_KEY", "_MODEL")


def get_provider_default_endpoint(provider: str) -> str:
    return PROVIDER_DEFAULT_ENDPOINTS.get(normalize_provider(provider), "")


def is_google_generative_language_endpoint(endpoint: Optional[str]) -> bool:
    default_endpoint = get_provider_default_endpoint("gemini-tts").strip().rstrip("/").lower()
    value = str(endpoint or "").strip().rstrip("/").lower()
    return bool(default_endpoint and value.startswith(default_endpoint))


def get_provider_api_path(provider: str, operation: str, **path_params: Any) -> str:
    template = PROVIDER_API_PATHS.get(normalize_provider(provider), {}).get((operation or "").strip(), "")
    if not template:
        return ""
    return template.format(**{key: str(value) for key, value in path_params.items()})


def get_provider_operation_paths(provider: str) -> Dict[str, str]:
    return deepcopy(PROVIDER_API_PATHS.get(normalize_provider(provider), {}))


def build_provider_operation_url_templates(provider: str, endpoint: str) -> Dict[str, str]:
    base = (endpoint or "").strip().rstrip("/")
    if not base:
        return {}
    urls: Dict[str, str] = {}
    for operation, path in get_provider_operation_paths(provider).items():
        suffix = (path or "").strip("/")
        if not suffix:
            urls[operation] = base
        elif base.endswith(f"/{suffix}"):
            urls[operation] = base
        else:
            urls[operation] = f"{base}/{suffix}"
    return urls


def get_provider_default_category(provider: str) -> str:
    capabilities = PROVIDER_CATALOG.get(normalize_provider(provider), {}).get("capabilities") or []
    return str(capabilities[0]) if capabilities else ""


def _default_health_check_url(endpoint: str, provider: str = "") -> str:
    urls = derive_models_health_urls(endpoint, provider)
    return urls[0] if urls else ""


def _enrich_preset(preset: dict) -> dict:
    out = deepcopy(preset)
    provider = normalize_provider(out.get("provider", ""))
    env_key = get_provider_env_key(provider)
    meta = PROVIDER_CATALOG.get(provider, {})
    out.setdefault("endpoint", get_provider_default_endpoint(provider))
    out.setdefault("category", get_provider_default_category(provider))
    out.setdefault("proxy_mode", meta.get("default_proxy_mode", DEFAULT_PROVIDER_PROXY_MODE))
    out.setdefault("supports_proxy", meta.get("supports_proxy", DEFAULT_PROVIDER_SUPPORTS_PROXY))
    out.setdefault("health_check_url", _default_health_check_url(out.get("endpoint", ""), provider))
    out.setdefault("required_key", env_key)
    return out


def get_api_model_presets() -> List[dict]:
    return [_enrich_preset(preset) for preset in API_MODEL_PRESETS]


def get_api_model_preset(provider: str, model_name: Optional[str] = None) -> Optional[dict]:
    normalized = normalize_provider(provider)
    matches = [
        preset
        for preset in get_api_model_presets()
        if normalize_provider(preset.get("provider", "")) == normalized
    ]
    if model_name:
        for preset in matches:
            if preset.get("model_name") == model_name:
                return preset
    return matches[0] if matches else None


def get_provider_model_binding_options(provider: str) -> List[Dict[str, str]]:
    """Return the front-end operation/model choices supported by one API card."""
    provider_id = normalize_provider(provider)
    if provider_id == "doubao":
        return deepcopy(DOUBAO_IMAGE_MODEL_BINDING_OPTIONS)
    if provider_id == "seedance":
        return deepcopy(SEEDANCE_MODEL_BINDING_OPTIONS)
    if provider_id == "dashscope":
        return deepcopy(DASHSCOPE_MODEL_BINDING_OPTIONS)
    if provider_id == "minimax":
        return deepcopy(MINIMAX_MODEL_BINDING_OPTIONS)

    options: List[Dict[str, str]] = []
    seen: set[str] = set()
    for preset in API_MODEL_PRESETS:
        if normalize_provider(str(preset.get("provider") or "")) != provider_id:
            continue
        model_name = str(preset.get("model_name") or "").strip()
        if not model_name:
            continue
        operation = str(preset.get("operation") or model_name).strip().lower()
        if not operation or operation in seen:
            continue
        seen.add(operation)
        options.append(
            {
                "operation": operation,
                "label": str(preset.get("operation_label") or preset.get("name") or operation).strip(),
                "model_name": model_name,
            }
        )
    return options


def infer_model_binding_operation(provider: str, model_name: Optional[str]) -> str:
    provider_id = normalize_provider(provider)
    normalized_model = str(model_name or "").strip()
    if provider_id == "doubao":
        return "generate"
    if provider_id == "seedance":
        return "fast" if is_seedance_fast_model(normalized_model) else "standard"
    if provider_id == "dashscope":
        return dashscope_sub_model_for_model(normalized_model) or "default"
    for option in get_provider_model_binding_options(provider_id):
        if option["model_name"].lower() == normalized_model.lower():
            return option["operation"]
    return "default"


def normalize_model_bindings(
    provider: str,
    bindings: Any,
    legacy_model_name: Optional[str] = None,
) -> List[Dict[str, str]]:
    """Normalize one-card/many-model bindings and enforce one model per operation."""
    provider_id = normalize_provider(provider)
    raw_bindings = bindings
    if isinstance(raw_bindings, str):
        try:
            raw_bindings = json.loads(raw_bindings) if raw_bindings.strip() else []
        except json.JSONDecodeError:
            raw_bindings = []
    if not isinstance(raw_bindings, list):
        raw_bindings = []

    option_labels = {
        item["operation"]: item["label"]
        for item in get_provider_model_binding_options(provider)
    }
    normalized: Dict[str, Dict[str, str]] = {}
    for item in raw_bindings:
        if not isinstance(item, dict):
            continue
        model_name = str(item.get("model_name") or "").strip()
        if not model_name:
            continue
        operation = str(item.get("operation") or "").strip().lower()
        inferred_operation = infer_model_binding_operation(provider, model_name)
        if provider_id == "doubao":
            operation = "generate"
        elif provider_id == "gemini-image" and inferred_operation != "default" and operation not in option_labels:
            operation = inferred_operation
        elif not operation or (operation == "default" and inferred_operation != "default"):
            operation = inferred_operation
        label = str(
            option_labels.get(operation)
            if provider_id == "doubao"
            else item.get("label") or option_labels.get(operation) or operation
        ).strip()
        normalized[operation] = {
            "operation": operation,
            "label": label,
            "model_name": model_name,
        }

    fallback_model = str(legacy_model_name or "").strip()
    if not normalized and fallback_model:
        operation = infer_model_binding_operation(provider, fallback_model)
        normalized[operation] = {
            "operation": operation,
            "label": option_labels.get(operation) or operation,
            "model_name": fallback_model,
        }
    if provider_id == "gemini-image" and normalized:
        for option in get_provider_model_binding_options(provider_id):
            operation = option["operation"]
            if operation not in normalized:
                normalized[operation] = deepcopy(option)
    return list(normalized.values())


def primary_model_name_for_bindings(bindings: Any, fallback: Optional[str] = None) -> str:
    if isinstance(bindings, list):
        for item in bindings:
            if isinstance(item, dict):
                model_name = str(item.get("model_name") or "").strip()
                if model_name:
                    return model_name
    return str(fallback or "").strip()


def normalize_gpt_image_tier(tier: Optional[str]) -> str:
    normalized = (tier or "vip").strip().lower()
    if normalized not in GPT_IMAGE_TIERS:
        raise KeyError(normalized)
    return normalized


def get_gpt_image_tier(tier: Optional[str]) -> tuple[str, dict]:
    normalized = normalize_gpt_image_tier(tier)
    return normalized, deepcopy(GPT_IMAGE_TIERS[normalized])


def get_gpt_image_tiers() -> Dict[str, dict]:
    return deepcopy(GPT_IMAGE_TIERS)


def get_api_provider_catalog() -> List[dict]:
    presets = get_api_model_presets()
    counts: Dict[str, int] = {}
    categories: Dict[str, set] = {}
    defaults: Dict[str, dict] = {}
    for preset in presets:
        provider = normalize_provider(preset.get("provider", ""))
        if not provider:
            continue
        counts[provider] = counts.get(provider, 0) + 1
        defaults.setdefault(provider, preset)
        cat = preset.get("category") or ""
        if cat:
            categories.setdefault(provider, set()).add(cat)

    out: List[dict] = []
    for provider in sorted(set(PROVIDER_ENV_MAP) | set(PROVIDER_CATALOG)):
        item = deepcopy(PROVIDER_CATALOG.get(provider, {}))
        default_preset = defaults.get(provider, {})
        item.update(
            {
                "provider": provider,
                "env_key": PROVIDER_ENV_MAP.get(provider),
                "endpoint_env_key": get_endpoint_env_key(PROVIDER_ENV_MAP[provider])
                if provider in PROVIDER_ENV_MAP
                else None,
                "proxy_mode_env_key": get_proxy_mode_env_key(PROVIDER_ENV_MAP[provider])
                if provider in PROVIDER_ENV_MAP
                else None,
                "custom_proxy_env_key": get_custom_proxy_env_key(PROVIDER_ENV_MAP[provider])
                if provider in PROVIDER_ENV_MAP
                else None,
                "model_env_key": get_model_env_key(PROVIDER_ENV_MAP[provider])
                if provider in PROVIDER_ENV_MAP
                else None,
                "extra_fields": get_provider_extra_fields(provider),
                "model_binding_options": get_provider_model_binding_options(provider),
                "access_modes": deepcopy(item.get("access_modes") or []),
                "operation_paths": get_provider_operation_paths(provider),
                "default_operation_url_templates": build_provider_operation_url_templates(
                    provider,
                    default_preset.get("endpoint") or "",
                ),
                "health_check_url": default_preset.get("health_check_url")
                or _default_health_check_url(default_preset.get("endpoint", ""), provider),
                "fallback": item.get("fallback", []),
                "default_config_name": default_preset.get("name"),
                "default_endpoint": default_preset.get("endpoint"),
                "default_model_name": default_preset.get("model_name"),
                "default_category": default_preset.get("category"),
                "default_proxy_mode": default_preset.get("proxy_mode")
                or item.get("default_proxy_mode", DEFAULT_PROVIDER_PROXY_MODE),
                "preset_count": counts.get(provider, 0),
                "preset_categories": sorted(categories.get(provider, set())),
            }
        )
        out.append(item)
    return out


def _config_has_key(config: Any) -> bool:
    value = _config_get(config, "api_key_encrypted", "")
    return bool(value)


def summarize_api_provider_configs(configs: List[Any]) -> List[dict]:
    """Return provider-level readiness without exposing secret values.

    A provider can have several model preset rows that share one runtime env key.
    The summary makes that visible so the admin UI can show whether a provider is
    actually ready, not just whether each individual model card has a key.
    """
    provider_catalog = {item["provider"]: item for item in get_api_provider_catalog()}
    grouped: Dict[str, List[Any]] = {}
    for config in configs or []:
        provider = normalize_provider(_config_get(config, "provider", ""))
        if not provider:
            provider = "__custom__"
        grouped.setdefault(provider, []).append(config)

    provider_ids = sorted(set(provider_catalog) | {p for p in grouped if p != "__custom__"})
    if "__custom__" in grouped:
        provider_ids.append("__custom__")

    summaries: List[dict] = []
    for provider in provider_ids:
        rows = grouped.get(provider, [])
        meta = provider_catalog.get(provider, {})
        env_key = meta.get("env_key")

        total = len(rows)
        enabled_rows = [r for r in rows if _config_get(r, "enabled", True) is not False]
        keyed_rows = [r for r in rows if _config_has_key(r)]
        ready_rows = [r for r in enabled_rows if _config_has_key(r)]
        missing_key_rows = [r for r in rows if not _config_has_key(r)]
        disabled_rows = [r for r in rows if _config_get(r, "enabled", True) is False]

        active_model_counts: Dict[str, int] = {}
        enabled_endpoints = set()
        for row in enabled_rows:
            bindings = normalize_model_bindings(
                provider,
                _config_get(row, "model_bindings", []),
                str(_config_get(row, "model_name", "") or ""),
            )
            for binding in bindings:
                model_name = binding["model_name"]
                active_model_counts[model_name] = active_model_counts.get(model_name, 0) + 1
            endpoint = str(_config_get(row, "endpoint", "") or "").strip()
            if endpoint:
                enabled_endpoints.add(endpoint)
        # Different credential cards are expected to expose the same operations
        # and models. Only simultaneous active cards are a runtime conflict.
        duplicate_models: List[str] = []
        duplicate_enabled_models = sorted([m for m, count in active_model_counts.items() if count > 1])

        issues: List[str] = []
        if total == 0:
            status = "not_imported"
            issues.append("not_imported")
        elif ready_rows:
            status = "ready"
            if missing_key_rows:
                issues.append("some_configs_missing_key")
        elif keyed_rows and not enabled_rows:
            status = "disabled"
            issues.append("all_keyed_configs_disabled")
        else:
            status = "missing_key"
            issues.append("missing_key")

        if duplicate_enabled_models:
            issues.append("duplicate_enabled_models")
        if env_key and len(ready_rows) > 1:
            issues.append("multiple_enabled_configs_share_env")
        if env_key and len(enabled_endpoints) > 1:
            issues.append("endpoint_env_conflict")

        summaries.append(
            {
                "provider": None if provider == "__custom__" else provider,
                "label": meta.get("label") or ("Custom" if provider == "__custom__" else provider),
                "vendor": meta.get("vendor") or "",
                "env_key": env_key,
                "endpoint_env_key": meta.get("endpoint_env_key"),
                "required_env": meta.get("required_env", []),
                "fallback_env": meta.get("fallback_env", []),
                "capabilities": meta.get("capabilities", []),
                "operation_paths": meta.get("operation_paths", {}),
                "status": status,
                "ready": bool(ready_rows),
                "issues": issues,
                "counts": {
                    "configs": total,
                    "enabled": len(enabled_rows),
                    "configured": len(keyed_rows),
                    "ready": len(ready_rows),
                    "missing_key": len(missing_key_rows),
                    "disabled": len(disabled_rows),
                    "presets": meta.get("preset_count", 0),
                },
                "duplicate_models": duplicate_models,
                "duplicate_enabled_models": duplicate_enabled_models,
                "enabled_endpoint_count": len(enabled_endpoints),
                "configs": [
                    {
                        "config_id": _config_get(row, "config_id", ""),
                        "name": _config_get(row, "name", ""),
                        "model_name": _config_get(row, "model_name", ""),
                        "endpoint": _config_get(row, "endpoint", ""),
                        "enabled": _config_get(row, "enabled", True) is not False,
                        "has_key": _config_has_key(row),
                    }
                    for row in rows
                ],
            }
        )
    return summaries
