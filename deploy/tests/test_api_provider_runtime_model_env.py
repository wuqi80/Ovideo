from __future__ import annotations

import pytest

from services import ai_proxy_service
from services.api_provider_registry import get_endpoint_env_key, get_model_env_key, get_provider_env_key
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


class _ImageResponse:
    status_code = 200
    text = ""

    def raise_for_status(self):
        return None

    def json(self):
        return {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "inlineData": {
                                    "mimeType": "image/png",
                                    "data": "aW1hZ2U=",
                                }
                            }
                        ]
                    }
                }
            ]
        }


@pytest.mark.asyncio
async def test_gemini_image_uses_runtime_model_env_when_request_omits_model(monkeypatch):
    env_key = get_provider_env_key("gemini-image")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-image-key")
    monkeypatch.setenv(endpoint_env, "https://image-runtime.example.test/v1beta")
    monkeypatch.setenv(model_env, "gemini-runtime-image-model")

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return _ImageResponse()

    monkeypatch.setattr(ai_proxy_service.requests, "post", fake_post)

    images, model = await ai_proxy_service.generate_gemini_images(
        parts=[{"text": "draw"}],
        requested_model=None,
        aspect_ratio="16:9",
        image_size="2K",
    )

    assert images == ["data:image/png;base64,aW1hZ2U="]
    assert model == "gemini-runtime-image-model"
    assert calls[0]["url"] == "https://image-runtime.example.test/v1beta/models/gemini-runtime-image-model:generateContent"
    assert calls[0]["json"]["generationConfig"]["imageConfig"]["aspectRatio"] == "16:9"


@pytest.mark.asyncio
async def test_gemini_image_explicit_request_model_overrides_runtime_model(monkeypatch):
    env_key = get_provider_env_key("gemini-image")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-image-key")
    monkeypatch.setenv(endpoint_env, "https://image-runtime.example.test/v1beta")
    monkeypatch.setenv(model_env, "gemini-runtime-image-model")

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return _ImageResponse()

    monkeypatch.setattr(ai_proxy_service.requests, "post", fake_post)

    images, model = await ai_proxy_service.generate_gemini_images(
        parts=[{"text": "draw"}],
        requested_model="gemini-3-pro-image-preview",
        aspect_ratio="1:1",
        image_size="4K",
    )

    assert images == ["data:image/png;base64,aW1hZ2U="]
    assert model == "gemini-3.1-flash-image-preview"
    assert calls[0]["url"] == "https://image-runtime.example.test/v1beta/models/gemini-3.1-flash-image-preview:generateContent"
    assert calls[0]["json"]["generationConfig"]["imageConfig"]["imageSize"] == "4K"
