"""Central registry for external API provider configuration.

This module is intentionally data-only. Runtime callers should import from here
instead of duplicating provider -> environment-variable and preset-model lists.
It is the first step toward a unified API management surface.
"""
from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, List, Optional

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


SEEDANCE_DEFAULT_MODEL_MAP: Dict[str, str] = {
    # Keep the currently opened-account fallback while allowing admin runtime
    # config to switch standard/fast to Seedance 2.0 without code changes.
    "standard": "doubao-seedance-1-0-pro-250528",
    "fast": "doubao-seedance-1-0-pro-250528",
}

SEEDANCE_SUB_MODEL_ENV_MAP: Dict[str, str] = {
    "standard": "SEEDANCE_MODEL_STANDARD",
    "fast": "SEEDANCE_MODEL_FAST",
}

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


def normalize_seedance_sub_model(sub_model: Optional[str]) -> str:
    normalized = (sub_model or "standard").strip().lower()
    if normalized not in SEEDANCE_SUB_MODEL_ENV_MAP:
        raise ValueError(f"Unsupported Seedance sub_model: {sub_model}")
    return normalized


def get_seedance_sub_model_env_key(sub_model: Optional[str]) -> str:
    return SEEDANCE_SUB_MODEL_ENV_MAP[normalize_seedance_sub_model(sub_model)]


def is_seedance_fast_model(model_name: Optional[str]) -> bool:
    return "fast" in (model_name or "").strip().lower()


def normalize_dashscope_sub_model(sub_model: Optional[str]) -> str:
    normalized = (sub_model or "wan26").strip().lower()
    if normalized not in DASHSCOPE_SUB_MODEL_ENV_MAP:
        raise ValueError(f"Unsupported DashScope sub_model: {sub_model}")
    return normalized


def get_dashscope_sub_model_env_key(sub_model: Optional[str]) -> str:
    return DASHSCOPE_SUB_MODEL_ENV_MAP[normalize_dashscope_sub_model(sub_model)]


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


