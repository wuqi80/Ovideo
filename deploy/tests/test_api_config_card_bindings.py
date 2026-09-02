from __future__ import annotations

from copy import deepcopy
from unittest.mock import AsyncMock

import pytest


def test_deepseek_binding_options_match_frontend_model_choices():
    from services.api_provider_registry import get_provider_model_binding_options

    assert get_provider_model_binding_options("deepseek") == [
        {
            "operation": "deepseek-reasoner",
            "label": "DeepSeek Reasoner",
            "model_name": "deepseek-v4-pro",
        },
        {
            "operation": "deepseek-chat",
            "label": "DeepSeek Chat",
            "model_name": "deepseek-v4-flash",
        },
    ]


def test_deepseek_legacy_reasoner_card_is_completed_with_chat_binding():
    from services.api_provider_registry import normalize_model_bindings

    bindings = normalize_model_bindings(
        "deepseek",
        [
            {
                "operation": "deepseek-reasoner",
                "label": "DeepSeek Reasoner",
                "model_name": "deepseek-reasoner",
            }
        ],
    )

    assert {
        (item["scope"], item["operation"], item["model_name"])
        for item in bindings
    } == {
        ("workflow", "deepseek-reasoner", "deepseek-v4-pro"),
        ("workflow", "deepseek-chat", "deepseek-v4-flash"),
        ("studio", "deepseek-reasoner", "deepseek-v4-pro"),
        ("studio", "deepseek-chat", "deepseek-v4-flash"),
    }


