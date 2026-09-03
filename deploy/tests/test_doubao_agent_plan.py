from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from services import ai_proxy_doubao_image_service as doubao_service
from services.api_config_health_service import _real_generation_request
from services.api_provider_registry import (
    DOUBAO_IMAGE_AGENT_PLAN_ENDPOINT,
    DOUBAO_IMAGE_AGENT_PLAN_MODEL,
    DOUBAO_IMAGE_DEFAULT_MODEL,
    DOUBAO_IMAGE_PAYG_MODEL,
    DOUBAO_IMAGE_STANDARD_ENDPOINT,
    SEEDANCE_AGENT_PLAN_ENDPOINT,
    SEEDANCE_AGENT_PLAN_MODEL_MAP,
    SEEDANCE_DEFAULT_MODEL_MAP,
    get_endpoint_env_key,
    get_model_env_key,
    get_provider_env_key,
    get_provider_model_binding_options,
    normalize_model_bindings,
    normalize_doubao_image_endpoint,
    normalize_doubao_image_model_for_endpoint,
    normalize_seedance_endpoint,
    normalize_seedance_model_for_endpoint,
)
from services.api_provider_runtime import resolve_provider
from services.ai_proxy_types import AIProxyUpstreamError


def test_doubao_access_modes_use_distinct_seedream_lite_model_names() -> None:
    assert DOUBAO_IMAGE_AGENT_PLAN_MODEL == "doubao-seedream-5.0-lite"
    assert DOUBAO_IMAGE_PAYG_MODEL == "doubao-seedream-5-0-lite-260128"
    assert DOUBAO_IMAGE_DEFAULT_MODEL == DOUBAO_IMAGE_PAYG_MODEL


def test_doubao_agent_plan_normalizes_endpoint_and_model() -> None:
    endpoint = normalize_doubao_image_endpoint(
        "https://ark.cn-beijing.volces.com/api/plan/"
    )

    assert endpoint == DOUBAO_IMAGE_AGENT_PLAN_ENDPOINT
    assert normalize_doubao_image_model_for_endpoint(
        DOUBAO_IMAGE_PAYG_MODEL,
        endpoint,
    ) == DOUBAO_IMAGE_AGENT_PLAN_MODEL
    assert normalize_doubao_image_model_for_endpoint(
        "doubao-seedream-5-0",
        endpoint,
    ) == DOUBAO_IMAGE_AGENT_PLAN_MODEL
    assert normalize_doubao_image_model_for_endpoint(
        "doubao-seedream-5.0-lite",
        endpoint,
    ) == DOUBAO_IMAGE_AGENT_PLAN_MODEL
    assert normalize_doubao_image_model_for_endpoint(
        "doubao-seedream-5-0-lite-260128",
        endpoint,
    ) == DOUBAO_IMAGE_AGENT_PLAN_MODEL
    assert normalize_doubao_image_model_for_endpoint(
        DOUBAO_IMAGE_AGENT_PLAN_MODEL,
        DOUBAO_IMAGE_STANDARD_ENDPOINT,
    ) == DOUBAO_IMAGE_PAYG_MODEL


def test_ark_endpoint_normalization_accepts_missing_scheme() -> None:
    doubao_endpoint = normalize_doubao_image_endpoint(
        "ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks"
    )
    seedance_endpoint = normalize_seedance_endpoint(
        "ark.cn-beijing.volces.com/api/plan/"
    )

    assert doubao_endpoint == DOUBAO_IMAGE_AGENT_PLAN_ENDPOINT
    assert normalize_doubao_image_model_for_endpoint(
        DOUBAO_IMAGE_PAYG_MODEL,
        doubao_endpoint,
    ) == DOUBAO_IMAGE_AGENT_PLAN_MODEL
    assert seedance_endpoint == SEEDANCE_AGENT_PLAN_ENDPOINT
    assert normalize_seedance_model_for_endpoint(
        SEEDANCE_DEFAULT_MODEL_MAP["standard"],
        seedance_endpoint,
        "standard",
    ) == SEEDANCE_AGENT_PLAN_MODEL_MAP["standard"]


