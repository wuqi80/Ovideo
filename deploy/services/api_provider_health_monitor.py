"""Background health monitor and Redis cache for API providers."""
from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Optional

from services.api_config_health_service import check_provider_health
from services.api_provider_registry import PROVIDER_CATALOG, normalize_provider

logger = logging.getLogger(__name__)

HEALTH_CACHE_PREFIX = "provider:health:"
DEFAULT_HEALTH_TTL_SECONDS = 900

ProviderHealthCheck = Callable[[str], Awaitable[Dict[str, Any]]]

_redis_client: Any = None


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


def _env_int_at_least(name: str, default: int, minimum: int) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        logger.warning("Invalid %s value, using default %s", name, default)
        return default


def provider_health_monitor_settings() -> Dict[str, int | bool]:
    return {
        "enabled": _env_bool("API_PROVIDER_HEALTH_MONITOR_ENABLED", True),
        "initial_delay_seconds": _env_int_at_least("API_PROVIDER_HEALTH_INITIAL_DELAY_SECONDS", 60, 0),
        "interval_seconds": _env_int_at_least("API_PROVIDER_HEALTH_INTERVAL_SECONDS", 300, 60),
        "ttl_seconds": _env_int_at_least("API_PROVIDER_HEALTH_TTL_SECONDS", DEFAULT_HEALTH_TTL_SECONDS, 60),
        "concurrency": _env_int_at_least("API_PROVIDER_HEALTH_CONCURRENCY", 3, 1),
    }


def set_provider_health_redis(redis_client: Any) -> None:
    global _redis_client
    _redis_client = redis_client


def provider_health_cache_key(provider: str) -> str:
    return f"{HEALTH_CACHE_PREFIX}{normalize_provider(provider)}"


def _safe_health_payload(result: Dict[str, Any]) -> Dict[str, Any]:
    payload = dict(result or {})
    provider = normalize_provider(str(payload.get("provider") or ""))
    payload["provider"] = provider
    payload.setdefault("success", True)
    payload.setdefault("cached_at", datetime.utcnow().isoformat(timespec="seconds") + "Z")
    return payload


async def cache_provider_health_result(
    result: Dict[str, Any],
    *,
    redis_client: Any = None,
    ttl_seconds: Optional[int] = None,
) -> Dict[str, Any]:
    client = redis_client if redis_client is not None else _redis_client
    payload = _safe_health_payload(result)
    provider = normalize_provider(str(payload.get("provider") or ""))
    if not client or not provider:
        return payload

    ttl = ttl_seconds or int(provider_health_monitor_settings()["ttl_seconds"])
    data = json.dumps(payload, ensure_ascii=False)
    await client.set(provider_health_cache_key(provider), data, ex=ttl)
    return payload


async def get_cached_provider_health(
    provider: str,
    *,
    redis_client: Any = None,
) -> Optional[Dict[str, Any]]:
    client = redis_client if redis_client is not None else _redis_client
    normalized = normalize_provider(provider)
    if not client or not normalized:
        return None

    raw = await client.get(provider_health_cache_key(normalized))
    if not raw:
        return None
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", errors="ignore")
    try:
        data = json.loads(str(raw))
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    data["provider"] = normalize_provider(str(data.get("provider") or normalized))
    return data


async def delete_cached_provider_health(
    provider: str,
    *,
    redis_client: Any = None,
) -> bool:
    client = redis_client if redis_client is not None else _redis_client
    normalized = normalize_provider(provider)
    if not client or not normalized:
        return False

    deleted = await client.delete(provider_health_cache_key(normalized))
    try:
        return int(deleted) > 0
    except (TypeError, ValueError):
        return bool(deleted)


async def delete_cached_provider_health_many(
    providers: Iterable[str],
    *,
    redis_client: Any = None,
) -> List[str]:
    seen: set[str] = set()
    cleared: List[str] = []
    for provider in providers:
        normalized = normalize_provider(provider)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        if await delete_cached_provider_health(normalized, redis_client=redis_client):
            cleared.append(normalized)
    return cleared


async def list_cached_provider_health(
    providers: Optional[Iterable[str]] = None,
    *,
    redis_client: Any = None,
) -> List[Dict[str, Any]]:
    provider_ids = [normalize_provider(p) for p in (providers or sorted(PROVIDER_CATALOG))]
    out: List[Dict[str, Any]] = []
    for provider in provider_ids:
        cached = await get_cached_provider_health(provider, redis_client=redis_client)
        if cached:
            out.append(cached)
    return out


def summarize_provider_health_results(results: Iterable[Dict[str, Any]]) -> Dict[str, int]:
    rows = list(results)
    summary = {"total": len(rows), "ok": 0, "error": 0, "no_key": 0, "unknown": 0}
    for item in rows:
        status = str(item.get("status") or "").strip().lower()
        if status in {"ok", "error", "no_key"}:
            summary[status] += 1
        else:
            summary["unknown"] += 1
    return summary


async def run_provider_health_sweep(
    *,
    providers: Optional[Iterable[str]] = None,
    redis_client: Any = None,
    check_fn: Optional[ProviderHealthCheck] = None,
    concurrency: Optional[int] = None,
) -> List[Dict[str, Any]]:
    provider_ids = [normalize_provider(p) for p in (providers or sorted(PROVIDER_CATALOG))]
    provider_ids = [p for p in provider_ids if p]
    if not provider_ids:
        return []

    settings = provider_health_monitor_settings()
    limit = concurrency or int(settings["concurrency"])
    ttl = int(settings["ttl_seconds"])
    checker = check_fn or check_provider_health
    sem = asyncio.Semaphore(limit)

    async def one(provider: str) -> Dict[str, Any]:
        async with sem:
            try:
                result = await checker(provider)
            except Exception as exc:
                logger.warning("Provider health check failed for %s: %s", provider, exc, exc_info=True)
                result = {
                    "success": True,
                    "provider": provider,
                    "model_name": None,
                    "status": "error",
                    "latency_ms": None,
                    "checked_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
                    "health": {
                        "ok": False,
                        "reachable": False,
                        "auth_ok": False,
                        "status_code": None,
                        "url": None,
                        "error": str(exc),
                        "method": "GET",
                        "urls_tried": [],
                    },
                }
            return await cache_provider_health_result(
                result,
                redis_client=redis_client,
                ttl_seconds=ttl,
            )

    return list(await asyncio.gather(*(one(provider) for provider in provider_ids)))


async def provider_health_monitor_loop(redis_client: Any = None) -> None:
    settings = provider_health_monitor_settings()
    if not settings["enabled"]:
        logger.info("API provider health monitor disabled by API_PROVIDER_HEALTH_MONITOR_ENABLED")
        return

    client = redis_client if redis_client is not None else _redis_client
    await asyncio.sleep(int(settings["initial_delay_seconds"]))
    while True:
        try:
            results = await run_provider_health_sweep(redis_client=client)
            ok = sum(1 for item in results if item.get("status") == "ok")
            no_key = sum(1 for item in results if item.get("status") == "no_key")
            error = sum(1 for item in results if item.get("status") == "error")
            logger.info(
                "API provider health sweep complete: total=%s ok=%s no_key=%s error=%s",
                len(results),
                ok,
                no_key,
                error,
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("API provider health sweep failed: %s", exc, exc_info=True)
        await asyncio.sleep(int(provider_health_monitor_settings()["interval_seconds"]))