@pytest.mark.asyncio
async def test_one_enabled_deepseek_card_projects_all_bound_models(monkeypatch):
    from services import api_config_runtime_loader as loader

    for env_key in (
        "DEEPSEEK_API_KEY",
        "DEEPSEEK_MODEL_REASONER",
        "DEEPSEEK_MODEL_CHAT",
        "DEEPSEEK_MODEL_REASONER_STUDIO",
        "DEEPSEEK_MODEL_CHAT_STUDIO",
    ):
        monkeypatch.delenv(env_key, raising=False)
        monkeypatch.setitem(loader._BASE_API_ENV_VALUES, env_key, None)

    row = {
        "config_id": "deepseek-card",
        "name": "DeepSeek API",
        "provider": "deepseek",
        "endpoint": "https://api.deepseek.com",
        "api_key_encrypted": "enc:key-1",
        "model_name": "deepseek-reasoner",
        "model_bindings": [
            {
                "operation": "deepseek-reasoner",
                "label": "DeepSeek Reasoner",
                "model_name": "deepseek-reasoner",
            },
            {
                "operation": "deepseek-chat",
                "label": "DeepSeek Chat",
                "model_name": "deepseek-chat",
            },
        ],
        "proxy_mode": "direct",
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
    assert loader.os.environ["DEEPSEEK_API_KEY"] == "key-1"
    assert loader.os.environ["DEEPSEEK_MODEL_REASONER"] == "deepseek-v4-pro"
    assert loader.os.environ["DEEPSEEK_MODEL_CHAT"] == "deepseek-v4-flash"
    assert loader.os.environ["DEEPSEEK_MODEL_REASONER_STUDIO"] == "deepseek-v4-pro"
    assert loader.os.environ["DEEPSEEK_MODEL_CHAT_STUDIO"] == "deepseek-v4-flash"


def test_seedance_binding_options_are_explicit():
    from services.api_provider_registry import get_provider_model_binding_options

    options = get_provider_model_binding_options("seedance")

    assert [(item["operation"], item["model_name"]) for item in options] == [
        ("standard", "doubao-seedance-2-0-260128"),
        ("fast", "doubao-seedance-2-0-fast-260128"),
        ("mini", "doubao-seedance-2-0-mini-260615"),
    ]
    assert [item["label"] for item in options] == [
        "Seedance 2.0 · 多模态标准视频模型",
        "Seedance 2.0 Fast · 多模态快速视频模型",
        "Seedance 2.0 Mini · 多模态简化视频模型",
    ]


def test_dashscope_binding_labels_match_frontend_model_wording():
    from services.api_provider_registry import get_provider_model_binding_options

    options = get_provider_model_binding_options("dashscope")
    labels = {item["operation"]: item["label"] for item in options}

    assert labels["wan26"] == "Wan 2.6 · 镜头叙事视频模型"
    assert labels["kling-standard"] == "Kling V3 · 全能音画视频模型"
    assert labels["kling-omni"] == "Kling V3 · 全能音画视频模型"
    assert labels["vidu-reference-q3"] == "Vidu Q3 · 多参考视频模型"
    assert labels["vidu-startend-q2-pro"] == "Vidu Q3 · 多参考视频模型"
    assert labels["happyhorse"] == "HappyHorse 1.0 · 角色一致性视频模型"


def test_seedance_agent_plan_normalizes_endpoint_and_builtin_models():
    from services.api_provider_registry import (
        SEEDANCE_AGENT_PLAN_ENDPOINT,
        normalize_seedance_endpoint,
        normalize_seedance_model_for_endpoint,
    )

    endpoint = normalize_seedance_endpoint("https://ark.cn-beijing.volces.com/api/plan/")

    assert endpoint == SEEDANCE_AGENT_PLAN_ENDPOINT
    assert normalize_seedance_model_for_endpoint(
        "doubao-seedance-2-0-260128",
        endpoint,
        "standard",
    ) == "doubao-seedance-1.5-pro"
    assert normalize_seedance_model_for_endpoint(
        "doubao-seedance-2-0-fast-260128",
        endpoint,
        "fast",
    ) == "doubao-seedance-1.5-pro"
    assert normalize_seedance_model_for_endpoint(
        "doubao-seedance-2-0-mini-260615",
        endpoint,
        "mini",
    ) == "doubao-seedance-1.5-pro"

    standard_endpoint = normalize_seedance_endpoint("https://ark.cn-beijing.volces.com/api/v3")
    assert standard_endpoint == "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks"
    assert normalize_seedance_model_for_endpoint(
        "doubao-seedance-2.0",
        standard_endpoint,
        "standard",
    ) == "doubao-seedance-2-0-260128"


def test_seedance_provider_catalog_exposes_both_billing_channels():
    from services.api_provider_registry import get_api_provider_catalog

    seedance = next(item for item in get_api_provider_catalog() if item["provider"] == "seedance")

    assert [item["mode"] for item in seedance["access_modes"]] == ["standard", "agent_plan"]


def test_minimax_provider_catalog_exposes_domestic_and_international_channels():
    from services.api_provider_registry import (
        get_api_provider_catalog,
        get_provider_model_binding_options,
        normalize_model_bindings,
    )

    minimax = next(item for item in get_api_provider_catalog() if item["provider"] == "minimax")

    assert [item["mode"] for item in minimax["access_modes"]] == ["domestic", "international"]
    assert [item["endpoint"] for item in minimax["access_modes"]] == [
        "https://api.minimaxi.com/v1",
        "https://api.minimax.io/v1",
    ]
    assert "text" in minimax["capabilities"]
    assert get_provider_model_binding_options("minimax")[-1] == {
        "operation": "minimax-m3",
        "label": "MiniMax M3 文本",
        "model_name": "MiniMax-M3",
    }

    legacy_bindings = normalize_model_bindings(
        "minimax",
        [{"operation": "video-standard", "model_name": "MiniMax-Hailuo-2.3"}],
    )
    assert ("minimax-m3", "MiniMax-M3") in {
        (item["operation"], item["model_name"])
        for item in legacy_bindings
    }


@pytest.mark.asyncio
async def test_one_enabled_minimax_card_projects_m3_without_changing_video_primary(monkeypatch):
    from services import api_config_runtime_loader as loader

    for env_key in (
        "MINIMAX_API_KEY",
        "MINIMAX_MODEL",
        "MINIMAX_MODEL_M3",
    ):
        monkeypatch.delenv(env_key, raising=False)
        monkeypatch.setitem(loader._BASE_API_ENV_VALUES, env_key, None)

    row = {
        "config_id": "minimax-card",
        "name": "MiniMax API",
        "provider": "minimax",
        "endpoint": "https://api.minimaxi.com/v1",
        "api_key_encrypted": "enc:key-plan",
        "model_name": "MiniMax-Hailuo-2.3",
        "model_bindings": [
            {
                "operation": "video-standard",
                "label": "金丹 (Hailuo 2.3)",
                "model_name": "MiniMax-Hailuo-2.3",
            },
            {
                "operation": "minimax-m3",
                "label": "练气 (MiniMax M3 文本)",
                "model_name": "MiniMax-M3",
            },
        ],
        "proxy_mode": "direct",
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
    assert loader.os.environ["MINIMAX_API_KEY"] == "key-plan"
    assert loader.os.environ["MINIMAX_MODEL"] == "MiniMax-Hailuo-2.3"
    assert loader.os.environ["MINIMAX_MODEL_M3"] == "MiniMax-M3"


def test_legacy_default_binding_is_recovered_to_known_model_operation():
    from services.api_provider_registry import normalize_model_bindings

    bindings = normalize_model_bindings(
        "gemini-image",
        [{"operation": "default", "model_name": "gemini-3.1-flash-image-preview"}],
    )

    assert bindings[0]["operation"] == "gemini-3-pro-image-preview"
    assert {item["operation"] for item in bindings} == {
        "gemini-2.5-flash-image",
        "gemini-3-pro-image-preview",
    }


def test_gemini_image_binding_options_match_frontend_image_controls():
    from services.api_provider_registry import get_provider_model_binding_options

    options = get_provider_model_binding_options("gemini-image")

    assert options == [
        {
            "operation": "gemini-2.5-flash-image",
            "label": "Gemini 2.5 Flash Image",
            "model_name": "gemini-2.5-flash-image",
        },
        {
            "operation": "gemini-3-pro-image-preview",
            "label": "Gemini 3.1 Flash Image Preview",
            "model_name": "gemini-3.1-flash-image-preview",
        },
    ]


def test_gemini_image_legacy_operation_is_recovered_by_model_name():
    from services.api_provider_registry import normalize_model_bindings

    bindings = normalize_model_bindings(
        "gemini-image",
        [
            {
                "operation": "gemini-3.1-flash-image-preview",
                "label": "Gemini 3.1 Flash (图像)",
                "model_name": "gemini-3.1-flash-image-preview",
            }
        ],
    )

    assert {item["operation"] for item in bindings} == {
        "gemini-2.5-flash-image",
        "gemini-3-pro-image-preview",
    }


def test_doubao_binding_label_matches_frontend_image_control():
    from services.api_provider_registry import DOUBAO_IMAGE_DEFAULT_MODEL, get_provider_model_binding_options

    assert get_provider_model_binding_options("doubao") == [
        {
            "operation": "generate",
            "label": "Doubao-Seedream-5.0-lite · 参考图生图模型",
            "model_name": DOUBAO_IMAGE_DEFAULT_MODEL,
        }
    ]


def test_standby_api_card_with_same_bindings_is_not_reported_as_model_conflict():
    from services.api_provider_registry import summarize_api_provider_configs

    bindings = [
        {"operation": "standard", "model_name": "seedance-standard"},
        {"operation": "fast", "model_name": "seedance-fast"},
    ]
    summaries = summarize_api_provider_configs(
        [
            {
                "config_id": "active",
                "provider": "seedance",
                "api_key_encrypted": "key-a",
                "model_bindings": bindings,
                "enabled": True,
            },
            {
                "config_id": "standby",
                "provider": "seedance",
                "api_key_encrypted": "key-b",
                "model_bindings": bindings,
                "enabled": False,
            },
        ]
    )
    seedance = next(item for item in summaries if item["provider"] == "seedance")

    assert seedance["status"] == "ready"
    assert "duplicate_models" not in seedance["issues"]
    assert "some_configs_disabled" not in seedance["issues"]


@pytest.mark.asyncio
async def test_one_enabled_seedance_card_projects_all_bound_models(monkeypatch):
    from services import api_config_runtime_loader as loader

    for env_key in ("SEEDANCE_API_KEY", "SEEDANCE_MODEL_STANDARD", "SEEDANCE_MODEL_FAST", "SEEDANCE_MODEL_MINI"):
        monkeypatch.delenv(env_key, raising=False)
        monkeypatch.setitem(loader._BASE_API_ENV_VALUES, env_key, None)

    row = {
        "config_id": "seedance-card",
        "name": "Seedance API",
        "provider": "seedance",
        "endpoint": "https://ark.example.test/tasks",
        "api_key_encrypted": "enc:key-1",
        "model_name": "doubao-seedance-2-0-260128",
        "model_bindings": [
            {
                "operation": "standard",
                "label": "飞升",
                "model_name": "seedance-standard-bound",
            },
            {
                "operation": "fast",
                "label": "渡劫",
                "model_name": "seedance-fast-bound",
            },
            {
                "operation": "mini",
                "label": "元婴",
                "model_name": "seedance-mini-bound",
            },
        ],
        "proxy_mode": "direct",
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
    assert loader.os.environ["SEEDANCE_API_KEY"] == "key-1"
    assert loader.os.environ["SEEDANCE_MODEL_STANDARD"] == "seedance-standard-bound"
    assert loader.os.environ["SEEDANCE_MODEL_FAST"] == "seedance-fast-bound"
    assert loader.os.environ["SEEDANCE_MODEL_MINI"] == "seedance-mini-bound"


@pytest.mark.asyncio
async def test_agent_plan_card_projects_plan_endpoint_and_models(monkeypatch):
    from services import api_config_runtime_loader as loader

    for env_key in (
        "SEEDANCE_API_KEY",
        "SEEDANCE_ENDPOINT",
        "SEEDANCE_MODEL_STANDARD",
        "SEEDANCE_MODEL_FAST",
        "SEEDANCE_MODEL_MINI",
    ):
        monkeypatch.delenv(env_key, raising=False)
        monkeypatch.setitem(loader._BASE_API_ENV_VALUES, env_key, None)

    row = {
        "config_id": "agent-plan-card",
        "provider": "seedance",
        "endpoint": "https://ark.cn-beijing.volces.com/api/plan/",
        "api_key_encrypted": "enc:plan-key",
        "model_name": "doubao-seedance-2-0-260128",
        "model_bindings": [
            {"operation": "standard", "model_name": "doubao-seedance-2-0-260128"},
            {"operation": "fast", "model_name": "doubao-seedance-2-0-fast-260128"},
            {"operation": "mini", "model_name": "doubao-seedance-2-0-mini-260615"},
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
    assert loader.os.environ["SEEDANCE_ENDPOINT"] == (
        "https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks"
    )
    assert loader.os.environ["SEEDANCE_MODEL_STANDARD"] == "doubao-seedance-1.5-pro"
    assert loader.os.environ["SEEDANCE_MODEL_FAST"] == "doubao-seedance-1.5-pro"
    assert loader.os.environ["SEEDANCE_MODEL_MINI"] == "doubao-seedance-1.5-pro"


@pytest.mark.asyncio
async def test_same_provider_and_key_cannot_create_a_second_card(monkeypatch):
    from services import api_config_service as service

    rows = [
        {
            "config_id": "existing-card",
            "provider": "seedance",
            "api_key_encrypted": "enc:test-placeholder-duplicate-key",
            "enabled": True,
        }
    ]
    monkeypatch.setattr(service.ApiConfigDAO, "list_all", AsyncMock(return_value=rows))
    monkeypatch.setattr(
        service.ApiConfigDAO,
        "decrypt_key",
        staticmethod(lambda value: value.split(":", 1)[1]),
    )

    with pytest.raises(service.ApiConfigCreateFailed, match="already has a card"):
        await service.create_api_config(
            name="duplicate",
            provider="seedance",
            endpoint="https://ark.example.test/tasks",
            api_key="test-placeholder-duplicate-key",
            model_bindings=[
                {
                    "operation": "fast",
                    "model_name": "doubao-seedance-2-0-fast-260128",
                }
            ],
        )


@pytest.mark.asyncio
async def test_create_agent_plan_card_persists_plan_route_and_models(monkeypatch):
    from services import api_config_service as service

    captured = {}

    async def fake_create(**fields):
        captured.update(fields)
        return {
            **fields,
            "config_id": "agent-plan-card",
            "api_key_encrypted": "enc:plan-key",
        }

    monkeypatch.setattr(service.ApiConfigDAO, "list_all", AsyncMock(return_value=[]))
    monkeypatch.setattr(service.ApiConfigDAO, "create", fake_create)
    monkeypatch.setattr(service.ApiConfigDAO, "decrypt_key", staticmethod(lambda value: "plan-key"))
    monkeypatch.setattr(service, "invalidate_provider_health_for_items", AsyncMock(return_value=[]))

    result = await service.create_api_config(
        name="Agent Plan",
        provider="seedance",
        endpoint="https://ark.cn-beijing.volces.com/api/plan/",
        api_key="test-placeholder-credential",
        model_bindings=[
            {"operation": "standard", "model_name": "doubao-seedance-2-0-260128"},
            {"operation": "fast", "model_name": "doubao-seedance-2-0-fast-260128"},
            {"operation": "mini", "model_name": "doubao-seedance-2-0-mini-260615"},
        ],
        reload_api_env=AsyncMock(return_value=True),
    )

    assert result["success"] is True
    assert captured["endpoint"] == (
        "https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks"
    )
    assert {
        (item["scope"], item["operation"], item["model_name"])
        for item in captured["model_bindings"]
    } == {
        ("workflow", "standard", "doubao-seedance-1.5-pro"),
        ("workflow", "fast", "doubao-seedance-1.5-pro"),
        ("workflow", "mini", "doubao-seedance-1.5-pro"),
        ("studio", "standard", "doubao-seedance-1.5-pro"),
        ("studio", "fast", "doubao-seedance-1.5-pro"),
        ("studio", "mini", "doubao-seedance-1.5-pro"),
    }


@pytest.mark.asyncio
async def test_repair_merges_duplicate_key_cards_and_keeps_bindings(monkeypatch):
    from services import api_config_service as service

    rows = [
        {
            "config_id": "standard-card",
            "name": "old standard",
            "provider": "seedance",
            "api_key_encrypted": "enc:shared-key",
            "model_name": "doubao-seedance-2-0-260128",
            "model_bindings": [
                {"operation": "standard", "model_name": "doubao-seedance-2-0-260128"}
            ],
            "enabled": False,
        },
        {
            "config_id": "fast-card",
            "name": "active fast",
            "provider": "seedance",
            "api_key_encrypted": "enc:shared-key",
            "model_name": "doubao-seedance-2-0-fast-260128",
            "model_bindings": [
                {"operation": "fast", "model_name": "doubao-seedance-2-0-fast-260128"}
            ],
            "enabled": True,
        },
    ]

    class FakeDAO:
        decrypt_key = staticmethod(lambda value: value.split(":", 1)[1])

        @staticmethod
        async def list_all():
            return deepcopy(rows)

        @staticmethod
        async def update(config_id, **fields):
            row = next(item for item in rows if item["config_id"] == config_id)
            row.update(fields)
            return deepcopy(row)

        @staticmethod
        async def delete(config_id):
            index = next(index for index, item in enumerate(rows) if item["config_id"] == config_id)
            rows.pop(index)
            return True

    monkeypatch.setattr(service, "ApiConfigDAO", FakeDAO)
    monkeypatch.setattr(service, "invalidate_provider_health_for_items", AsyncMock(return_value=[]))

    result = await service.repair_api_config_provider_conflicts(
        reload_api_env=AsyncMock(return_value=True),
    )

    assert result["total_merged_cards"] == 1
    assert result["deleted_duplicate_config_ids"] == ["standard-card"]
    assert [row["config_id"] for row in rows] == ["fast-card"]
    assert {item["operation"] for item in rows[0]["model_bindings"]} == {"standard", "fast", "mini"}


@pytest.mark.asyncio
async def test_repair_absorbs_keyless_model_placeholders_into_real_card(monkeypatch):
    from services import api_config_service as service

    rows = [
        {
            "config_id": "plan-card",
            "name": "Seedance Agent Plan",
            "provider": "seedance",
            "endpoint": "https://ark.cn-beijing.volces.com/api/plan/",
            "api_key_encrypted": "enc:plan-key",
            "model_name": "doubao-seedance-2-0-260128",
            "model_bindings": [
                {"operation": "standard", "model_name": "doubao-seedance-2-0-260128"}
            ],
            "enabled": True,
        },
        {
            "config_id": "fast-placeholder",
            "name": "Seedance Fast preset",
            "provider": "seedance",
            "endpoint": "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
            "api_key_encrypted": "",
            "model_name": "doubao-seedance-2-0-fast-260128",
            "model_bindings": [
                {"operation": "fast", "model_name": "doubao-seedance-2-0-fast-260128"}
            ],
            "enabled": True,
        },
    ]

    class FakeDAO:
        decrypt_key = staticmethod(lambda value: value.split(":", 1)[1] if value else "")

        @staticmethod
        async def list_all():
            return deepcopy(rows)

        @staticmethod
        async def update(config_id, **fields):
            row = next(item for item in rows if item["config_id"] == config_id)
            row.update(fields)
            return deepcopy(row)

        @staticmethod
        async def delete(config_id):
            index = next(index for index, item in enumerate(rows) if item["config_id"] == config_id)
            rows.pop(index)
            return True

    monkeypatch.setattr(service, "ApiConfigDAO", FakeDAO)
    monkeypatch.setattr(service, "invalidate_provider_health_for_items", AsyncMock(return_value=[]))

    result = await service.repair_api_config_provider_conflicts(
        reload_api_env=AsyncMock(return_value=True),
    )

    assert result["total_absorbed_placeholder_groups"] == 1
    assert result["deleted_placeholder_config_ids"] == ["fast-placeholder"]
    assert [row["config_id"] for row in rows] == ["plan-card"]
    assert rows[0]["endpoint"] == "https://ark.cn-beijing.volces.com/api/plan/"
    assert {
        (item["scope"], item["operation"], item["model_name"])
        for item in rows[0]["model_bindings"]
    } == {
        ("workflow", "standard", "doubao-seedance-1.5-pro"),
        ("workflow", "fast", "doubao-seedance-1.5-pro"),
        ("workflow", "mini", "doubao-seedance-1.5-pro"),
        ("studio", "standard", "doubao-seedance-1.5-pro"),
        ("studio", "fast", "doubao-seedance-1.5-pro"),
        ("studio", "mini", "doubao-seedance-1.5-pro"),
    }
