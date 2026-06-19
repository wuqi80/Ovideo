"""Runtime wiring tests for MiniMax audio client."""
import os
from dataclasses import dataclass, field
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import minimax_audio


@dataclass
class FakeConfig:
    api_key: str = "runtime-minimax-key"
    endpoint: str = "https://minimax-runtime.example.test/v1"
    model_name: str = "MiniMax-Hailuo-02"
    proxy: str = "http://runtime-proxy.example.test:8080"
    extra: dict[str, str] = field(default_factory=lambda: {"group_id": "runtime-group"})

    def aiohttp_proxy(self) -> str:
        return self.proxy


def _fake_response(payload: dict, status: int = 200):
    resp = MagicMock()
    resp.status = status
    resp.json = AsyncMock(return_value=payload)
    resp.__aenter__ = AsyncMock(return_value=resp)
    resp.__aexit__ = AsyncMock(return_value=False)
    return resp


def _fake_session(get_response):
    session = MagicMock()
    session.get = MagicMock(return_value=get_response)
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    return session


def test_minimax_audio_client_uses_runtime_endpoint_proxy_and_group(monkeypatch):
    calls: list[tuple[str, str]] = []

    def fake_resolve_provider(provider: str, model_name: str | None = None) -> FakeConfig:
        calls.append((provider, model_name or ""))
        return FakeConfig()

    monkeypatch.setattr(minimax_audio, "resolve_provider", fake_resolve_provider)

    client = minimax_audio.MinimaxAudioClient()

    assert calls == [("minimax", "MiniMax-Hailuo-02")]
    assert client.api_key == "runtime-minimax-key"
    assert client.base_url == "https://minimax-runtime.example.test/v1"
    assert client._aiohttp_proxy == "http://runtime-proxy.example.test:8080"
    assert client.group_id == "runtime-group"
    assert client._group_params({"task_id": "task-1"}) == {
        "task_id": "task-1",
        "GroupId": "runtime-group",
    }


def test_minimax_audio_explicit_group_id_overrides_runtime_extra(monkeypatch):
    monkeypatch.setattr(minimax_audio, "resolve_provider", lambda *_args, **_kwargs: FakeConfig())

    client = minimax_audio.MinimaxAudioClient(group_id="explicit-group")

    assert client.group_id == "explicit-group"
    assert client._group_params() == {"GroupId": "explicit-group"}


@pytest.mark.asyncio
async def test_minimax_audio_query_sends_group_id_param(monkeypatch):
    monkeypatch.setattr(minimax_audio, "resolve_provider", lambda *_args, **_kwargs: FakeConfig())
    fake_resp = _fake_response({"status": "Success", "base_resp": {"status_code": 0}})
    fake_session_ctx = _fake_session(fake_resp)
    client = minimax_audio.MinimaxAudioClient()

    with patch("aiohttp.ClientSession", return_value=fake_session_ctx):
        result = await client.tts_query("task-1")

    assert result["status"] == "Success"
    _, kwargs = fake_session_ctx.get.call_args
    assert kwargs["params"] == {"task_id": "task-1", "GroupId": "runtime-group"}
    assert kwargs["headers"]["Authorization"] == "Bearer runtime-minimax-key"


@pytest.mark.asyncio
async def test_runtime_loader_projects_minimax_group_id_from_request_template(monkeypatch):
    from services import api_config_runtime_loader as loader
    from services.api_provider_registry import (
        get_endpoint_env_key,
        get_provider_env_key,
    )
    from services.api_provider_runtime import resolve_provider

    managed_keys = loader.managed_api_env_keys()
    saved_base = dict(loader._BASE_API_ENV_VALUES)
    saved_env = {key: os.environ.get(key) for key in managed_keys}
    env_key = get_provider_env_key("minimax")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)

    async def fake_list_enabled():
        return [
            {
                "provider": "minimax",
                "api_key_encrypted": "encrypted",
                "endpoint": "https://minimax-db.example.test/v1",
                "proxy_mode": "direct",
                "custom_proxy": "",
                "model_name": "MiniMax-Hailuo-02",
                "request_template": {"group_id": "db-group"},
            }
        ]

    try:
        for key in managed_keys:
            os.environ.pop(key, None)
            loader._BASE_API_ENV_VALUES[key] = None
        monkeypatch.setattr(loader.ApiConfigDAO, "list_enabled", staticmethod(fake_list_enabled))
        monkeypatch.setattr(loader.ApiConfigDAO, "decrypt_key", staticmethod(lambda _enc: "db-key"))

        result = await loader.load_api_configs_to_env()
        config = resolve_provider("minimax", "MiniMax-Hailuo-02")

        assert result["success"] is True
        assert os.environ[env_key] == "db-key"
        assert os.environ[endpoint_env] == "https://minimax-db.example.test/v1"
        assert os.environ["MINIMAX_GROUP_ID"] == "db-group"
        assert config.extra["group_id"] == "db-group"
    finally:
        loader._BASE_API_ENV_VALUES.clear()
        loader._BASE_API_ENV_VALUES.update(saved_base)
        for key, value in saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
