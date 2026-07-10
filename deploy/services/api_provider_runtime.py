"""Runtime resolver for external API provider configuration.

The admin API writes DB configurations into environment variables through
load_api_configs_to_env(). This module deliberately reads env values on every
call so key/endpoint updates can take effect without restarting the service.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from services.api_provider_registry import (
    DASHSCOPE_DEFAULT_MODEL_MAP,
    PROVIDER_CATALOG,
    SEEDANCE_DEFAULT_MODEL_MAP,
    build_provider_operation_url_templates,
    dashscope_model_matches_sub_model,
    dashscope_sub_model_for_model,
    get_api_model_preset,
    get_api_model_presets,
    get_custom_proxy_env_key,
    get_dashscope_sub_model_env_key,
    get_endpoint_env_key,
    get_model_env_key,
    get_provider_api_path,
    get_provider_extra_env_keys,
    get_provider_env_key,
    get_proxy_mode_env_key,
    get_seedance_sub_model_env_key,
    is_seedance_fast_model,
    normalize_dashscope_sub_model,
    normalize_seedance_sub_model,
    normalize_provider,
)
from utils.config_helpers import _config_get


@dataclass(frozen=True)
class ResolvedProviderConfig:
    provider: str
    model_name: str
    api_key: str
    endpoint: str
    api_key_env: Optional[str]
    endpoint_env: Optional[str]
    model_env: Optional[str]
    extra: Dict[str, str]
    proxy_config: Dict[str, Any]
    source: Dict[str, str]

    @property
    def has_key(self) -> bool:
        return bool(self.api_key)

    def url_for(self, path: str = "") -> str:
        base = (self.endpoint or "").strip().rstrip("/")
        suffix = (path or "").strip("/")
        if not suffix:
            return base
        if base.endswith(f"/{suffix}"):
            return base
        return f"{base}/{suffix}"

    def url_for_operation(self, operation: str, **path_params: Any) -> str:
        return self.url_for(get_provider_api_path(self.provider, operation, **path_params))

    def operation_url_templates(self) -> Dict[str, str]:
        return build_provider_operation_url_templates(self.provider, self.endpoint)

    def requests_kwargs(self) -> Dict[str, Any]:
        mode = (self.proxy_config.get("mode") or "direct").lower()
        custom_proxy = (self.proxy_config.get("custom_proxy") or "").strip()
        if mode == "custom" and custom_proxy:
            return {"proxies": {"http": custom_proxy, "https": custom_proxy}}
        return {}

    def aiohttp_proxy(self) -> Optional[str]:
        mode = (self.proxy_config.get("mode") or "direct").lower()
        custom_proxy = (self.proxy_config.get("custom_proxy") or "").strip()
        return custom_proxy if mode == "custom" and custom_proxy else None


ProviderHealthMap = Dict[str, Dict[str, Any]]


def provider_health_key(provider: str, model_name: Optional[str] = None) -> str:
    provider_id = normalize_provider(provider)
    model_key = str(model_name or "").strip().lower()
    return f"{provider_id}::{model_key}" if model_key else provider_id


def normalize_provider_health_map(provider_health: Optional[Any]) -> ProviderHealthMap:
    if not provider_health:
        return {}
    if isinstance(provider_health, dict):
        items = [v for v in provider_health.values() if isinstance(v, dict)]
    elif isinstance(provider_health, list):
        items = provider_health
    else:
        items = []

    out: ProviderHealthMap = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        provider = normalize_provider(str(item.get("provider") or ""))
        model_name = str(item.get("model_name") or "").strip()
        if provider:
            out[provider_health_key(provider, model_name)] = dict(item)
    return out


def provider_health_entry(
    provider: str,
    provider_health: Optional[Any] = None,
    *,
    model_name: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    health_map = normalize_provider_health_map(provider_health)
    provider_id = normalize_provider(provider)
    if model_name:
        exact = health_map.get(provider_health_key(provider_id, model_name))
        if exact:
            return exact
    return health_map.get(provider_id)


def provider_health_status(
    provider: str,
    provider_health: Optional[Any] = None,
    *,
    model_name: Optional[str] = None,
) -> Optional[str]:
    health = provider_health_entry(provider, provider_health, model_name=model_name)
    status = str(health.get("status") or "").strip().lower() if health else ""
    return status or None


def provider_is_down(
    provider: str,
    provider_health: Optional[Any] = None,
    *,
    model_name: Optional[str] = None,
) -> bool:
    return provider_health_status(provider, provider_health, model_name=model_name) in {"error"}


def provider_is_usable(
    provider: str,
    provider_health: Optional[Any] = None,
    *,
    model_name: Optional[str] = None,
) -> bool:
    status = provider_health_status(provider, provider_health, model_name=model_name)
    # Missing cache should not mark a provider down; health sweeps are best effort.
    return status not in {"error", "no_key"}


def _fallback_entries(provider: str) -> List[Dict[str, Any]]:
    catalog = PROVIDER_CATALOG.get(normalize_provider(provider), {})
    raw = catalog.get("fallback") or []
    if isinstance(raw, str):
        raw = [{"provider": raw}]
    entries: List[Dict[str, Any]] = []
    for item in raw:
        if isinstance(item, str):
            item = {"provider": item}
        if not isinstance(item, dict):
            continue
        fallback_provider = normalize_provider(str(item.get("provider") or ""))
        if not fallback_provider:
            continue
        entries.append(
            {
                **item,
                "provider": fallback_provider,
                "model_name": str(item.get("model_name") or ""),
                "when": list(item.get("when") or ["missing_key", "health_error"]),
            }
        )
    return entries


def provider_fallback_chain(provider: str) -> List[Dict[str, Any]]:
    """Return registry-declared provider fallback entries without secrets."""
    return _fallback_entries(provider)


def _candidate_skip_reasons(
    config: ResolvedProviderConfig,
    *,
    provider_health: Optional[Any] = None,
    is_primary: bool = False,
) -> List[str]:
    reasons: List[str] = []
    if not config.has_key:
        reasons.append("missing_key")
    if not config.endpoint:
        reasons.append("missing_endpoint")
    if provider_is_down(config.provider, provider_health, model_name=config.model_name):
        reasons.append("health_error")
    if not is_primary and provider_health_status(config.provider, provider_health, model_name=config.model_name) == "no_key":
        reasons.append("health_no_key")
    return reasons


def resolve_provider_with_failover(
    provider: str,
    model_name: Optional[str] = None,
    *,
    provider_health: Optional[Any] = None,
) -> Tuple[ResolvedProviderConfig, Dict[str, Any]]:
    """Resolve provider config and select a registry-declared fallback if needed.

    This is intentionally conservative: only registry-declared fallback providers
    are considered, and missing health cache does not mark a primary down.
    Callers that need protocol-specific behavior can inspect the returned
    diagnostics before deciding whether to use the fallback config.
    """
    provider_id = normalize_provider(provider)
    primary = resolve_provider(provider_id, model_name)
    primary_reasons = _candidate_skip_reasons(
        primary,
        provider_health=provider_health,
        is_primary=True,
    )
    health_map = normalize_provider_health_map(provider_health)
    candidates: List[Dict[str, Any]] = [
        {
            "provider": primary.provider,
            "model_name": primary.model_name,
            "role": "primary",
            "selected": not primary_reasons,
            "usable": not primary_reasons,
            "skip_reasons": primary_reasons,
            "health_status": provider_health_status(primary.provider, health_map, model_name=primary.model_name),
            "has_key": primary.has_key,
            "has_endpoint": bool(primary.endpoint),
        }
    ]

    if not primary_reasons:
        return primary, {
            "requested_provider": provider_id,
            "selected_provider": primary.provider,
            "selected_model_name": primary.model_name,
            "active": False,
            "reason": "",
            "candidates": candidates,
        }

    for entry in _fallback_entries(provider_id):
        when = set(str(item) for item in (entry.get("when") or []))
        if when and not (when & set(primary_reasons)):
            continue
        fallback_provider = normalize_provider(str(entry.get("provider") or ""))
        fallback_model = str(entry.get("model_name") or "") or None
        fallback = resolve_provider(fallback_provider, fallback_model)
        fallback_reasons = _candidate_skip_reasons(
            fallback,
            provider_health=health_map,
            is_primary=False,
        )
        selected = not fallback_reasons
        candidates.append(
            {
                "provider": fallback.provider,
                "model_name": fallback.model_name,
                "role": "fallback",
                "selected": selected,
                "usable": selected,
                "skip_reasons": fallback_reasons,
                "health_status": provider_health_status(fallback.provider, health_map, model_name=fallback.model_name),
                "has_key": fallback.has_key,
                "has_endpoint": bool(fallback.endpoint),
                "fallback_for": provider_id,
            }
        )
        if selected:
            return fallback, {
                "requested_provider": provider_id,
                "selected_provider": fallback.provider,
                "selected_model_name": fallback.model_name,
                "active": True,
                "reason": primary_reasons[0],
                "candidates": candidates,
            }

    return primary, {
        "requested_provider": provider_id,
        "selected_provider": primary.provider,
        "selected_model_name": primary.model_name,
        "active": False,
        "reason": primary_reasons[0],
        "candidates": candidates,
    }


def _unique(items: List[Optional[str]]) -> List[str]:
    seen = set()
    out: List[str] = []
    for item in items:
        if not item or item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def _first_env(env_keys: List[str]) -> tuple[str, Optional[str]]:
    for env_key in env_keys:
        value = os.getenv(env_key)
        if value:
            return value, env_key
    return "", None


def _config_enabled(config: Any) -> bool:
    return _config_get(config, "enabled", True) is not False


def _config_has_encrypted_key(config: Any) -> bool:
    return bool(_config_get(config, "api_key_encrypted", ""))


def _safe_config_source(config: Any) -> Dict[str, Any]:
    return {
        "config_id": _config_get(config, "config_id", ""),
        "name": _config_get(config, "name", ""),
        "provider": normalize_provider(_config_get(config, "provider", "")),
        "model_name": _config_get(config, "model_name", "") or "",
        "endpoint": (_config_get(config, "endpoint", "") or "").strip(),
        "proxy_mode": (_config_get(config, "proxy_mode", "") or "").strip() or "direct",
        "category": _config_get(config, "category", "") or "",
    }


def build_effective_provider_config_sources(configs: Optional[List[Any]]) -> Dict[str, Dict[str, Any]]:
    """Describe which enabled DB row wins for each provider.

    load_api_configs_to_env() writes every enabled keyed row in list order; rows
    for the same provider share one env key, so the last keyed row wins. This
    helper mirrors that behavior for admin/runtime diagnostics without exposing
    encrypted or decrypted key material.
    """
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for config in configs or []:
        provider = normalize_provider(_config_get(config, "provider", ""))
        if not provider or not get_provider_env_key(provider):
            continue
        if not _config_enabled(config) or not _config_has_encrypted_key(config):
            continue
        grouped.setdefault(provider, []).append(_safe_config_source(config))

    sources: Dict[str, Dict[str, Any]] = {}
    for provider, rows in grouped.items():
        effective = rows[-1]
        endpoints = sorted({row["endpoint"] for row in rows if row.get("endpoint")})
        models = sorted({row["model_name"] for row in rows if row.get("model_name")})
        sources[provider] = {
            "provider": provider,
            "effective": effective,
            "keyed_enabled_config_count": len(rows),
            "enabled_endpoint_count": len(endpoints),
            "enabled_model_count": len(models),
            "candidate_config_ids": [row["config_id"] for row in rows if row.get("config_id")],
            "candidate_names": [row["name"] for row in rows if row.get("name")],
        }
    return sources


def resolve_seedance_model_name(sub_model: str, model_name: Optional[str] = None) -> str:
    """Resolve Seedance standard/fast model names without import-time env caching."""
    normalized_sub_model = normalize_seedance_sub_model(sub_model)
    explicit_model = (model_name or "").strip()
    if explicit_model:
        return explicit_model

    sub_model_env = get_seedance_sub_model_env_key(normalized_sub_model)
    sub_model_value = (os.getenv(sub_model_env) or "").strip()
    if sub_model_value:
        return sub_model_value

    provider_env = get_provider_env_key("seedance")
    generic_model_env = get_model_env_key(provider_env) if provider_env else ""
    generic_model = (os.getenv(generic_model_env) or "").strip() if generic_model_env else ""
    if generic_model:
        generic_is_fast = is_seedance_fast_model(generic_model)
        if normalized_sub_model == "fast" and generic_is_fast:
            return generic_model
        if normalized_sub_model == "standard" and not generic_is_fast:
            return generic_model

    return SEEDANCE_DEFAULT_MODEL_MAP[normalized_sub_model]


# Seedance 兼容薄壳移至文件末尾（薄壳转调 vendor_error_is_non_retryable + vendor_user_facing_error，
# 保持与原 seedance_error_is_non_retryable / seedance_user_facing_error 同等行为）。


def resolve_dashscope_model_name(sub_model: str, model_name: Optional[str] = None) -> str:
    """Resolve DashScope family model names without sharing one generic model env."""
    normalized_sub_model = normalize_dashscope_sub_model(sub_model)
    explicit_model = (model_name or "").strip()
    if explicit_model:
        return explicit_model

    sub_model_env = get_dashscope_sub_model_env_key(normalized_sub_model)
    sub_model_value = (os.getenv(sub_model_env) or "").strip()
    if sub_model_value:
        return sub_model_value

    provider_env = get_provider_env_key("dashscope")
    generic_model_env = get_model_env_key(provider_env) if provider_env else ""
    generic_model = (os.getenv(generic_model_env) or "").strip() if generic_model_env else ""
    if generic_model and dashscope_model_matches_sub_model(normalized_sub_model, generic_model):
        return generic_model

    return DASHSCOPE_DEFAULT_MODEL_MAP[normalized_sub_model]


def resolve_dashscope_default_model_name(model_name: str) -> str:
    """Map registry default DashScope model names through runtime sub-model env."""
    sub_model = dashscope_sub_model_for_model(model_name)
    if sub_model:
        return resolve_dashscope_model_name(sub_model)
    return model_name


def resolve_provider(provider: str, model_name: Optional[str] = None) -> ResolvedProviderConfig:
    provider_id = normalize_provider(provider)
    preset = get_api_model_preset(provider_id, model_name) or {}
    catalog = PROVIDER_CATALOG.get(provider_id, {})

    primary_env = get_provider_env_key(provider_id)
    fallback_envs = list(catalog.get("fallback_env") or [])
    key_envs = _unique([primary_env, *fallback_envs])
    api_key, api_key_env = _first_env(key_envs)

    # Fallback env keys are credentials only. Endpoint/proxy settings are
    # provider-scoped; borrowing them from the fallback key can route a request
    # to the wrong API surface (for example Seedance using ARK image endpoint).
    endpoint_envs = _unique(
        [
            get_endpoint_env_key(primary_env) if primary_env else None,
        ]
    )
    endpoint, endpoint_env = _first_env(endpoint_envs)
    if not endpoint:
        endpoint = (preset.get("endpoint") or "").strip()

    proxy_mode_envs = _unique(
        [
            get_proxy_mode_env_key(primary_env) if primary_env else None,
        ]
    )
    proxy_mode, proxy_mode_env = _first_env(proxy_mode_envs)
    if not proxy_mode:
        proxy_mode = (
            preset.get("proxy_mode")
            or catalog.get("default_proxy_mode")
            or "direct"
        )

    custom_proxy_envs = _unique(
        [
            get_custom_proxy_env_key(primary_env) if primary_env else None,
        ]
    )
    custom_proxy, custom_proxy_env = _first_env(custom_proxy_envs)

    model_envs = _unique(
        [
            get_model_env_key(primary_env) if primary_env else None,
        ]
    )
    runtime_model_name, model_env = _first_env(model_envs)
    resolved_model_name = model_name or runtime_model_name or preset.get("model_name") or ""

    extra: Dict[str, str] = {}
    extra_sources: Dict[str, str] = {}
    for field, env_key in get_provider_extra_env_keys(provider_id).items():
        value = (os.getenv(env_key) or "").strip()
        if value:
            extra[field] = value
            extra_sources[field] = env_key

    return ResolvedProviderConfig(
        provider=provider_id,
        model_name=resolved_model_name,
        api_key=api_key,
        endpoint=endpoint,
        api_key_env=api_key_env,
        endpoint_env=endpoint_env,
        model_env=model_env,
        extra=extra,
        proxy_config={
            "mode": (proxy_mode or "direct").strip().lower(),
            "custom_proxy": custom_proxy,
            "supports_proxy": catalog.get("supports_proxy", True),
        },
        source={
            "api_key": api_key_env or "missing",
            "endpoint": endpoint_env or ("preset" if endpoint else "missing"),
            "proxy_mode": proxy_mode_env or "preset",
            "custom_proxy": custom_proxy_env or "",
            "model": "request" if model_name else (model_env or ("preset" if resolved_model_name else "missing")),
            "extra": extra_sources,
        },
    )


def build_provider_runtime_status(
    configs: Optional[List[Any]] = None,
    *,
    provider_health: Optional[Any] = None,
) -> List[Dict[str, Any]]:
    """Return effective provider runtime config without exposing secrets.

    This reports what the next resolve_provider(provider, model) call will use.
    It deliberately includes env key names and endpoint sources, but never the
    API key value or custom proxy value.
    """
    statuses: List[Dict[str, Any]] = []
    db_sources = build_effective_provider_config_sources(configs) if configs is not None else {}
    health_map = normalize_provider_health_map(provider_health)
    for preset in get_api_model_presets():
        provider = normalize_provider(preset.get("provider", ""))
        model_name = str(preset.get("model_name") or "")
        catalog = PROVIDER_CATALOG.get(provider, {})
        resolved = resolve_provider(provider, model_name)
        _, failover = resolve_provider_with_failover(
            provider,
            model_name,
            provider_health=health_map,
        )
        health = provider_health_entry(provider, health_map, model_name=model_name) or {}
        health_status = provider_health_status(provider, health_map, model_name=model_name)
        health_payload = health.get("health") if isinstance(health.get("health"), dict) else {}
        db_source = db_sources.get(provider)
        db_effective = db_source.get("effective") if db_source else None

        issues: List[str] = []
        if not resolved.has_key:
            issues.append("missing_key")
        if not resolved.endpoint:
            issues.append("missing_endpoint")
        if db_source and db_source.get("keyed_enabled_config_count", 0) > 1:
            issues.append("db_multiple_keyed_enabled_configs")
        if db_source and db_source.get("enabled_endpoint_count", 0) > 1:
            issues.append("db_endpoint_conflict")

        proxy_mode = str(resolved.proxy_config.get("mode") or "direct").strip().lower()
        custom_proxy_configured = bool((resolved.proxy_config.get("custom_proxy") or "").strip())
        if proxy_mode == "custom" and not custom_proxy_configured:
            issues.append("custom_proxy_missing")
        if health_status == "error":
            issues.append("health_error")
        elif health_status == "no_key" and resolved.has_key:
            issues.append("health_no_key")

        ready = bool(resolved.has_key and resolved.endpoint and "custom_proxy_missing" not in issues)
        status = "ready" if ready else ("missing_key" if "missing_key" in issues else "incomplete")

        statuses.append(
            {
                "provider": provider,
                "label": catalog.get("label") or provider,
                "vendor": catalog.get("vendor") or "",
                "capabilities": list(catalog.get("capabilities") or []),
                "preset_name": preset.get("name") or model_name or provider,
                "model_name": model_name,
                "category": preset.get("category") or "",
                "status": status,
                "ready": ready,
                "issues": issues,
                "has_key": resolved.has_key,
                "api_key_env": resolved.api_key_env,
                "api_key_source": resolved.source.get("api_key") or "missing",
                "runtime_source": "db" if db_source else ("env" if resolved.has_key else "missing"),
                "endpoint": resolved.endpoint,
                "endpoint_env": resolved.endpoint_env,
                "endpoint_source": resolved.source.get("endpoint") or "missing",
                "operation_urls": resolved.operation_url_templates(),
                "runtime_model_name": resolved.model_name,
                "model_env": resolved.model_env,
                "model_source": resolved.source.get("model") or "missing",
                "proxy_mode": proxy_mode,
                "proxy_mode_source": resolved.source.get("proxy_mode") or "preset",
                "custom_proxy_env": resolved.source.get("custom_proxy") or "",
                "custom_proxy_configured": custom_proxy_configured,
                "supports_proxy": bool(resolved.proxy_config.get("supports_proxy", True)),
                "required_key": preset.get("required_key"),
                "health_check_url": preset.get("health_check_url"),
                "health_status": health_status or "unknown",
                "health_checked_at": health.get("checked_at"),
                "health_cached_at": health.get("cached_at"),
                "health_latency_ms": health.get("latency_ms"),
                "health_error": health_payload.get("error"),
                "fallback": provider_fallback_chain(provider),
                "failover": failover,
                "failover_active": bool(failover.get("active")),
                "failover_selected_provider": failover.get("selected_provider"),
                "failover_selected_model_name": failover.get("selected_model_name"),
                "failover_reason": failover.get("reason") or "",
                "db_effective_config_id": db_effective.get("config_id") if db_effective else None,
                "db_effective_config_name": db_effective.get("name") if db_effective else None,
                "db_effective_model_name": db_effective.get("model_name") if db_effective else None,
                "db_keyed_enabled_config_count": db_source.get("keyed_enabled_config_count", 0) if db_source else 0,
                "db_enabled_endpoint_count": db_source.get("enabled_endpoint_count", 0) if db_source else 0,
                "db_candidate_config_ids": db_source.get("candidate_config_ids", []) if db_source else [],
            }
        )
    return statuses


# ──────────────────────────────────────────────────────────────────────
# 5 家视频/音频厂商的统一"非重试错误"识别 + 用户可读错误提示
# 背景：Seedance (commit 8cee1dd7) 和 DashScope (commit 60ffec78) 已分别加固；
# 这里把同样的能力抽到 1 个核心判断 + 5 套 vendor profile，5 家共用。
# DashScope 路径走 e.code / e.http_status 属性，不经本 helper（worker.py:2429 独立）。
# ──────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class VendorErrorProfile:
    """配置驱动：识别一家厂商的"非重试错误"。

    text_markers   — 错误文本（含 exc.response.text）出现任一即非重试
    http_statuses  — exc.response.status_code 在此集合内即非重试
    local_messages — 用于 RuntimeError 本地配置（如"MiniMax 未配置"）的文本标记
    vendor_label   — 给用户的中文厂牌名（用于文案模板）
    """

    vendor: str
    text_markers: Tuple[str, ...] = ()
    http_statuses: Tuple[int, ...] = (401, 403)
    non_retryable_business_codes: Tuple[int, ...] = ()
    local_messages: Tuple[str, ...] = ()
    vendor_label: str = ""


_BUSINESS_STATUS_CODE_RE = re.compile(r"""["']?status_code["']?\s*[:=]\s*(\d+)""")


def _extract_business_status_codes(error_text: str) -> Tuple[int, ...]:
    codes: List[int] = []
    for match in _BUSINESS_STATUS_CODE_RE.finditer(error_text):
        try:
            codes.append(int(match.group(1)))
        except (TypeError, ValueError):
            continue
    return tuple(codes)


def _http_error_matches(exc: BaseException, profile: VendorErrorProfile) -> bool:
    """判断 exc 是否命中 profile 描述的非重试错误。"""
    response = getattr(exc, "response", None)
    response_text = str(getattr(response, "text", "") or "")
    error_text = f"{exc} {response_text}"
    normalized_error_text = error_text.casefold()

    if any(marker.casefold() in normalized_error_text for marker in profile.text_markers):
        return True
    if any(marker.casefold() in normalized_error_text for marker in profile.local_messages):
        return True
    if any(code in profile.non_retryable_business_codes for code in _extract_business_status_codes(error_text)):
        return True

    status = getattr(response, "status_code", None)
    if status in profile.http_statuses:
        return True
    return False


# 5 套 vendor profile 常量。
# Sora2 / Veo 走 laozhang 网关（实际是 OpenAI 兼容 + chat/completions 形态），
# 鉴权错误串可能不固定，靠多组宽词覆盖。
# 不加 "Fail"/"failed" 等宽词——避免误吞
# RuntimeError("MiniMax 任务失败: 内容审核不通过")（内容问题，应可重试或换 prompt）。
_VENDOR_ERROR_PROFILES: Dict[str, VendorErrorProfile] = {
    "sora2": VendorErrorProfile(
        vendor="sora2",
        text_markers=(
            "InvalidApiKey",
            "invalid_api_key",
            "Incorrect API key",
            "API key",
            "api_key",
            "balance",
            "quota",
            "insufficient",
            "model_not_found",
            "Model does not exist",
            "unauthorized",
            "Forbidden",
        ),
        http_statuses=(401, 403, 404),
        vendor_label="Sora2",
    ),
    "veo": VendorErrorProfile(
        vendor="veo",
        text_markers=(
            "InvalidApiKey",
            "invalid_api_key",
            "API key",
            "balance",
            "quota",
            "insufficient",
            "model_not_found",
            "unauthorized",
            "Forbidden",
        ),
        http_statuses=(401, 403, 404),
        vendor_label="Veo",
    ),
    "wan26": VendorErrorProfile(
        vendor="wan26",
        text_markers=(
            "InvalidApiKey",
            "MissingApiKey",
            "InvalidParameter",
            "ModelNotOpen",
            "quota",
            "balance",
        ),
        http_statuses=(401, 403),
        vendor_label="Wan2.6",
    ),
    "minimax": VendorErrorProfile(
        vendor="minimax",
        text_markers=(
            "balance",
            "quota",
            "InvalidApiKey",
            "MissingApiKey",
            "authorization",
            "unauthorized",
            "Forbidden",
        ),
        http_statuses=(401, 403),
        non_retryable_business_codes=(1004, 1008, 2049, 2056),
        local_messages=(
            "MINIMAX_API_KEY 未设置",
            "MiniMax 未配置",
        ),
        vendor_label="MiniMax",
    ),
    "minimax_tts": VendorErrorProfile(
        vendor="minimax_tts",
        non_retryable_business_codes=(1004, 1008, 2049, 2056),
        text_markers=(
            "balance",
            "quota",
            "MissingApiKey",
            "InvalidApiKey",
            "authorization",
        ),
        http_statuses=(),  # TTS 路径不抛 HTTPError；所有错都是 RuntimeError，靠文本识别
        local_messages=(
            "MiniMax 未配置",
            "MINIMAX 未设置",
            "未配置 MINIMAX_API_KEY",
        ),
        vendor_label="MiniMax TTS",
    ),
}


def _get_vendor_profile(vendor: str) -> VendorErrorProfile:
    """获取 vendor profile，未注册则返回兜底空 profile（永远不命中，全走默认重试）。"""
    return _VENDOR_ERROR_PROFILES.get(
        vendor,
        VendorErrorProfile(
            vendor=vendor,
            text_markers=(),
            http_statuses=(),
            vendor_label=vendor or "Vendor",
        ),
    )


def vendor_error_is_non_retryable(exc: BaseException, vendor: str) -> bool:
    """返回 True 表示该错误属于"重试无意义"类（鉴权/模型未开通/余额不足）。"""
    profile = _get_vendor_profile(vendor)
    return _http_error_matches(exc, profile)


def vendor_user_facing_error(exc: BaseException, vendor: str) -> str:
    """把厂商错误翻译成可读的中文 actionable 提示。"""
    profile = _get_vendor_profile(vendor)
    response = getattr(exc, "response", None)
    response_text = str(getattr(response, "text", "") or "")
    error_text = f"{exc} {response_text}"
    status_code = getattr(response, "status_code", None)
    label = profile.vendor_label or vendor or "Vendor"
    business_codes = set(_extract_business_status_codes(error_text))
    normalized_error_text = error_text.casefold()

    # 模型未开通（仅 wan26/seedance 这类有 model 概念的）
    if "ModelNotOpen" in error_text or "not activated the model" in error_text:
        return (
            f"{label} 模型未开通：当前 API Key 对应账号未开通所配置的视频模型，"
            f"请在厂商控制台开通模型或切换到已开通模型。"
        )
    # 余额/额度
    if business_codes.intersection({1008, 2056}) or any(
        m in normalized_error_text for m in ("balance", "quota", "insufficient")
    ):
        return (
            f"{label} 账户余额不足或额度耗尽，"
            f"请在后台厂商 API 配置中切换 Key 或充值。"
        )
    # 鉴权/Key 无效
    if (
        business_codes.intersection({1004, 2049})
        or
        "InvalidApiKey" in error_text
        or "MissingApiKey" in error_text
        or "authorization" in error_text.lower()
        or "unauthorized" in error_text.lower()
        or "Forbidden" in error_text
        or status_code in profile.http_statuses
    ):
        return (
            f"{label} API Key 无效或无权限，"
            f"请在后台厂商 API 配置中切换有效 Key。"
        )
    # 本地配置问题（"未配置"类）
    if any(m in error_text for m in profile.local_messages):
        return f"{label} 客户端未配置：{error_text[:200]}"
    # 兜底
    if response_text:
        return f"{label} 请求失败：{response_text[:500]}"
    return f"{label} 请求失败：{str(exc)[:500]}"


# ──────────────────────────────────────────────────────────────────────
# Seedance 兼容薄壳：保留原函数名 + 签名，内部转调新通用 helper。
# 已有调用点（worker.py:1287-1308）无需改动，行为完全等价。
# ──────────────────────────────────────────────────────────────────────


def _get_seedance_profile() -> VendorErrorProfile:
    """Seedance 单独走自己 profile，保留与原实现完全一致的 marker 集合。"""
    return VendorErrorProfile(
        vendor="seedance",
        text_markers=(
            "ModelNotOpen",
            "not activated the model",
            "InvalidApiKey",
            "MissingApiKey",
            "Unauthorized",
            "Forbidden",
        ),
        http_statuses=(401, 403),
        vendor_label="Seedance",
    )


def seedance_error_is_non_retryable(exc: BaseException) -> bool:
    """[兼容薄壳] Seedance 鉴权/配置错误识别，等价于 vendor_error_is_non_retryable(exc, 'seedance')。"""
    return _http_error_matches(exc, _get_seedance_profile())


def seedance_user_facing_error(exc: BaseException) -> str:
    """[兼容薄壳] Seedance 用户可读错误提示，保留与原实现文案一致。"""
    response = getattr(exc, "response", None)
    response_text = str(getattr(response, "text", "") or "")
    error_text = f"{exc} {response_text}"
    status_code = getattr(response, "status_code", None)
    if "ModelNotOpen" in error_text or "not activated the model" in error_text:
        return (
            "Seedance 模型未开通：当前 API Key 对应账号未开通所配置的视频模型，"
            "请在火山方舟开通模型或切换到已开通模型。"
        )
    if "InvalidApiKey" in error_text or "MissingApiKey" in error_text or status_code in (401, 403):
        return "Seedance API Key 无效或无权限，请在后台厂商 API 配置中切换有效 Key。"
    if response_text:
        return response_text[:500]
    return str(exc)
