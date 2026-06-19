#!/usr/bin/env python3
"""Verify provider health monitor cache behavior without real Redis or HTTP."""
from __future__ import annotations

import asyncio
import copy
import json
import os
import sys
from pathlib import Path
from typing import Any


def deploy_root() -> Path:
    return Path(__file__).resolve().parents[1]


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


class FakeRedis:
    def __init__(self):
        self.store: dict[str, str] = {}
        self.ttl: dict[str, int] = {}

    async def set(self, key: str, value: str, ex: int | None = None):
        self.store[key] = value
        if ex is not None:
            self.ttl[key] = ex
        return True

    async def get(self, key: str):
        return self.store.get(key)

    async def delete(self, key: str):
        existed = key in self.store
        self.store.pop(key, None)
        self.ttl.pop(key, None)
        return 1 if existed else 0


async def main() -> int:
    root = deploy_root()
    os.chdir(root)
    sys.path.insert(0, str(root))

    import admin_api_config_routes  # noqa: PLC0415
    from services import api_config_service as config_service  # noqa: PLC0415
    from services import api_provider_health_monitor as monitor  # noqa: PLC0415

    fake_redis = FakeRedis()
    monitor.set_provider_health_redis(fake_redis)

    async def fake_check(provider: str):
        return {
            "success": True,
            "provider": provider,
            "model_name": "model-a",
            "status": "ok" if provider == "deepseek" else "no_key",
            "latency_ms": 12 if provider == "deepseek" else None,
            "checked_at": "2026-06-18T00:00:00Z",
            "health": {
                "ok": provider == "deepseek",
                "reachable": provider == "deepseek",
                "auth_ok": provider == "deepseek",
                "status_code": 200 if provider == "deepseek" else None,
                "url": "https://example.test/models" if provider == "deepseek" else None,
                "error": None if provider == "deepseek" else "No API key configured",
                "method": "GET",
                "urls_tried": ["https://example.test/models"],
            },
        }

    results = await monitor.run_provider_health_sweep(
        providers=["deepseek", "gemini-text"],
        redis_client=fake_redis,
        check_fn=fake_check,
        concurrency=2,
    )
    if len(results) != 2:
        fail(f"Expected two sweep results, got {len(results)}")
    if sorted(item["provider"] for item in results) != ["deepseek", "gemini-text"]:
        fail(f"Unexpected sweep providers: {results}")
    if fake_redis.ttl.get(monitor.provider_health_cache_key("deepseek")) is None:
        fail("Health cache did not set a TTL")

    cached = await monitor.get_cached_provider_health("deepseek", redis_client=fake_redis)
    if not cached or cached.get("status") != "ok" or cached.get("latency_ms") != 12:
        fail(f"Cached deepseek health changed: {cached}")

    if not await monitor.delete_cached_provider_health("deepseek", redis_client=fake_redis):
        fail("Health cache delete returned false for existing key")
    if await monitor.get_cached_provider_health("deepseek", redis_client=fake_redis):
        fail("Health cache delete did not remove cached provider row")
    await monitor.cache_provider_health_result(results[0], redis_client=fake_redis)

    cached_list = await monitor.list_cached_provider_health(
        ["deepseek", "gemini-text", "missing-provider"],
        redis_client=fake_redis,
    )
    if len(cached_list) != 2:
        fail(f"Expected two cached provider rows, got {cached_list}")
    rendered = json.dumps(cached_list, ensure_ascii=False)
    if "secret" in rendered.lower():
        fail("Provider health cache must not include API secrets")
    summary = monitor.summarize_provider_health_results(cached_list)
    if summary.get("total") != 2 or summary.get("ok") != 1 or summary.get("no_key") != 1:
        fail(f"Cached provider health summary changed: {summary}")
    cache_response = await admin_api_config_routes.admin_get_provider_health_cache()
    if cache_response.get("summary") != summary:
        fail(f"Admin health cache endpoint summary changed: {cache_response}")
    if len(cache_response.get("provider_health") or []) != 2:
        fail(f"Admin health cache endpoint did not return cached rows: {cache_response}")
    if "ttl_seconds" not in (cache_response.get("settings") or {}):
        fail(f"Admin health cache endpoint missing monitor settings: {cache_response}")

    rows = [
        {
            "config_id": "apicfg_deepseek",
            "name": "DeepSeek",
            "provider": "deepseek",
            "endpoint": "https://api.deepseek.com",
            "api_key_encrypted": "encrypted-key",
            "model_name": "deepseek-reasoner",
            "proxy_mode": "direct",
            "custom_proxy": "",
            "category": "text",
            "enabled": True,
            "headers": {},
        }
    ]

    class FakeDAO:
        @staticmethod
        async def list_all():
            return copy.deepcopy(rows)

    original_dao = config_service.ApiConfigDAO
    config_service.ApiConfigDAO = FakeDAO
    try:
        listed = await config_service.list_api_configs()
    finally:
        config_service.ApiConfigDAO = original_dao
        monitor.set_provider_health_redis(None)

    provider_health = listed.get("provider_health") or []
    if len(provider_health) != 2:
        fail(f"list_api_configs did not include cached provider health: {provider_health}")

    print("Provider health monitor contract OK")
    print("  cached_provider_health=2")
    print("  admin_health_cache_endpoint=1")
    print("  sweep_results=2")
    print("  api_config_response_provider_health=2")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