def test_doubao_exposes_one_image_operation_binding() -> None:
    assert get_provider_model_binding_options("doubao") == [
        {
            "operation": "generate",
            "label": "Doubao-Seedream-5.0-lite · 参考图生图模型",
            "model_name": DOUBAO_IMAGE_DEFAULT_MODEL,
        }
    ]


def test_doubao_legacy_model_binding_is_migrated_to_generate_operation() -> None:
    bindings = normalize_model_bindings(
        "doubao",
        [
            {
                "operation": DOUBAO_IMAGE_PAYG_MODEL,
                "label": "Doubao SeedDream 5.0 Pro",
                "model_name": DOUBAO_IMAGE_PAYG_MODEL,
            }
        ],
    )

    assert {
        (item["scope"], item["operation"], item["model_name"])
        for item in bindings
    } == {
        ("workflow", "generate", DOUBAO_IMAGE_PAYG_MODEL),
        ("studio", "generate", DOUBAO_IMAGE_DEFAULT_MODEL),
    }


def test_doubao_runtime_uses_agent_plan_model(monkeypatch) -> None:
    env_key = get_provider_env_key("doubao")
    assert env_key
    monkeypatch.setenv(env_key, "test-agent-plan-key")
    monkeypatch.setenv(get_endpoint_env_key(env_key), DOUBAO_IMAGE_AGENT_PLAN_ENDPOINT)
    monkeypatch.setenv(get_model_env_key(env_key), DOUBAO_IMAGE_PAYG_MODEL)

    config = resolve_provider("doubao")

    assert config.endpoint == DOUBAO_IMAGE_AGENT_PLAN_ENDPOINT
    assert config.model_name == DOUBAO_IMAGE_AGENT_PLAN_MODEL


def test_doubao_default_runtime_keeps_payg_endpoint_and_model(monkeypatch) -> None:
    env_key = get_provider_env_key("doubao")
    assert env_key
    monkeypatch.delenv(get_endpoint_env_key(env_key), raising=False)
    monkeypatch.delenv(get_model_env_key(env_key), raising=False)

    config = resolve_provider("doubao", DOUBAO_IMAGE_DEFAULT_MODEL)

    assert config.endpoint == DOUBAO_IMAGE_STANDARD_ENDPOINT
    assert config.model_name == DOUBAO_IMAGE_PAYG_MODEL


def test_doubao_image_size_normalizes_frontend_k_values() -> None:
    assert doubao_service.normalize_doubao_image_size("2K") == "2k"
    assert doubao_service.normalize_doubao_image_size("3K") == "3k"
    assert doubao_service.normalize_doubao_image_size("4K") == "4k"
    assert doubao_service.normalize_doubao_image_size("1K") == "1024x1024"
    assert doubao_service.normalize_doubao_image_size("1280*720") == "1280x720"
    assert doubao_service.normalize_doubao_image_size(" 1080 X 1920 ") == "1080x1920"


def test_doubao_standard_size_expands_to_provider_minimum_pixels() -> None:
    assert doubao_service.normalize_doubao_standard_image_size("2048x1152") == "2560x1440"
    assert doubao_service.normalize_doubao_standard_image_size("1152x2048") == "1440x2560"
    assert doubao_service.normalize_doubao_standard_image_size("1024x1024") == "1920x1920"
    assert doubao_service.normalize_doubao_standard_image_size("4096x2304") == "4096x2304"


def test_doubao_agent_plan_size_keeps_valid_k_and_expands_small_values() -> None:
    assert doubao_service._normalize_agent_plan_size("2K") == "2k"
    assert doubao_service._normalize_agent_plan_size("1K") == "2048x2048"
    assert doubao_service._normalize_agent_plan_size("1024x1024") == "2048x2048"
    assert doubao_service._normalize_agent_plan_size("2048x1152") == "2736x1536"
    assert doubao_service._normalize_agent_plan_size("4096x4096") == "4096x4096"


