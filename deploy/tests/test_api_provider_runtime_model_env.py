from __future__ import annotations

import pytest

from external_api.video import minimax as minimax_video
from external_api.video import base as video_base
from external_api.video import seedance as seedance_video
from external_api.video import sora2 as sora2_video
from external_api.video import veo as veo_video
from external_api.video import wan2 as wan2_video
from services import ai_proxy_service, video_reverse_service
from services.api_provider_registry import (
    SEEDANCE_DEFAULT_MODEL_MAP,
    DASHSCOPE_DEFAULT_MODEL_MAP,
    MINIMAX_DEFAULT_VIDEO_MODEL,
    SORA2_DEFAULT_VIDEO_MODEL,
    VEO_DEFAULT_VIDEO_MODEL,
    get_endpoint_env_key,
    get_dashscope_sub_model_env_key,
    get_model_env_key,
    get_provider_env_key,
    get_seedance_sub_model_env_key,
    dashscope_vidu_reference_sub_model,
    dashscope_vidu_startend_sub_model,
    minimax_runtime_model_override,
    normalize_minimax_video_model,
    normalize_sora2_video_model,
    normalize_veo_video_model,
    sora2_runtime_model_override,
    veo_runtime_model_override,
)
from services.api_provider_runtime import (
    resolve_dashscope_default_model_name,
    resolve_dashscope_model_name,
    resolve_provider,
)


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


def test_minimax_sora2_and_veo_video_alias_helpers_live_in_registry():
    assert minimax_runtime_model_override(None) is None
    assert minimax_runtime_model_override(MINIMAX_DEFAULT_VIDEO_MODEL) is None
    assert normalize_minimax_video_model(None) == MINIMAX_DEFAULT_VIDEO_MODEL
    assert minimax_runtime_model_override("minimax-custom") == "minimax-custom"
    assert normalize_minimax_video_model("minimax-custom") == "minimax-custom"

    assert sora2_runtime_model_override(None) is None
    assert sora2_runtime_model_override(SORA2_DEFAULT_VIDEO_MODEL) is None
    assert sora2_runtime_model_override("sora-2") is None
    assert normalize_sora2_video_model("sora-2") == SORA2_DEFAULT_VIDEO_MODEL
    assert sora2_runtime_model_override("sora2-custom") == "sora2-custom"
    assert normalize_sora2_video_model("sora2-custom") == "sora2-custom"

    assert veo_runtime_model_override(None) is None
    assert veo_runtime_model_override(VEO_DEFAULT_VIDEO_MODEL) is None
    assert veo_runtime_model_override("veo-3.1") is None
    assert normalize_veo_video_model("veo-3") == VEO_DEFAULT_VIDEO_MODEL
    assert veo_runtime_model_override("veo-custom") == "veo-custom"
    assert normalize_veo_video_model("veo-custom") == "veo-custom"


def test_dashscope_vidu_sub_model_helpers_live_in_registry():
    assert dashscope_vidu_reference_sub_model(None) == "vidu-reference-q3"
    assert dashscope_vidu_reference_sub_model("q3-mix") == "vidu-reference-q3-mix"
    assert dashscope_vidu_reference_sub_model("unknown") == "vidu-reference-q3"

    assert dashscope_vidu_startend_sub_model(None) == "vidu-startend-q3-turbo"
    assert dashscope_vidu_startend_sub_model("q3-pro") == "vidu-startend-q3-pro"
    assert dashscope_vidu_startend_sub_model("unknown") == "vidu-startend-q3-turbo"


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
    status_code = 200
    text = ""

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


class _DeepseekStreamResponse:
    status_code = 200
    text = ""

    def __init__(self):
        self.closed = False

    def iter_lines(self, decode_unicode=True):
        return iter(
            [
                'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}',
                'data: {"choices":[{"delta":{"content":"stream ok"}}]}',
                "data: [DONE]",
            ]
        )

    def close(self):
        self.closed = True


class _DoubaoResponse:
    status_code = 200
    text = ""

    def json(self):
        return {"data": [{"b64_json": "ZG91YmFv"}]}


class _OpenAIImageResponse:
    status_code = 200
    text = ""

    def json(self):
        return {"data": [{"b64_json": "Z3B0LWltYWdl"}]}


class _GeneratedImageDownloadResponse:
    status_code = 200
    text = ""
    content = b"remote-image"

    def raise_for_status(self):
        return None


