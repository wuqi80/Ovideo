"""Runtime resolver for external API provider configuration.

The admin API writes DB configurations into environment variables through
load_api_configs_to_env(). This module deliberately reads env values on every
call so key/endpoint updates can take effect without restarting the service.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from services.api_provider_registry import (
    PROVIDER_CATALOG,
    get_api_model_preset,
    get_api_model_presets,
    get_custom_proxy_env_key,
    get_endpoint_env_key,
    get_provider_env_key,
    get_proxy_mode_env_key,
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


def normalize_provider_health_map(provider_health: Optional[Any]) -> ProviderHealthMap:
    if not provider_health:
        return {}
    if isinstance(provider_health, dict):
        items = provider_health.values() if all(isinstance(v, dict) for v in provider_health.values()) else []
    elif isinstance(provider_health, list):
        items = provider_health
    else:
        items = []

    out: ProviderHealthMap = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        provider = normalize_provider(str(item.get("provider") or ""))
        if provider:
            out[provider] = dict(item)
    return out


def provider_health_status(provider: str, provider_health: Optional[Any] = None) -> Optional[str]:
    health = normalize_provider_health_map(provider_health).get(normalize_provider(provider))
    status = str(health.get("status") or "").strip().lower() if health else ""
    return status or None


def provider_is_down(provider: str, provider_health: Optional[Any] = None) -> bool:
    return provider_health_status(provider, provider_health) in {"error"}


def provider_is_usable(provider: str, provider_health: Optional[Any] = None) -> bool:
    status = provider_health_status(provider, provider_health)
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
    if provider_is_down(config.provider, provider_health):
        reasons.append("health_error")
    if not is_primary and provider_health_status(config.provider, provider_health) == "no_key":
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
            "health_status": provider_health_status(primary.provider, health_map),
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
                "health_status": provider_health_status(fallback.provider, health_map),
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

    return ResolvedProviderConfig(
        provider=provider_id,
        model_name=model_name or preset.get("model_name") or "",
        api_key=api_key,
        endpoint=endpoint,
        api_key_env=api_key_env,
        endpoint_env=endpoint_env,
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
        health = health_map.get(provider) or {}
        health_status = provider_health_status(provider, health_map)
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