@pytest.mark.asyncio
async def test_doubao_agent_plan_card_projects_runtime_env(monkeypatch) -> None:
    from services import api_config_runtime_loader as loader

    env_key = get_provider_env_key("doubao")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    for key in (env_key, endpoint_env, model_env):
        monkeypatch.delenv(key, raising=False)
        monkeypatch.setitem(loader._BASE_API_ENV_VALUES, key, None)

    row = {
        "config_id": "doubao-agent-plan-card",
        "provider": "doubao",
        "endpoint": "https://ark.cn-beijing.volces.com/api/plan/",
        "api_key_encrypted": "enc:plan-key",
        "model_name": DOUBAO_IMAGE_PAYG_MODEL,
        "model_bindings": [
            {"operation": "generate", "model_name": DOUBAO_IMAGE_PAYG_MODEL}
        ],
        "enabled": True,
    }
    monkeypatch.setattr(loader.ApiConfigDAO, "list_enabled", AsyncMock(return_value=[row]))
    monkeypatch.setattr(
        loader.ApiConfigDAO,
        "decrypt_key",
        staticmethod(lambda value: value.split(":", 1)[1]),
    )

    result = await loader.load_api_configs_to_env()

    assert result["success"] is True
    assert loader.os.environ[endpoint_env] == DOUBAO_IMAGE_AGENT_PLAN_ENDPOINT
    assert loader.os.environ[model_env] == DOUBAO_IMAGE_AGENT_PLAN_MODEL


@pytest.mark.asyncio
async def test_doubao_agent_plan_is_preferred_when_payg_is_also_enabled(monkeypatch) -> None:
    from services import api_config_runtime_loader as loader

    env_key = get_provider_env_key("doubao")
    assert env_key
    endpoint_env = get_endpoint_env_key(env_key)
    model_env = get_model_env_key(env_key)
    for key in (env_key, endpoint_env, model_env):
        monkeypatch.delenv(key, raising=False)
        monkeypatch.setitem(loader._BASE_API_ENV_VALUES, key, None)

    payg_row = {
        "config_id": "doubao-payg-card",
        "name": "Doubao PAYG",
        "provider": "doubao",
        "endpoint": DOUBAO_IMAGE_STANDARD_ENDPOINT,
        "api_key_encrypted": "enc:payg-key",
        "model_name": DOUBAO_IMAGE_PAYG_MODEL,
        "model_bindings": [
            {"operation": "generate", "model_name": DOUBAO_IMAGE_PAYG_MODEL}
        ],
        "enabled": True,
    }
    plan_row = {
        "config_id": "doubao-agent-plan-card",
        "name": "Doubao Agent Plan",
        "provider": "doubao",
        "endpoint": DOUBAO_IMAGE_AGENT_PLAN_ENDPOINT,
        "api_key_encrypted": "enc:plan-key",
        "model_name": DOUBAO_IMAGE_PAYG_MODEL,
        "model_bindings": [
            {"operation": "generate", "model_name": DOUBAO_IMAGE_PAYG_MODEL}
        ],
        "enabled": True,
    }
    monkeypatch.setattr(
        loader.ApiConfigDAO,
        "list_enabled",
        AsyncMock(return_value=[plan_row, payg_row]),
    )
    monkeypatch.setattr(
        loader.ApiConfigDAO,
        "decrypt_key",
        staticmethod(lambda value: value.split(":", 1)[1]),
    )

    result = await loader.load_api_configs_to_env()

    assert result["success"] is True
    assert loader.os.environ[env_key] == "plan-key"
    assert loader.os.environ[endpoint_env] == DOUBAO_IMAGE_AGENT_PLAN_ENDPOINT
    assert loader.os.environ[model_env] == DOUBAO_IMAGE_AGENT_PLAN_MODEL


