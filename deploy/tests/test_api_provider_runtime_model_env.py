from __future__ import annotations

from services.api_provider_registry import get_model_env_key, get_provider_env_key
from services.api_provider_runtime import resolve_provider


def test_resolve_provider_uses_runtime_model_env(monkeypatch):
    env_key = get_provider_env_key("gemini-text")
    assert env_key
    model_env = get_model_env_key(env_key)

    monkeypatch.setenv(env_key, "test-key")
    monkeypatch.setenv(model_env, "gemini-runtime-model")

    config = resolve_provider("gemini-text")

    assert config.model_name == "gemini-runtime-model"
    assert config.model_env == model_env
    assert config.source["model"] == model_env


def test_explicit_model_overrides_runtime_model_env(monkeypatch):
    env_key = get_provider_env_key("gemini-text")
    assert env_key
    model_env = get_model_env_key(env_key)

    monkeypatch.setenv(env_key, "test-key")
    monkeypatch.setenv(model_env, "gemini-runtime-model")

    config = resolve_provider("gemini-text", "gemini-request-model")

    assert config.model_name == "gemini-request-model"
    assert config.model_env == model_env
    assert config.source["model"] == "request"