PROVIDER_CATALOG: Dict[str, dict] = {
    "deepseek": {
        "label": "DeepSeek",
        "vendor": "deepseek",
        "capabilities": ["text"],
        "required_env": ["DEEPSEEK_API_KEY"],
        "fallback_env": [],
        "default_proxy_mode": "direct",
        "supports_proxy": True,
        "notes": "Text/chat provider used by script and reasoning flows.",
    },
    "gemini-text": {
        "label": "Gemini Text",
        "vendor": "google",
        "capabilities": ["text"],
        "required_env": ["GEMINI_TEXT_API_KEY"],
        "fallback_env": [],
        "fallback": [
            {
                "provider": "deepseek",
                "model_name": "deepseek-reasoner",
                "when": ["missing_key", "health_error"],
            }
        ],
        "default_proxy_mode": "direct",
        "supports_proxy": True,
        "notes": "Google Gemini text generation.",
    },
    "gemini-image": {
        "label": "Gemini Image",
        "vendor": "google",
        "capabilities": ["image"],
        "required_env": ["GEMINI_IMAGE_API_KEY"],
        "fallback_env": [],
        "default_proxy_mode": "direct",
        "supports_proxy": True,
        "notes": "Google Gemini image generation.",
    },
    "gemini-tts": {
        "label": "Gemini TTS",
        "vendor": "google",
        "capabilities": ["audio"],
        "required_env": ["GEMINI_API_KEY"],
        "fallback_env": [],
        "default_proxy_mode": "direct",
        "supports_proxy": True,
        "notes": "Fallback TTS provider.",
    },
    "doubao": {
        "label": "Volcengine Ark / Doubao",
        "vendor": "volcengine",
        "capabilities": ["image"],
        "required_env": ["ARK_API_KEY"],
        "fallback_env": [],
        "default_proxy_mode": "direct",
        "supports_proxy": True,
        "notes": "Ark-compatible image generation provider.",
    },
    "seedance": {
        "label": "Seedance 2.0",
        "vendor": "volcengine",
        "capabilities": ["video"],
        "required_env": ["SEEDANCE_API_KEY"],
        "fallback_env": ["ARK_API_KEY"],
        "default_proxy_mode": "direct",
        "supports_proxy": True,
        "notes": "Volcengine Ark Seedance video generation.",
    },
    "dashscope": {
        "label": "DashScope / Model Studio",
        "vendor": "alibaba",
        "capabilities": ["video"],
        "required_env": ["DASHSCOPE_API_KEY"],
        "fallback_env": [],
        "default_proxy_mode": "direct",
        "supports_proxy": True,
        "notes": "Wan2.6, Kling, Vidu, and HappyHorse share this key.",
    },
    "minimax": {
        "label": "MiniMax / Hailuo",
        "vendor": "minimax",
        "capabilities": ["video", "audio"],
        "required_env": ["MINIMAX_API_KEY"],
        "fallback_env": [],
        "default_proxy_mode": "direct",
        "supports_proxy": True,
        "notes": "Video generation plus TTS, voice design, and voice clone.",
    },
    "sora2": {
        "label": "Sora2 Gateway",
        "vendor": "laozhang",
        "capabilities": ["video"],
        "required_env": ["SORA2_API_KEY"],
        "fallback_env": [],
        "default_proxy_mode": "direct",
        "supports_proxy": True,
        "notes": "Laozhang Sora2-compatible video gateway.",
    },
    "veo": {
        "label": "Veo Gateway",
        "vendor": "laozhang",
        "capabilities": ["video"],
        "required_env": ["VEO_API_KEY"],
        "fallback_env": ["SORA2_API_KEY"],
        "default_proxy_mode": "direct",
        "supports_proxy": True,
        "notes": "Laozhang Veo-compatible video gateway.",
    },
    "laozhang-gpt-image": {
        "label": "GPT Image VIP Gateway",
        "vendor": "laozhang",
        "capabilities": ["image"],
        "required_env": ["GPT_IMAGE_API_KEY"],
        "fallback_env": [],
        "default_proxy_mode": "direct",
        "supports_proxy": True,
        "notes": "Default/VIP GPT Image token group.",
    },
    "laozhang-sora2": {
        "label": "GPT Image Official Gateway",
        "vendor": "laozhang",
        "capabilities": ["image"],
        "required_env": ["SORA2_GPT_IMAGE_API_KEY"],
        "fallback_env": [],
        "default_proxy_mode": "direct",
        "supports_proxy": True,
        "notes": "Official GPT Image token group.",
    },
}


PROVIDER_HEALTH_CHECK_URLS: Dict[str, str] = {
    "deepseek": "https://api.deepseek.com/models",
    "gemini-text": "https://api.laozhang.ai/v1/models",
    "gemini-image": "https://api.laozhang.ai/v1beta/models",
    "gemini-tts": "https://generativelanguage.googleapis.com/v1beta/openai/models",
    "doubao": "https://ark.cn-beijing.volces.com/api/v3/models",
    "seedance": "https://ark.cn-beijing.volces.com/api/v3/models",
    "dashscope": "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
    "minimax": "https://api.minimaxi.com/v1/models",
    "sora2": "https://api.laozhang.ai/v1/models",
    "veo": "https://api.laozhang.ai/v1/models",
    "laozhang-gpt-image": "https://api.laozhang.ai/v1/models",
    "laozhang-sora2": "https://api.laozhang.ai/v1/models",
}


PROVIDER_HEALTH_CHECKS: Dict[str, dict] = {
    provider: {
        "method": "GET",
        "path": "/models",
        "billable": False,
    }
    for provider in PROVIDER_ENV_MAP
}
PROVIDER_HEALTH_CHECKS["dashscope"] = {
    "method": "GET",
    "path": "/compatible-mode/v1/models",
    "billable": False,
}

for _provider_id, _provider_meta in PROVIDER_CATALOG.items():
    _provider_meta.setdefault("health_check", PROVIDER_HEALTH_CHECKS.get(_provider_id, {}))