@pytest.mark.asyncio
async def test_doubao_generation_forces_agent_plan_model(monkeypatch) -> None:
    config = SimpleNamespace(
        api_key="test-agent-plan-key",
        endpoint=DOUBAO_IMAGE_AGENT_PLAN_ENDPOINT,
        model_name=DOUBAO_IMAGE_PAYG_MODEL,
    )
    captured = {}

    async def fake_post(*, config, payload):
        captured.update(payload)
        return ["data:image/png;base64,dGVzdA=="]

    monkeypatch.setattr(doubao_service, "resolve_provider", lambda provider, model=None: config)
    monkeypatch.setattr(doubao_service, "_post_doubao_image_generation", fake_post)

    images = await doubao_service.generate_doubao_images(
        prompt="draw",
        reference_inputs=[],
        size="1024x1024",
        sequential="disabled",
        count=1,
        model=DOUBAO_IMAGE_PAYG_MODEL,
    )

    assert images == ["data:image/png;base64,dGVzdA=="]
    assert captured["model"] == DOUBAO_IMAGE_AGENT_PLAN_MODEL
    assert captured["size"] == "2048x2048"


@pytest.mark.asyncio
async def test_doubao_generation_lowercases_frontend_k_size(monkeypatch) -> None:
    config = SimpleNamespace(
        api_key="test-ark-key",
        endpoint=DOUBAO_IMAGE_STANDARD_ENDPOINT,
        model_name=DOUBAO_IMAGE_PAYG_MODEL,
    )
    captured = {}

    async def fake_post(*, config, payload):
        captured.update(payload)
        return ["data:image/png;base64,dGVzdA=="]

    monkeypatch.setattr(doubao_service, "resolve_provider", lambda provider, model=None: config)
    monkeypatch.setattr(doubao_service, "_post_doubao_image_generation", fake_post)

    await doubao_service.generate_doubao_images(
        prompt="draw",
        reference_inputs=[],
        size="2K",
        sequential="disabled",
        count=1,
        model=DOUBAO_IMAGE_PAYG_MODEL,
    )

    assert captured["size"] == "2k"


@pytest.mark.asyncio
async def test_doubao_payg_generation_expands_small_explicit_size(monkeypatch) -> None:
    config = SimpleNamespace(
        api_key="test-ark-key",
        endpoint=DOUBAO_IMAGE_STANDARD_ENDPOINT,
        model_name=DOUBAO_IMAGE_PAYG_MODEL,
    )
    captured = {}

    async def fake_post(*, config, payload):
        captured.update(payload)
        return ["data:image/png;base64,dGVzdA=="]

    monkeypatch.setattr(doubao_service, "resolve_provider", lambda provider, model=None: config)
    monkeypatch.setattr(doubao_service, "_post_doubao_image_generation", fake_post)

    await doubao_service.generate_doubao_images(
        prompt="draw",
        reference_inputs=[],
        size="2048x1152",
        sequential="disabled",
        count=1,
        model=DOUBAO_IMAGE_PAYG_MODEL,
    )

    assert captured["size"] == "2560x1440"


@pytest.mark.asyncio
async def test_doubao_sensitive_geography_prompt_retries_once_with_abstract_wording(monkeypatch) -> None:
    config = SimpleNamespace(
        api_key="test-ark-key",
        endpoint=DOUBAO_IMAGE_STANDARD_ENDPOINT,
        model_name=DOUBAO_IMAGE_PAYG_MODEL,
    )
    payloads = []

    async def fake_post(*, config, payload):
        payloads.append(payload)
        if len(payloads) == 1:
            raise AIProxyUpstreamError(
                "豆包生成失败",
                upstream='{"error":{"code":"InputTextSensitiveContentDetected","message":"The input text may contain sensitive information."}}',
            )
        return ["data:image/png;base64,dGVzdA=="]

    monkeypatch.setattr(doubao_service, "resolve_provider", lambda provider, model=None: config)
    monkeypatch.setattr(doubao_service, "_post_doubao_image_generation", fake_post)

    images = await doubao_service.generate_doubao_images(
        prompt="全国高校地图前，屏幕以中国地图为底，各省份坐标以发光圆点标注。",
        reference_inputs=[],
        size="2560x1440",
        sequential="disabled",
        count=1,
        model=DOUBAO_IMAGE_PAYG_MODEL,
    )

    assert images == ["data:image/png;base64,dGVzdA=="]
    assert len(payloads) == 2
    assert "中国地图" in payloads[0]["prompt"]
    assert "中国地图" not in payloads[1]["prompt"]
    assert "抽象地区轮廓" in payloads[1]["prompt"]
    assert "虚构的抽象几何轮廓" in payloads[1]["prompt"]


