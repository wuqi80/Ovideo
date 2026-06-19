from __future__ import annotations

import pytest

from services import ai_proxy_service, video_reverse_service
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


class _ChatResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {
            "choices": [
                {
                    "message": {
                        "content": '{"description":"shot frame","camera_description":"eye level","motion_description":"slow push"}',
                    }
                }
            ]
        }


class _DeepseekResponse:
    status_code = 200
    text = ""

    def json(self):
        return {"choices": [{"message": {"content": "deepseek ok"}}]}


class _DoubaoResponse:
    status_code = 200
    text = ""

    def json(self):
        return {"data": [{"b64_json": "ZG91YmFv"}]}


@pytest.mark.asyncio
async def test_doubao_image_uses_runtime_model_env_when_request_omits_model(monkeypatch):
    env_key = get_provider_env_key("doubao")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-ark-key")
    monkeypatch.setenv(endpoint_env, "https://doubao-runtime.example.test/api/v3/images/generations")
    monkeypatch.setenv(model_env, "doubao-runtime-image-model")

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return _DoubaoResponse()

    monkeypatch.setattr(ai_proxy_service.requests, "post", fake_post)

    images = await ai_proxy_service.generate_doubao_images(
        prompt="draw",
        reference_inputs=[],
        size="2K",
        sequential="disabled",
        count=1,
    )

    assert images == ["data:image/png;base64,ZG91YmFv"]
    assert calls[0]["url"] == "https://doubao-runtime.example.test/api/v3/images/generations"
    assert calls[0]["json"]["model"] == "doubao-runtime-image-model"


@pytest.mark.asyncio
async def test_doubao_image_explicit_model_overrides_runtime_model(monkeypatch):
    env_key = get_provider_env_key("doubao")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-ark-key")
    monkeypatch.setenv(endpoint_env, "https://doubao-runtime.example.test/api/v3/images/generations")
    monkeypatch.setenv(model_env, "doubao-runtime-image-model")

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return _DoubaoResponse()

    monkeypatch.setattr(ai_proxy_service.requests, "post", fake_post)

    images = await ai_proxy_service.generate_doubao_images(
        prompt="draw",
        reference_inputs=[],
        size="2K",
        sequential="disabled",
        count=1,
        model="doubao-explicit-image-model",
    )

    assert images == ["data:image/png;base64,ZG91YmFv"]
    assert calls[0]["url"] == "https://doubao-runtime.example.test/api/v3/images/generations"
    assert calls[0]["json"]["model"] == "doubao-explicit-image-model"


def test_deepseek_generate_text_uses_runtime_model_env_when_request_omits_model(monkeypatch):
    env_key = get_provider_env_key("deepseek")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-deepseek-key")
    monkeypatch.setenv(endpoint_env, "https://deepseek-runtime.example.test/v1")
    monkeypatch.setenv(model_env, "deepseek-runtime-model")

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return _DeepseekResponse()

    monkeypatch.setattr(ai_proxy_service.requests, "post", fake_post)

    result = ai_proxy_service.generate_deepseek_text(prompt="hello")

    assert result == "deepseek ok"
    assert calls[0]["url"] == "https://deepseek-runtime.example.test/v1/chat/completions"
    assert calls[0]["json"]["model"] == "deepseek-runtime-model"


def test_deepseek_generate_text_explicit_model_overrides_runtime_model(monkeypatch):
    env_key = get_provider_env_key("deepseek")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-deepseek-key")
    monkeypatch.setenv(endpoint_env, "https://deepseek-runtime.example.test/v1")
    monkeypatch.setenv(model_env, "deepseek-runtime-model")

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return _DeepseekResponse()

    monkeypatch.setattr(ai_proxy_service.requests, "post", fake_post)

    result = ai_proxy_service.generate_deepseek_text(
        prompt="hello",
        model="deepseek-chat",
    )

    assert result == "deepseek ok"
    assert calls[0]["url"] == "https://deepseek-runtime.example.test/v1/chat/completions"
    assert calls[0]["json"]["model"] == "deepseek-chat"


@pytest.mark.asyncio
async def test_video_reverse_uses_runtime_gemini_text_model(monkeypatch, tmp_path):
    env_key = get_provider_env_key("gemini-text")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    frame = tmp_path / "frame.jpg"
    frame.write_bytes(b"fake-jpeg")
    calls = []

    monkeypatch.setenv(env_key, "test-text-key")
    monkeypatch.setenv(endpoint_env, "https://text-runtime.example.test/v1")
    monkeypatch.setenv(model_env, "gemini-video-reverse-runtime-model")

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return _ChatResponse()

    monkeypatch.setattr("requests.post", fake_post)

    result = await video_reverse_service.analyze_segment_frames([str(frame)])

    assert result["description"] == "shot frame"
    assert calls[0]["url"] == "https://text-runtime.example.test/v1/chat/completions"
    assert calls[0]["json"]["model"] == "gemini-video-reverse-runtime-model"
