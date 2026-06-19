#!/usr/bin/env python3
"""Verify admin API config health-check service without real external calls."""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from typing import Any


def deploy_root() -> Path:
    return Path(__file__).resolve().parents[1]


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


class FakeResponse:
    def __init__(self, status: int, body: str = ""):
        self.status = status
        self._body = body

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def text(self) -> str:
        return self._body


class FakeSession:
    def __init__(self, owner: "FakeSessionFactory"):
        self.owner = owner

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def get(self, url: str, *, headers=None, proxy=None, allow_redirects=True):
        self.owner.calls.append(
            {
                "url": url,
                "headers": dict(headers or {}),
                "proxy": proxy,
                "allow_redirects": allow_redirects,
            }
        )
        index = len(self.owner.calls) - 1
        status, body = self.owner.responses[index] if index < len(self.owner.responses) else (500, "missing fake response")
        return FakeResponse(status, body)


class FakeSessionFactory:
    def __init__(self, responses: list[tuple[int, str]]):
        self.responses = responses
        self.calls: list[dict[str, Any]] = []
        self.timeout = None

    def __call__(self, *, timeout=None):
        self.timeout = timeout
        return FakeSession(self)


async def main() -> int:
    root = deploy_root()
    os.chdir(root)
    sys.path.insert(0, str(root))

    from services.api_config_health_service import (  # noqa: PLC0415
        api_config_health_urls,
        check_provider_health,
        resolve_proxy_for_request,
        test_api_config_health,
    )
    from services.api_config_service import summarize_config_test_results  # noqa: PLC0415
    from services.api_provider_endpoints import derive_models_health_urls  # noqa: PLC0415
    from services import api_provider_registry as registry  # noqa: PLC0415

    managed_keys: set[str] = set()
    for env_key in registry.PROVIDER_ENV_MAP.values():
        managed_keys.add(env_key)
        managed_keys.add(registry.get_endpoint_env_key(env_key))
        managed_keys.add(registry.get_proxy_mode_env_key(env_key))
        managed_keys.add(registry.get_custom_proxy_env_key(env_key))
        managed_keys.add(registry.get_model_env_key(env_key))
    saved_env = {key: os.environ.get(key) for key in managed_keys}
    for key in managed_keys:
        os.environ.pop(key, None)

    dashscope_row = {
        "provider": "dashscope",
        "model_name": "wan2.6-i2v",
        "endpoint": "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
        "proxy_mode": "direct",
        "custom_proxy": "",
    }
    urls = api_config_health_urls(dashscope_row)
    if urls != [
        "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
    ]:
        fail(f"Unexpected DashScope health URLs: {urls}")

    health_url_cases = [
        (
            "https://api.deepseek.com",
            "deepseek",
            ["https://api.deepseek.com/models", "https://api.deepseek.com"],
        ),
        (
            "https://api.laozhang.ai/v1/chat/completions",
            "gemini-text",
            ["https://api.laozhang.ai/v1/models", "https://api.laozhang.ai/v1/chat/completions"],
        ),
        (
            "https://ark.cn-beijing.volces.com/api/v3/images/generations",
            "doubao",
            [
                "https://ark.cn-beijing.volces.com/api/v3/models",
                "https://ark.cn-beijing.volces.com/api/v3/images/generations",
            ],
        ),
        (
            "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
            "seedance",
            [
                "https://ark.cn-beijing.volces.com/api/v3/models",
                "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
            ],
        ),
        (
            "https://self-hosted.example.test/openai/v1",
            "custom",
            ["https://self-hosted.example.test/openai/v1/models"],
        ),
    ]
    for endpoint, provider, expected in health_url_cases:
        got = derive_models_health_urls(endpoint, provider)
        if got != expected:
            fail(f"Unexpected health URLs for {provider}: {got} != {expected}")

    no_key = await test_api_config_health(dashscope_row, "")
    test = no_key.get("test") or {}
    if test.get("ok") is not False or test.get("error") != "No API key configured":
        fail(f"No-key health result changed: {test}")
    if test.get("urls_tried") != urls:
        fail("No-key health result did not report derived URLs")

    batch_summary = summarize_config_test_results(
        [
            {"test": {"ok": True, "auth_ok": True}},
            {"test": {"ok": False, "auth_ok": False}},
            {"test": {"ok": False, "error": "No API key configured"}},
            {"test": {"ok": False, "auth_ok": True, "error": "HTTP 500"}},
        ]
    )
    if batch_summary != {"total": 4, "ok": 1, "no_key": 1, "auth_error": 1, "error": 1}:
        fail(f"Batch config test summary changed: {batch_summary}")

    async def proxy_loader():
        return {"proxy_https": "http://proxy.example.test:7890"}

    proxy = await resolve_proxy_for_request("system", "", proxy_settings_loader=proxy_loader)
    if proxy != "http://proxy.example.test:7890":
        fail(f"System proxy resolution changed: {proxy}")

    deepseek_row = {
        "provider": "deepseek",
        "model_name": "deepseek-reasoner",
        "endpoint": "https://first.example.test/v1",
        "proxy_mode": "custom",
        "custom_proxy": "http://custom-proxy.example.test:8080",
        "headers": {"X-Test": "yes"},
    }
    factory = FakeSessionFactory([(401, "bad token"), (200, '{"data": []}')])
    result = await test_api_config_health(deepseek_row, "secret-key", session_factory=factory)
    test = result.get("test") or {}
    if test.get("ok") is not True or test.get("status_code") != 200:
        fail(f"Expected second fake URL to succeed: {test}")
    if len(factory.calls) != 2:
        fail(f"Expected two health calls, got {len(factory.calls)}")
    first_call = factory.calls[0]
    if first_call["headers"].get("Authorization") != "Bearer secret-key":
        fail("Health check did not add bearer Authorization header")
    if first_call["headers"].get("X-Test") != "yes":
        fail("Health check did not preserve custom headers")
    if first_call["proxy"] != "http://custom-proxy.example.test:8080":
        fail(f"Health check did not use custom proxy: {first_call['proxy']}")

    try:
        runtime_no_key = await check_provider_health("deepseek", session_factory=FakeSessionFactory([(200, "{}")]))
        if runtime_no_key.get("status") != "no_key" or runtime_no_key.get("latency_ms") is not None:
            fail(f"Provider runtime no-key status changed: {runtime_no_key}")

        os.environ["DEEPSEEK_API_KEY"] = "runtime-secret"
        os.environ["DEEPSEEK_ENDPOINT"] = "https://runtime.deepseek.example.test"
        runtime_factory = FakeSessionFactory([(200, '{"data": []}')])
        runtime_ok = await check_provider_health("deepseek", session_factory=runtime_factory)
        if runtime_ok.get("status") != "ok" or not isinstance(runtime_ok.get("latency_ms"), int):
            fail(f"Provider runtime health did not succeed: {runtime_ok}")
        if runtime_factory.calls[0]["url"] != "https://runtime.deepseek.example.test/models":
            fail(f"Provider runtime health did not use runtime endpoint: {runtime_factory.calls[0]}")
        if runtime_factory.calls[0]["headers"].get("Authorization") != "Bearer runtime-secret":
            fail("Provider runtime health did not use runtime API key")
    finally:
        for key, value in saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    print("Admin API config health contract OK")
    print(f"  dashscope_health_urls={len(urls)}")
    print(f"  derived_health_url_cases={len(health_url_cases)}")
    print("  no_key_result_ok=1")
    print("  batch_summary_ok=1")
    print(f"  fake_http_calls={len(factory.calls)}")
    print("  provider_runtime_health=1")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