@pytest.mark.asyncio
async def test_doubao_sensitive_prompt_without_safe_rewrite_returns_actionable_422(monkeypatch) -> None:
    config = SimpleNamespace(
        api_key="test-ark-key",
        endpoint=DOUBAO_IMAGE_STANDARD_ENDPOINT,
        model_name=DOUBAO_IMAGE_PAYG_MODEL,
    )
    calls = 0

    async def fake_post(*, config, payload):
        nonlocal calls
        calls += 1
        raise AIProxyUpstreamError(
            "豆包生成失败",
            upstream='{"error":{"code":"InputTextSensitiveContentDetected"}}',
        )

    monkeypatch.setattr(doubao_service, "resolve_provider", lambda provider, model=None: config)
    monkeypatch.setattr(doubao_service, "_post_doubao_image_generation", fake_post)

    with pytest.raises(AIProxyUpstreamError) as exc_info:
        await doubao_service.generate_doubao_images(
            prompt="provider rejected wording",
            reference_inputs=[],
            size="2560x1440",
            sequential="disabled",
            count=1,
            model=DOUBAO_IMAGE_PAYG_MODEL,
        )

    assert calls == 1
    assert exc_info.value.status_code == 422
    assert "内容安全审核" in exc_info.value.detail
    assert "本次不扣创作点数" in exc_info.value.detail


@pytest.mark.asyncio
async def test_doubao_generation_normalizes_bare_seedream_5_agent_plan_model(monkeypatch) -> None:
    config = SimpleNamespace(
        api_key="test-agent-plan-key",
        endpoint=DOUBAO_IMAGE_AGENT_PLAN_ENDPOINT,
        model_name=DOUBAO_IMAGE_PAYG_MODEL,
    )
    captured = {}

    async def fake_post(*, config, payload):
        captured.update(payload)
        return ["data:image/png;base64,dGVzdA=="]

    monkeypatch.setattr(doubao_service, "resolve_provider", lambda provider, model=None: config)
    monkeypatch.setattr(doubao_service, "_post_doubao_image_generation", fake_post)

    await doubao_service.generate_doubao_images(
        prompt="draw",
        reference_inputs=[],
        size="1024x1024",
        sequential="disabled",
        count=1,
        model="doubao-seedream-5-0",
    )

    assert captured["model"] == DOUBAO_IMAGE_AGENT_PLAN_MODEL


@pytest.mark.asyncio
async def test_doubao_agent_plan_send_boundary_forces_lite_model(monkeypatch) -> None:
    config = SimpleNamespace(
        api_key="test-agent-plan-key",
        endpoint=DOUBAO_IMAGE_AGENT_PLAN_ENDPOINT,
        url_for=lambda path="": DOUBAO_IMAGE_AGENT_PLAN_ENDPOINT,
        requests_kwargs=lambda: {},
    )
    captured = {}

    async def fake_post(**kwargs):
        captured.update(kwargs)
        return {"data": [{"url": "https://cdn.example.test/seedream.png"}]}

    monkeypatch.setattr(doubao_service, "_post_json_request_async", fake_post)

    images = await doubao_service._post_doubao_image_generation(
        config=config,
        payload={
            "model": "doubao-seedream-5-0",
            "prompt": "draw",
            "size": "1024x1024",
            "watermark": False,
        },
    )

    assert images == ["https://cdn.example.test/seedream.png"]
    assert captured["url"] == DOUBAO_IMAGE_AGENT_PLAN_ENDPOINT
    assert captured["payload"]["model"] == DOUBAO_IMAGE_AGENT_PLAN_MODEL
    assert captured["payload"]["prompt"] == "draw"
    assert captured["payload"]["size"] == "2048x2048"
    assert "content" not in captured["payload"]