class _MinimaxTaskResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {"task_id": "minimax-task-1"}


class _Sora2TaskResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {"id": "sora2-video-1"}


class _VeoTaskResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {"id": "veo-video-1"}


class _SeedanceTaskResponse:
    ok = True
    status_code = 200
    text = ""

    def raise_for_status(self):
        return None

    def json(self):
        return {"id": "seedance-task-1"}


class _Wan26TaskResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {"output": {"task_id": "wan26-task-1", "task_status": "PENDING"}}


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


@pytest.mark.asyncio
async def test_gpt_image_generation_uses_runtime_endpoint(monkeypatch):
    env_key = get_provider_env_key("laozhang-gpt-image")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-gpt-image-key")
    monkeypatch.setenv(endpoint_env, "https://gpt-image-runtime.example.test/v1")

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return _OpenAIImageResponse()

    monkeypatch.setattr(ai_proxy_service.requests, "post", fake_post)

    images, model, tier = await ai_proxy_service.generate_gpt_images(
        tier="vip",
        prompt="draw",
        references=[],
        n=2,
        size="1024x1024",
        quality="high",
    )

    assert images == ["data:image/png;base64,Z3B0LWltYWdl"]
    assert model == "gpt-image-2-vip"
    assert tier == "vip"
    assert calls[0]["url"] == "https://gpt-image-runtime.example.test/v1/images/generations"
    assert calls[0]["headers"]["Authorization"] == "Bearer test-gpt-image-key"
    assert calls[0]["json"]["model"] == "gpt-image-2-vip"
    assert calls[0]["json"]["size"] == "1024x1024"


@pytest.mark.asyncio
async def test_gpt_image_edit_uses_runtime_endpoint(monkeypatch):
    env_key = get_provider_env_key("laozhang-sora2")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-official-gpt-image-key")
    monkeypatch.setenv(endpoint_env, "https://official-gpt-image-runtime.example.test/v1")

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return _OpenAIImageResponse()

    monkeypatch.setattr(ai_proxy_service.requests, "post", fake_post)

    images, model, tier = await ai_proxy_service.generate_gpt_images(
        tier="official",
        prompt="edit",
        references=[
            ai_proxy_service.GptImageReferenceInput(
                filename="reference.png",
                content=b"image-bytes",
                mime_type="image/png",
            )
        ],
        n=1,
        size="auto",
        quality="auto",
    )

    assert images == ["data:image/png;base64,Z3B0LWltYWdl"]
    assert model == "gpt-image-2"
    assert tier == "official"
    assert calls[0]["url"] == "https://official-gpt-image-runtime.example.test/v1/images/edits"
    assert calls[0]["headers"]["Authorization"] == "Bearer test-official-gpt-image-key"
    assert calls[0]["data"]["model"] == "gpt-image-2"
    assert calls[0]["files"][0][0] == "image[]"
    assert calls[0]["files"][0][1][0] == "reference.png"
    assert calls[0]["files"][0][1][2] == "image/png"


def test_generated_image_content_decodes_data_url():
    content = ai_proxy_service.generated_image_content("data:image/png;base64,ZGF0YS1pbWFnZQ==")

    assert content == b"data-image"


