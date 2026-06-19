#!/usr/bin/env python3
"""Verify AI proxy call-level provider failover without real HTTP."""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from typing import Any, Callable


def deploy_root() -> Path:
    return Path(__file__).resolve().parents[1]


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


class FakeResponse:
    def __init__(self, payload: dict[str, Any], status_code: int = 200):
        self._payload = payload
        self.status_code = status_code
        self.text = str(payload)

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            import requests

            raise requests.HTTPError(response=self)

    def json(self) -> dict[str, Any]:
        return self._payload


class EnvGuard:
    def __init__(self, keys: set[str]):
        self.keys = keys
        self.saved = {key: os.environ.get(key) for key in keys}

    def __enter__(self):
        for key in self.keys:
            os.environ.pop(key, None)
        return self

    def __exit__(self, exc_type, exc, tb):
        for key, value in self.saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


async def run_case(
    proxy,
    *,
    env: dict[str, str],
    health_rows: list[dict[str, Any]],
    expected_health_scope: list[str],
    expected_url: str,
    expected_model: str,
    expected_auth: str,
) -> None:
    calls: list[dict[str, Any]] = []
    health_scope_calls: list[list[str]] = []

    async def fake_health(providers=None, *args, **kwargs):
        health_scope_calls.append(list(providers or []))
        return health_rows

    def fake_post(url: str, **kwargs):
        calls.append({"url": url, **kwargs})
        return FakeResponse({"choices": [{"message": {"content": "ok"}}]})

    original_health = proxy.list_cached_provider_health
    original_post = proxy.requests.post
    proxy.list_cached_provider_health = fake_health
    proxy.requests.post = fake_post
    try:
        for key, value in env.items():
            os.environ[key] = value
        text = await proxy.generate_gemini_text(prompt="hello", system_prompt="system", temperature=0.3)
    finally:
        proxy.list_cached_provider_health = original_health
        proxy.requests.post = original_post

    if text != "ok":
        fail(f"Unexpected generated text: {text}")
    if len(calls) != 1:
        fail(f"Expected one HTTP call, got {len(calls)}")
    if health_scope_calls != [expected_health_scope]:
        fail(f"Unexpected health scope: {health_scope_calls} != {[expected_health_scope]}")
    call = calls[0]
    if call["url"] != expected_url:
        fail(f"Unexpected URL: {call['url']} != {expected_url}")
    payload = call.get("json") or {}
    if payload.get("model") != expected_model:
        fail(f"Unexpected model: {payload.get('model')} != {expected_model}")
    headers = call.get("headers") or {}
    if headers.get("Authorization") != expected_auth:
        fail(f"Unexpected Authorization header: {headers.get('Authorization')} != {expected_auth}")


async def main() -> int:
    root = deploy_root()
    os.chdir(root)
    sys.path.insert(0, str(root))

    from services import api_provider_registry as registry  # noqa: PLC0415
    from services import ai_proxy_service as proxy  # noqa: PLC0415

    if proxy.provider_health_scope_for_failover("gemini-text") != ["gemini-text", "deepseek"]:
        fail(f"Gemini text failover health scope changed: {proxy.provider_health_scope_for_failover('gemini-text')}")
    if proxy.provider_health_scope_for_failover("deepseek") != ["deepseek"]:
        fail(f"DeepSeek health scope should not include unrelated providers: {proxy.provider_health_scope_for_failover('deepseek')}")

    managed_env = set()
    for env_key in registry.PROVIDER_ENV_MAP.values():
        managed_env.add(env_key)
        managed_env.add(registry.get_endpoint_env_key(env_key))
        managed_env.add(registry.get_proxy_mode_env_key(env_key))
        managed_env.add(registry.get_custom_proxy_env_key(env_key))

    with EnvGuard(managed_env):
        await run_case(
            proxy,
            env={"DEEPSEEK_API_KEY": "deepseek-key"},
            health_rows=[
                {"provider": "gemini-text", "status": "error"},
                {"provider": "deepseek", "status": "ok"},
            ],
            expected_health_scope=["gemini-text", "deepseek"],
            expected_url="https://api.deepseek.com/chat/completions",
            expected_model="deepseek-reasoner",
            expected_auth="Bearer deepseek-key",
        )

    with EnvGuard(managed_env):
        await run_case(
            proxy,
            env={
                "GEMINI_TEXT_API_KEY": "gemini-key",
                "DEEPSEEK_API_KEY": "deepseek-key",
            },
            health_rows=[
                {"provider": "gemini-text", "status": "ok"},
                {"provider": "deepseek", "status": "ok"},
            ],
            expected_health_scope=["gemini-text", "deepseek"],
            expected_url="https://api.laozhang.ai/v1/chat/completions",
            expected_model="gemini-2.5-flash",
            expected_auth="Bearer gemini-key",
        )

    print("AI proxy failover contract OK")
    print("  failover_health_scope_from_registry=1")
    print("  gemini_text_failover_to_deepseek=1")
    print("  gemini_text_primary_stays_when_healthy=1")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