def test_doubao_real_generation_test_uses_agent_plan_model() -> None:
    url, body, output_type = _real_generation_request(
        "doubao",
        {
            "endpoint": DOUBAO_IMAGE_AGENT_PLAN_ENDPOINT,
            "model_name": DOUBAO_IMAGE_PAYG_MODEL,
        },
    )

    assert url == DOUBAO_IMAGE_AGENT_PLAN_ENDPOINT
    assert body["model"] == DOUBAO_IMAGE_AGENT_PLAN_MODEL
    assert body["prompt"] == "A simple blue square icon on a white background."
    assert "content" not in body
    assert body["size"] == "2048x2048"
    assert output_type == "image"


def test_doubao_agent_plan_task_response_parser_extracts_images() -> None:
    images = doubao_service.parse_doubao_image_task_response(
        {
            "id": "cgt-test",
            "status": "succeeded",
            "content": {
                "image_url": "https://cdn.example.test/seedream.png",
                "images": [{"url": "https://cdn.example.test/seedream-2.png"}],
            },
        }
    )

    assert images == [
        "https://cdn.example.test/seedream.png",
        "https://cdn.example.test/seedream-2.png",
    ]


@pytest.mark.asyncio
async def test_doubao_agent_plan_generation_posts_image_payload(monkeypatch) -> None:
    endpoint = DOUBAO_IMAGE_AGENT_PLAN_ENDPOINT
    submitted = {}

    config = SimpleNamespace(
        api_key="test-agent-plan-key",
        endpoint=endpoint,
        model_name=DOUBAO_IMAGE_PAYG_MODEL,
        url_for=lambda path="": endpoint if not path else f"{endpoint}/{path.strip('/')}",
        url_for_operation=lambda operation, **params: f"{endpoint}/{params['task_id']}",
        requests_kwargs=lambda: {},
    )

    async def fake_post(**kwargs):
        submitted.update(kwargs)
        return {"data": [{"url": "https://cdn.example.test/seedream.png"}]}

    monkeypatch.setattr(doubao_service, "resolve_provider", lambda provider, model=None: config)
    monkeypatch.setattr(doubao_service, "_post_json_request_async", fake_post)

    images = await doubao_service.generate_doubao_images(
        prompt="draw",
        reference_inputs=[],
        size="1024x1024",
        sequential="disabled",
        count=1,
        model=DOUBAO_IMAGE_PAYG_MODEL,
    )

    assert images == ["https://cdn.example.test/seedream.png"]
    assert submitted["url"] == endpoint
    assert submitted["payload"]["model"] == DOUBAO_IMAGE_AGENT_PLAN_MODEL
    assert submitted["payload"]["prompt"] == "draw"
    assert "content" not in submitted["payload"]
    assert submitted["payload"]["size"] == "2048x2048"
    assert submitted["payload"]["response_format"] == "url"


@pytest.mark.asyncio
async def test_doubao_agent_plan_generation_maps_reference_images_to_content(monkeypatch) -> None:
    endpoint = DOUBAO_IMAGE_AGENT_PLAN_ENDPOINT
    submitted = {}

    config = SimpleNamespace(
        api_key="test-agent-plan-key",
        endpoint=endpoint,
        model_name=DOUBAO_IMAGE_PAYG_MODEL,
        url_for=lambda path="": endpoint if not path else f"{endpoint}/{path.strip('/')}",
        url_for_operation=lambda operation, **params: f"{endpoint}/{params['task_id']}",
        requests_kwargs=lambda: {},
    )

    async def fake_post(**kwargs):
        submitted.update(kwargs)
        return {"data": [{"url": "https://cdn.example.test/seedream.png"}]}

    monkeypatch.setattr(doubao_service, "resolve_provider", lambda provider, model=None: config)
    monkeypatch.setattr(doubao_service, "_post_json_request_async", fake_post)

    await doubao_service.generate_doubao_images(
        prompt="redraw",
        reference_inputs=["https://cdn.example.test/ref.png"],
        size="2048x2048",
        sequential="disabled",
        count=1,
        model=DOUBAO_IMAGE_PAYG_MODEL,
    )

    assert submitted["payload"]["prompt"] == "redraw"
    assert submitted["payload"]["image"] == "https://cdn.example.test/ref.png"
    assert "content" not in submitted["payload"]