def test_generated_image_content_downloads_public_url(monkeypatch):
    checks = []
    calls = []

    def fake_assert_public_http_url(url):
        checks.append(url)

    def fake_get(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return _GeneratedImageDownloadResponse()

    monkeypatch.setattr(ai_proxy_service, "assert_public_http_url", fake_assert_public_http_url)
    monkeypatch.setattr(ai_proxy_service.requests, "get", fake_get)

    content = ai_proxy_service.generated_image_content("https://images.example.test/generated.png", timeout=12)

    assert content == b"remote-image"
    assert checks == ["https://images.example.test/generated.png"]
    assert calls == [{"url": "https://images.example.test/generated.png", "timeout": 12}]


def test_minimax_video_uses_runtime_model_when_worker_passes_legacy_default(monkeypatch):
    env_key = get_provider_env_key("minimax")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-minimax-key")
    monkeypatch.setenv(endpoint_env, "https://minimax-runtime.example.test/v1")
    monkeypatch.setenv(model_env, "minimax-runtime-video-model")

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _MinimaxTaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = minimax_video.MinimaxClient()
    result = client.generate_video(
        first_frame_image="https://cdn.example.test/frame.png",
        prompt="move gently",
        model=minimax_video.DEFAULT_MINIMAX_VIDEO_MODEL,
    )

    assert result == {"task_id": "minimax-task-1"}
    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://minimax-runtime.example.test/v1/video_generation"
    assert calls[0]["json"]["model"] == "minimax-runtime-video-model"


def test_minimax_video_explicit_non_default_model_overrides_runtime_model(monkeypatch):
    env_key = get_provider_env_key("minimax")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-minimax-key")
    monkeypatch.setenv(endpoint_env, "https://minimax-runtime.example.test/v1")
    monkeypatch.setenv(model_env, "minimax-runtime-video-model")

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _MinimaxTaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = minimax_video.MinimaxClient()
    client.generate_video(
        first_frame_image="https://cdn.example.test/frame.png",
        prompt="move gently",
        model="minimax-explicit-video-model",
    )

    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://minimax-runtime.example.test/v1/video_generation"
    assert calls[0]["json"]["model"] == "minimax-explicit-video-model"


def test_sora2_video_uses_runtime_model_env_when_request_omits_model(monkeypatch):
    env_key = get_provider_env_key("sora2")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-sora2-key")
    monkeypatch.setenv(endpoint_env, "https://sora2-runtime.example.test/v1")
    monkeypatch.setenv(model_env, "sora2-runtime-video-model")

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _Sora2TaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = sora2_video.Sora2Client()
    result = client.create_video_task(prompt="move gently")

    assert result == {"id": "sora2-video-1"}
    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://sora2-runtime.example.test/v1/videos"
    assert calls[0]["json"]["model"] == "sora2-runtime-video-model"


def test_sora2_video_explicit_non_default_model_overrides_runtime_model(monkeypatch):
    env_key = get_provider_env_key("sora2")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-sora2-key")
    monkeypatch.setenv(endpoint_env, "https://sora2-runtime.example.test/v1")
    monkeypatch.setenv(model_env, "sora2-runtime-video-model")

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _Sora2TaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = sora2_video.Sora2Client()
    client.create_video_task(
        prompt="move gently",
        model="sora2-explicit-video-model",
    )

    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://sora2-runtime.example.test/v1/videos"
    assert calls[0]["json"]["model"] == "sora2-explicit-video-model"


def test_sora2_video_legacy_model_env_maps_to_callable_default(monkeypatch):
    env_key = get_provider_env_key("sora2")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-sora2-key")
    monkeypatch.setenv(endpoint_env, "https://sora2-runtime.example.test/v1")
    monkeypatch.setenv(model_env, "sora-2")

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _Sora2TaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = sora2_video.Sora2Client()
    client.create_video_task(prompt="move gently")

    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://sora2-runtime.example.test/v1/videos"
    assert calls[0]["json"]["model"] == sora2_video.DEFAULT_SORA2_VIDEO_MODEL


def test_sora2_image_video_uses_shared_multipart_helper(monkeypatch, tmp_path):
    env_key = get_provider_env_key("sora2")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    image_path = tmp_path / "frame.png"
    image_path.write_bytes(b"fake-png")
    calls = []

    monkeypatch.setenv(env_key, "test-sora2-key")
    monkeypatch.setenv(endpoint_env, "https://sora2-runtime.example.test/v1")
    monkeypatch.setenv(model_env, "sora2-runtime-video-model")

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _Sora2TaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = sora2_video.Sora2Client()
    result = client.create_video_task(prompt="move gently", image_path=str(image_path))

    assert result == {"id": "sora2-video-1"}
    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://sora2-runtime.example.test/v1/videos"
    assert calls[0]["headers"]["Authorization"] == "Bearer test-sora2-key"
    assert calls[0]["data"]["model"] == "sora2-runtime-video-model"
    assert calls[0]["data"]["prompt"] == "move gently"
    assert calls[0]["files"]["input_reference"][0] == "image.png"
    assert calls[0]["files"]["input_reference"][2] == "image/png"


def test_veo_video_uses_runtime_model_env_when_request_omits_model(monkeypatch):
    env_key = get_provider_env_key("veo")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-veo-key")
    monkeypatch.setenv(endpoint_env, "https://veo-runtime.example.test/v1")
    monkeypatch.setenv(model_env, "veo-runtime-video-model")

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _VeoTaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = veo_video.VeoClient()
    result = client.create_video_task(prompt="move gently")

    assert result == {"id": "veo-video-1"}
    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://veo-runtime.example.test/v1/chat/completions"
    assert calls[0]["json"]["model"] == "veo-runtime-video-model"


def test_veo_video_explicit_non_default_model_overrides_runtime_model(monkeypatch):
    env_key = get_provider_env_key("veo")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-veo-key")
    monkeypatch.setenv(endpoint_env, "https://veo-runtime.example.test/v1")
    monkeypatch.setenv(model_env, "veo-runtime-video-model")

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _VeoTaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = veo_video.VeoClient()
    client.create_video_task(
        prompt="move gently",
        model="veo-explicit-video-model",
    )

    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://veo-runtime.example.test/v1/chat/completions"
    assert calls[0]["json"]["model"] == "veo-explicit-video-model"


def test_veo_video_legacy_model_env_maps_to_callable_default(monkeypatch):
    env_key = get_provider_env_key("veo")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-veo-key")
    monkeypatch.setenv(endpoint_env, "https://veo-runtime.example.test/v1")
    monkeypatch.setenv(model_env, "veo-3.1")

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _VeoTaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = veo_video.VeoClient()
    client.create_video_task(prompt="move gently")

    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://veo-runtime.example.test/v1/chat/completions"
    assert calls[0]["json"]["model"] == veo_video.DEFAULT_VEO_VIDEO_MODEL


def test_seedance_video_uses_standard_sub_model_runtime_env(monkeypatch):
    env_key = get_provider_env_key("seedance")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    standard_env = get_seedance_sub_model_env_key("standard")
    calls = []

    monkeypatch.setenv(env_key, "test-seedance-key")
    monkeypatch.setenv(endpoint_env, "https://seedance-runtime.example.test/tasks")
    monkeypatch.setenv(standard_env, "seedance-standard-runtime-model")

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _SeedanceTaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = seedance_video.SeedanceClient()
    task_id = client.create_video_task("standard", [{"type": "text", "text": "move gently"}])

    assert task_id == "seedance-task-1"
    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://seedance-runtime.example.test/tasks"
    assert calls[0]["json"]["model"] == "seedance-standard-runtime-model"


def test_seedance_video_uses_fast_sub_model_runtime_env(monkeypatch):
    env_key = get_provider_env_key("seedance")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    fast_env = get_seedance_sub_model_env_key("fast")
    calls = []

    monkeypatch.setenv(env_key, "test-seedance-key")
    monkeypatch.setenv(endpoint_env, "https://seedance-runtime.example.test/tasks")
    monkeypatch.setenv(fast_env, "seedance-fast-runtime-model")

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _SeedanceTaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = seedance_video.SeedanceClient()
    task_id = client.create_video_task("fast", [{"type": "text", "text": "move gently"}])

    assert task_id == "seedance-task-1"
    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://seedance-runtime.example.test/tasks"
    assert calls[0]["json"]["model"] == "seedance-fast-runtime-model"


def test_seedance_video_uses_callable_default_when_runtime_model_missing(monkeypatch):
    env_key = get_provider_env_key("seedance")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-seedance-key")
    monkeypatch.setenv(endpoint_env, "https://seedance-runtime.example.test/tasks")
    monkeypatch.delenv(model_env, raising=False)
    monkeypatch.delenv(get_seedance_sub_model_env_key("standard"), raising=False)
    monkeypatch.delenv(get_seedance_sub_model_env_key("fast"), raising=False)

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _SeedanceTaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = seedance_video.SeedanceClient()
    client.create_video_task("standard", [{"type": "text", "text": "move gently"}])

    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://seedance-runtime.example.test/tasks"
    assert calls[0]["json"]["model"] == SEEDANCE_DEFAULT_MODEL_MAP["standard"]


def test_wan26_video_uses_runtime_sub_model_env(monkeypatch):
    env_key = get_provider_env_key("dashscope")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    wan26_env = get_dashscope_sub_model_env_key("wan26")
    calls = []

    monkeypatch.setenv(env_key, "test-dashscope-key")
    monkeypatch.setenv(
        endpoint_env,
        "https://dashscope-runtime.example.test/api/v1/services/aigc/video-generation/video-synthesis",
    )
    monkeypatch.setenv(wan26_env, "wan2.6-runtime-model")

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _Wan26TaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = wan2_video.Wan26Client()
    result = client.create_video_task(prompt="move gently", img_url="https://cdn.example.test/frame.png")

    assert result["output"]["task_id"] == "wan26-task-1"
    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://dashscope-runtime.example.test/api/v1/services/aigc/video-generation/video-synthesis"
    assert calls[0]["json"]["model"] == "wan2.6-runtime-model"


def test_wan26_video_uses_callable_default_when_runtime_model_missing(monkeypatch):
    env_key = get_provider_env_key("dashscope")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []

    monkeypatch.setenv(env_key, "test-dashscope-key")
    monkeypatch.setenv(
        endpoint_env,
        "https://dashscope-runtime.example.test/api/v1/services/aigc/video-generation/video-synthesis",
    )
    monkeypatch.delenv(model_env, raising=False)
    monkeypatch.delenv(get_dashscope_sub_model_env_key("wan26"), raising=False)

    def fake_request(method, url, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _Wan26TaskResponse()

    monkeypatch.setattr(video_base.requests, "request", fake_request)

    client = wan2_video.Wan26Client()
    client.create_video_task(prompt="move gently", img_url="https://cdn.example.test/frame.png")

    assert calls[0]["method"] == "POST"
    assert calls[0]["url"] == "https://dashscope-runtime.example.test/api/v1/services/aigc/video-generation/video-synthesis"
    assert calls[0]["json"]["model"] == DASHSCOPE_DEFAULT_MODEL_MAP["wan26"]


def test_dashscope_kling_ignores_unrelated_generic_model_env(monkeypatch):
    env_key = get_provider_env_key("dashscope")
    assert env_key
    model_env = get_model_env_key(env_key)

    monkeypatch.setenv(model_env, "wan2.6-runtime-i2v")
    monkeypatch.delenv(get_dashscope_sub_model_env_key("kling-standard"), raising=False)

    assert resolve_dashscope_model_name("kling-standard") == DASHSCOPE_DEFAULT_MODEL_MAP["kling-standard"]


def test_dashscope_vidu_ignores_unrelated_generic_model_env(monkeypatch):
    env_key = get_provider_env_key("dashscope")
    assert env_key
    model_env = get_model_env_key(env_key)

    monkeypatch.setenv(model_env, DASHSCOPE_DEFAULT_MODEL_MAP["happyhorse"])
    monkeypatch.delenv(get_dashscope_sub_model_env_key("vidu-reference-q3"), raising=False)

    assert resolve_dashscope_model_name("vidu-reference-q3") == DASHSCOPE_DEFAULT_MODEL_MAP["vidu-reference-q3"]


def test_dashscope_default_model_name_resolves_through_sub_model_runtime_env(monkeypatch):
    vidu_env = get_dashscope_sub_model_env_key("vidu-reference-q3")
    monkeypatch.setenv(vidu_env, "vidu-reference-runtime-model")

    assert (
        resolve_dashscope_default_model_name(DASHSCOPE_DEFAULT_MODEL_MAP["vidu-reference-q3"])
        == "vidu-reference-runtime-model"
    )
    assert resolve_dashscope_default_model_name("custom-dashscope-model") == "custom-dashscope-model"


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


def test_deepseek_stream_uses_shared_runtime_request(monkeypatch):
    env_key = get_provider_env_key("deepseek")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    calls = []
    completed = []
    response = _DeepseekStreamResponse()

    monkeypatch.setenv(env_key, "test-deepseek-key")
    monkeypatch.setenv(endpoint_env, "https://deepseek-runtime.example.test/v1")
    monkeypatch.setenv(model_env, "deepseek-stream-runtime-model")

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return response

    monkeypatch.setattr(ai_proxy_service.requests, "post", fake_post)

    events = list(ai_proxy_service.stream_deepseek_chat(prompt="hello", on_complete=completed.append))

    assert calls[0]["url"] == "https://deepseek-runtime.example.test/v1/chat/completions"
    assert calls[0]["json"]["model"] == "deepseek-stream-runtime-model"
    assert calls[0]["json"]["stream"] is True
    assert calls[0]["stream"] is True
    assert calls[0]["headers"]["Authorization"] == "Bearer test-deepseek-key"
    assert any('"type": "reasoning"' in event for event in events)
    assert any('"content": "stream ok"' in event for event in events)
    assert events[-1] == "data: [DONE]\n\n"
    assert completed == ["stream ok"]
    assert response.closed is True


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
    assert calls[0]["json"]["temperature"] == 0.3
    assert calls[0]["json"]["messages"][0]["content"][0]["type"] == "text"
    assert calls[0]["json"]["messages"][0]["content"][1]["type"] == "image_url"