API_MODEL_PRESETS: List[dict] = [
    {
        "name": "Gemini 2.5 Flash (文本)",
        "provider": "gemini-text",
        "model_name": "gemini-2.5-flash",
        "endpoint": "https://api.laozhang.ai/v1",
        "proxy_mode": "direct",
        "category": "text",
    },
    {
        "name": "DeepSeek Reasoner",
        "provider": "deepseek",
        "model_name": "deepseek-reasoner",
        "endpoint": "https://api.deepseek.com",
        "proxy_mode": "direct",
        "category": "text",
    },
    {
        "name": "Gemini 2.5 Flash (图像)",
        "provider": "gemini-image",
        "model_name": "gemini-2.5-flash-image",
        "endpoint": "https://api.laozhang.ai/v1beta",
        "proxy_mode": "direct",
        "category": "image",
    },
    {
        "name": "Gemini 3.1 Flash (图像)",
        "provider": "gemini-image",
        "model_name": "gemini-3.1-flash-image-preview",
        "endpoint": "https://api.laozhang.ai/v1beta",
        "proxy_mode": "direct",
        "category": "image",
    },
    {
        "name": "豆包 SeedDream",
        "provider": "doubao",
        "model_name": "doubao-seedream-4-0-250828",
        "endpoint": "https://ark.cn-beijing.volces.com/api/v3/images/generations",
        "proxy_mode": "direct",
        "category": "image",
    },
    {
        "name": "MiniMax Hailuo",
        "provider": "minimax",
        "model_name": "MiniMax-Hailuo-02",
        "endpoint": "https://api.minimaxi.com/v1",
        "proxy_mode": "direct",
        "category": "video",
    },
    {
        "name": "Sora2",
        "provider": "sora2",
        "model_name": "sora_video2-landscape-15s",
        "endpoint": "https://api.laozhang.ai/v1",
        "proxy_mode": "direct",
        "category": "video",
    },
    {
        "name": "Veo",
        "provider": "veo",
        "model_name": "veo-3.1-landscape-fast-fl",
        "endpoint": "https://api.laozhang.ai/v1",
        "proxy_mode": "direct",
        "category": "video",
    },
    {
        "name": "大能 Wan2.6 (DashScope)",
        "provider": "dashscope",
        "model_name": "wan2.6-i2v",
        "endpoint": "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
        "proxy_mode": "direct",
        "category": "video",
    },
    {
        "name": "阿里云百炼共享 API · 合体 (Kling)",
        "provider": "dashscope",
        "model_name": "kling/kling-v3-video-generation",
        "endpoint": "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
        "proxy_mode": "direct",
        "category": "video",
    },
    {
        "name": "阿里云百炼共享 API · 大乘 (Vidu)",
        "provider": "dashscope",
        "model_name": "vidu/viduq3-turbo_reference2video",
        "endpoint": "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
        "proxy_mode": "direct",
        "category": "video",
    },
    {
        "name": "阿里云百炼共享 API · 炼虚 (HappyHorse)",
        "provider": "dashscope",
        "model_name": "happyhorse-1.0-r2v",
        "endpoint": "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
        "proxy_mode": "direct",
        "category": "video",
    },
    {
        "name": "飞升 (Seedance 2.0)",
        "provider": "seedance",
        "model_name": "doubao-seedance-2-0-260128",
        "endpoint": "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
        "proxy_mode": "direct",
        "category": "video",
    },
    {
        "name": "渡劫 (Seedance 2.0 Fast)",
        "provider": "seedance",
        "model_name": "doubao-seedance-2-0-fast-260128",
        "endpoint": "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
        "proxy_mode": "direct",
        "category": "video",
    },
    {
        "name": "laozhang GPT Image (VIP)",
        "provider": "laozhang-gpt-image",
        "model_name": "gpt-image-2-vip",
        "endpoint": "https://api.laozhang.ai/v1",
        "proxy_mode": "direct",
        "category": "image",
    },
    {
        "name": "laozhang GPT Image (Official)",
        "provider": "laozhang-sora2",
        "model_name": "gpt-image-2",
        "endpoint": "https://api.laozhang.ai/v1",
        "proxy_mode": "direct",
        "category": "image",
    },
    {
        "name": "Gemini TTS (语音)",
        "provider": "gemini-tts",
        "model_name": "gemini-2.5-flash-preview-tts",
        "endpoint": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "proxy_mode": "direct",
        "category": "audio",
    },
]


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


