"""Health-check helpers for admin API provider configurations."""
from __future__ import annotations

import json
import time
from datetime import datetime
from typing import Any, Awaitable, Callable, Dict, List, Optional

import aiohttp

from dao.admin.system_settings import SystemSettingsDAO
from services.api_provider_endpoints import dedupe_urls, derive_models_health_urls
from services.api_provider_registry import (
    PROVIDER_CATALOG,
    get_api_model_preset,
    get_api_provider_catalog,
    get_provider_default_endpoint,
    normalize_provider,
)
from services.api_provider_runtime import resolve_provider


ProxySettingsLoader = Callable[[], Awaitable[Dict[str, Any]]]
SessionFactory = Callable[..., Any]


class ProviderHealthNotFound(RuntimeError):
    pass


CONNECTIVITY_ONLY_STATUS = "connectivity_ok"
CONNECTIVITY_ONLY_ERROR = (
    "Metadata endpoint reachable, but generation is not verified. "
    "Run an actual generation request to confirm provider availability."
)
GENERATION_SENSITIVE_PROVIDERS = {
    "gemini-tts",
    "gemini-text",
    "gemini-image",
    "sora2",
    "veo",
    "laozhang-gpt-image",
    "laozhang-sora2",
}


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


def uses_provider_api_key_header(provider: str, urls: List[str]) -> bool:
    normalized = normalize_provider(provider)
    if normalized != "gemini-tts":
        return False

    default_endpoint = get_provider_default_endpoint(normalized).strip().rstrip("/").lower()
    if not default_endpoint:
        return False

    return any(
        (url or "").strip().rstrip("/").lower().startswith(default_endpoint)
        for url in urls
    )


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
    status: Optional[str] = None,
) -> Dict[str, Any]:
    result_status = status or ("ok" if ok else "error")
    if error == "No API key configured":
        result_status = "no_key"
    return {
        "success": True,
        "test": {
            "ok": ok,
            "status": result_status,
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


def is_provider_region_blocked(provider: str, error: Optional[str]) -> bool:
    if normalize_provider(provider) != "gemini-tts":
        return False
    text = (error or "").lower()
    return (
        "failed_precondition" in text
        and "user location is not supported" in text
    ) or "user location is not supported for the api use" in text


def is_generation_sensitive_provider(provider: str) -> bool:
    return normalize_provider(provider) in GENERATION_SENSITIVE_PROVIDERS


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
    if uses_provider_api_key_header(provider, urls_to_try):
        if "x-goog-api-key" not in {key.lower() for key in headers}:
            headers["x-goog-api-key"] = api_key
    elif "Authorization" not in headers and "authorization" not in headers:
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
                            ok = True
                            error = None
                            status = "ok"
                            if is_generation_sensitive_provider(provider):
                                ok = False
                                status = CONNECTIVITY_ONLY_STATUS
                                error = CONNECTIVITY_ONLY_ERROR
                            return api_health_result(
                                provider=provider,
                                model_name=model_name,
                                ok=ok,
                                reachable=True,
                                auth_ok=True,
                                status_code=resp.status,
                                url=url,
                                error=error,
                                urls_tried=urls_to_try,
                                status=status,
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
    status = str(test.get("status") or ("ok" if ok else "error"))
    error_text = str(test.get("error") or "")
    if is_provider_region_blocked(provider, error_text):
        status = "blocked_region"
    elif is_generation_sensitive_provider(provider) and test.get("reachable") and test.get("auth_ok"):
        status = "connectivity_ok"
    return {
        "success": True,
        "provider": provider,
        "model_name": row["model_name"] or None,
        "status": status,
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
