from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from services import ai_proxy_doubao_image_service as doubao_service
from services.api_config_health_service import _real_generation_request
from services.api_provider_registry import (
    DOUBAO_IMAGE_AGENT_PLAN_ENDPOINT,
    DOUBAO_IMAGE_AGENT_PLAN_MODEL,
    DOUBAO_IMAGE_PAYG_MODEL,
    DOUBAO_IMAGE_STANDARD_ENDPOINT,
    get_endpoint_env_key,
    get_model_env_key,
    get_provider_env_key,
    get_provider_model_binding_options,
    normalize_model_bindings,
    normalize_doubao_image_endpoint,
    normalize_doubao_image_model_for_endpoint,
)
from services.api_provider_runtime import resolve_provider


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
        DOUBAO_IMAGE_AGENT_PLAN_MODEL,
        DOUBAO_IMAGE_STANDARD_ENDPOINT,
    ) == DOUBAO_IMAGE_PAYG_MODEL


def test_doubao_exposes_one_image_operation_binding() -> None:
    assert get_provider_model_binding_options("doubao") == [
        {
            "operation": "generate",
            "label": "豆包图像生成",
            "model_name": DOUBAO_IMAGE_PAYG_MODEL,
        }
    ]


def test_doubao_legacy_model_binding_is_migrated_to_generate_operation() -> None:
    assert normalize_model_bindings(
        "doubao",
        [
            {
                "operation": DOUBAO_IMAGE_PAYG_MODEL,
                "label": "Doubao SeedDream 5.0 Pro",
                "model_name": DOUBAO_IMAGE_PAYG_MODEL,
            }
        ],
    ) == [
        {
            "operation": "generate",
            "label": "豆包图像生成",
            "model_name": DOUBAO_IMAGE_PAYG_MODEL,
        }
    ]


def test_doubao_runtime_uses_agent_plan_model(monkeypatch) -> None:
    env_key = get_provider_env_key("doubao")
    assert env_key
    monkeypatch.setenv(env_key, "test-agent-plan-key")
    monkeypatch.setenv(get_endpoint_env_key(env_key), DOUBAO_IMAGE_AGENT_PLAN_ENDPOINT)
    monkeypatch.setenv(get_model_env_key(env_key), DOUBAO_IMAGE_PAYG_MODEL)

    config = resolve_provider("doubao")

    assert config.endpoint == DOUBAO_IMAGE_AGENT_PLAN_ENDPOINT
    assert config.model_name == DOUBAO_IMAGE_AGENT_PLAN_MODEL


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
    assert output_type == "image"
