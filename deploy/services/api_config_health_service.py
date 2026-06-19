"""Health-check helpers for admin API provider configurations."""
from __future__ import annotations

import json
import time
from datetime import datetime
from typing import Any, Awaitable, Callable, Dict, List, Optional

import aiohttp

from dao_system_settings import SystemSettingsDAO
from services.api_provider_endpoints import dedupe_urls, derive_models_health_urls
from services.api_provider_registry import (
    PROVIDER_CATALOG,
    get_api_model_preset,
    get_api_provider_catalog,
    normalize_provider,
)
from services.api_provider_runtime import resolve_provider


ProxySettingsLoader = Callable[[], Awaitable[Dict[str, Any]]]
SessionFactory = Callable[..., Any]


class ProviderHealthNotFound(RuntimeError):
    pass


def _jsonb_to_python(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def resolve_aiohttp_proxy(proxy_mode: str, custom_proxy: str) -> Optional[str]:
    mode = (proxy_mode or "direct").lower().strip()
    if mode == "direct":
        return None
    if mode == "custom" and custom_proxy.strip():
        return custom_proxy.strip()
    if mode == "system":
        return None
    return None


async def resolve_proxy_for_request(
    proxy_mode: str,
    custom_proxy: str,
    *,
    proxy_settings_loader: Optional[ProxySettingsLoader] = None,
) -> Optional[str]:
    direct = resolve_aiohttp_proxy(proxy_mode, custom_proxy)
    if direct is not None or (proxy_mode or "").lower() != "system":
        return direct

    loader = proxy_settings_loader or SystemSettingsDAO.get_proxy_settings
    settings = await loader() or {}
    for key in (
        "proxy_https",
        "proxy_http",
        "https_proxy",
        "http_proxy",
        "all_proxy",
    ):
        val = settings.get(key) or settings.get(key.upper())
        if val:
            return str(val).strip()
    return None


def provider_catalog_item(provider: str) -> Dict[str, Any]:
    normalized = (provider or "").strip().lower()
    for item in get_api_provider_catalog():
        if (item.get("provider") or "").strip().lower() == normalized:
            return item
    return {}


def models_url_from_endpoint(endpoint: str, provider: str = "") -> List[str]:
    return derive_models_health_urls(endpoint, provider)


def api_config_health_urls(row: Dict[str, Any]) -> List[str]:
    provider = (row.get("provider") or "").strip().lower()
    model_name = (row.get("model_name") or "").strip() or None
    endpoint = (row.get("endpoint") or "").strip()
    preset = get_api_model_preset(provider, model_name) or {}
    catalog = provider_catalog_item(provider)

    candidates: List[str] = []
    candidates.extend(models_url_from_endpoint(endpoint, provider))
    candidates.append(str(preset.get("health_check_url") or ""))
    candidates.append(str(catalog.get("health_check_url") or ""))
    candidates.extend(models_url_from_endpoint(str(preset.get("endpoint") or ""), provider))
    return dedupe_urls(candidates)


def api_health_result(
    *,
    provider: str,
    model_name: str,
    ok: bool,
    reachable: bool,
    auth_ok: bool,
    status_code: Optional[int],
    url: Optional[str],
    error: Optional[str],
    urls_tried: List[str],
) -> Dict[str, Any]:
    return {
        "success": True,
        "test": {
            "ok": ok,
            "reachable": reachable,
            "auth_ok": auth_ok,
            "status_code": status_code,
            "url": url,
            "error": error,
            "provider": provider or None,
            "model_name": model_name or None,
            "method": "GET",
            "urls_tried": urls_tried,
            "checked_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        },
    }


async def test_api_config_health(
    row: Dict[str, Any],
    api_key: str,
    *,
    proxy_settings_loader: Optional[ProxySettingsLoader] = None,
    session_factory: Optional[SessionFactory] = None,
) -> Dict[str, Any]:
    provider = str(row.get("provider") or "")
    model_name = str(row.get("model_name") or "")
    urls_to_try = api_config_health_urls(row)

    if not api_key:
        return api_health_result(
            provider=provider,
            model_name=model_name,
            ok=False,
            reachable=False,
            auth_ok=False,
            status_code=None,
            url=None,
            error="No API key configured",
            urls_tried=urls_to_try,
        )

    hdrs_raw = _jsonb_to_python(row.get("headers")) or {}
    headers: Dict[str, str] = {}
    if isinstance(hdrs_raw, dict):
        headers = {str(k): str(v) for k, v in hdrs_raw.items()}
    if "Authorization" not in headers and "authorization" not in headers:
        headers["Authorization"] = f"Bearer {api_key}"

    proxy = await resolve_proxy_for_request(
        str(row.get("proxy_mode") or "direct"),
        str(row.get("custom_proxy") or ""),
        proxy_settings_loader=proxy_settings_loader,
    )
    timeout = aiohttp.ClientTimeout(total=20)
    last_error: Optional[str] = None
    last_status: Optional[int] = None
    tried_url: Optional[str] = None
    reachable = False
    auth_ok = False

    factory = session_factory or aiohttp.ClientSession
    try:
        async with factory(timeout=timeout) as session:
            for url in urls_to_try:
                if not url:
                    continue
                tried_url = url
                try:
                    async with session.get(
                        url, headers=headers, proxy=proxy, allow_redirects=True
                    ) as resp:
                        last_status = resp.status
                        reachable = resp.status < 500
                        auth_ok = resp.status not in (401, 403)
                        if 200 <= resp.status < 300:
                            return api_health_result(
                                provider=provider,
                                model_name=model_name,
                                ok=True,
                                reachable=True,
                                auth_ok=True,
                                status_code=resp.status,
                                url=url,
                                error=None,
                                urls_tried=urls_to_try,
                            )
                        body = (await resp.text())[:300]
                        if resp.status in (401, 403):
                            last_error = f"Authentication failed (HTTP {resp.status})"
                        else:
                            last_error = f"HTTP {resp.status}"
                        if body:
                            last_error = f"{last_error}: {body}"
                except aiohttp.ClientError as e:
                    last_error = str(e)
    except Exception as e:
        return api_health_result(
            provider=provider,
            model_name=model_name,
            ok=False,
            reachable=reachable,
            auth_ok=auth_ok,
            status_code=last_status,
            url=tried_url,
            error=str(e),
            urls_tried=urls_to_try,
        )

    return api_health_result(
        provider=provider,
        model_name=model_name,
        ok=False,
        reachable=reachable,
        auth_ok=auth_ok,
        status_code=last_status,
        url=tried_url,
        error=last_error or "Request failed",
        urls_tried=urls_to_try,
    )


async def check_provider_health(
    provider_id: str,
    *,
    model_name: Optional[str] = None,
    proxy_settings_loader: Optional[ProxySettingsLoader] = None,
    session_factory: Optional[SessionFactory] = None,
) -> Dict[str, Any]:
    """Health-check the effective runtime config for a provider.

    Unlike test_api_config_health(), this uses resolve_provider(), so it proves
    the hot-reloaded DB/env state that real generation calls will see.
    """
    provider = normalize_provider(provider_id)
    if provider not in PROVIDER_CATALOG:
        raise ProviderHealthNotFound(f"Unknown provider: {provider_id}")

    preset = get_api_model_preset(provider, model_name) or {}
    resolved_model = model_name or preset.get("model_name") or None
    config = resolve_provider(provider, resolved_model)
    row = {
        "provider": provider,
        "model_name": config.model_name or resolved_model or "",
        "endpoint": config.endpoint,
        "proxy_mode": config.proxy_config.get("mode") or "direct",
        "custom_proxy": config.proxy_config.get("custom_proxy") or "",
        "headers": {},
    }
    urls_to_try = api_config_health_urls(row)
    checked_at = datetime.utcnow().isoformat(timespec="seconds") + "Z"

    if not config.has_key:
        return {
            "success": True,
            "provider": provider,
            "model_name": row["model_name"] or None,
            "status": "no_key",
            "latency_ms": None,
            "checked_at": checked_at,
            "health": {
                "ok": False,
                "reachable": False,
                "auth_ok": False,
                "status_code": None,
                "url": None,
                "error": "No API key configured",
                "method": "GET",
                "urls_tried": urls_to_try,
            },
        }

    t0 = time.perf_counter()
    result = await test_api_config_health(
        row,
        config.api_key,
        proxy_settings_loader=proxy_settings_loader,
        session_factory=session_factory,
    )
    latency_ms = int((time.perf_counter() - t0) * 1000)
    test = result.get("test") or {}
    ok = bool(test.get("ok"))
    return {
        "success": True,
        "provider": provider,
        "model_name": row["model_name"] or None,
        "status": "ok" if ok else "error",
        "latency_ms": latency_ms,
        "checked_at": test.get("checked_at") or checked_at,
        "health": {
            "ok": ok,
            "reachable": bool(test.get("reachable")),
            "auth_ok": bool(test.get("auth_ok")),
            "status_code": test.get("status_code"),
            "url": test.get("url"),
            "error": test.get("error"),
            "method": test.get("method") or "GET",
            "urls_tried": test.get("urls_tried") or urls_to_try,
        },
    }