def normalize_provider(provider: str) -> str:
    return (provider or "").strip().lower()


def get_provider_env_key(provider: str) -> str | None:
    return PROVIDER_ENV_MAP.get(normalize_provider(provider))


def get_provider_extra_env_keys(provider: str) -> Dict[str, str]:
    return deepcopy(PROVIDER_EXTRA_ENV_MAP.get(normalize_provider(provider), {}))


def get_provider_extra_env_key(provider: str, field: str) -> str | None:
    return get_provider_extra_env_keys(provider).get((field or "").strip().lower())


def get_endpoint_env_key(env_key: str) -> str:
    return env_key.replace("_API_KEY", "_ENDPOINT").replace("_KEY", "_ENDPOINT")


def get_proxy_mode_env_key(env_key: str) -> str:
    return env_key.replace("_API_KEY", "_PROXY_MODE").replace("_KEY", "_PROXY_MODE")


def get_custom_proxy_env_key(env_key: str) -> str:
    return env_key.replace("_API_KEY", "_CUSTOM_PROXY").replace("_KEY", "_CUSTOM_PROXY")


def get_model_env_key(env_key: str) -> str:
    return env_key.replace("_API_KEY", "_MODEL").replace("_KEY", "_MODEL")


def _default_health_check_url(endpoint: str) -> str:
    base = (endpoint or "").strip().rstrip("/")
    if not base:
        return ""
    if base.endswith("/models"):
        return base
    return f"{base}/models"


def _enrich_preset(preset: dict) -> dict:
    out = deepcopy(preset)
    provider = normalize_provider(out.get("provider", ""))
    env_key = get_provider_env_key(provider)
    meta = PROVIDER_CATALOG.get(provider, {})
    out.setdefault("supports_proxy", meta.get("supports_proxy", True))
    out.setdefault("health_check_url", PROVIDER_HEALTH_CHECK_URLS.get(provider) or _default_health_check_url(out.get("endpoint", "")))
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
    for preset in presets:
        provider = normalize_provider(preset.get("provider", ""))
        if not provider:
            continue
        counts[provider] = counts.get(provider, 0) + 1
        cat = preset.get("category") or ""
        if cat:
            categories.setdefault(provider, set()).add(cat)

    out: List[dict] = []
    for provider in sorted(set(PROVIDER_ENV_MAP) | set(PROVIDER_CATALOG)):
        item = deepcopy(PROVIDER_CATALOG.get(provider, {}))
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
                "health_check_url": PROVIDER_HEALTH_CHECK_URLS.get(provider),
                "fallback": item.get("fallback", []),
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

        model_counts: Dict[str, int] = {}
        active_model_counts: Dict[str, int] = {}
        enabled_endpoints = set()
        for row in enabled_rows:
            model_name = str(_config_get(row, "model_name", "") or "")
            if model_name:
                active_model_counts[model_name] = active_model_counts.get(model_name, 0) + 1
            endpoint = str(_config_get(row, "endpoint", "") or "").strip()
            if endpoint:
                enabled_endpoints.add(endpoint)
        for row in rows:
            model_name = str(_config_get(row, "model_name", "") or "")
            if model_name:
                model_counts[model_name] = model_counts.get(model_name, 0) + 1

        duplicate_models = sorted([m for m, count in model_counts.items() if count > 1])
        duplicate_enabled_models = sorted([m for m, count in active_model_counts.items() if count > 1])

        issues: List[str] = []
        if total == 0:
            status = "not_imported"
            issues.append("not_imported")
        elif ready_rows:
            status = "ready"
            if missing_key_rows:
                issues.append("some_configs_missing_key")
            if disabled_rows:
                issues.append("some_configs_disabled")
        elif keyed_rows and not enabled_rows:
            status = "disabled"
            issues.append("all_keyed_configs_disabled")
        else:
            status = "missing_key"
            issues.append("missing_key")

        if duplicate_models:
            issues.append("duplicate_models")
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
