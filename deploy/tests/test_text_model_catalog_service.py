from types import SimpleNamespace

import pytest

from services import text_model_catalog_service


@pytest.mark.asyncio
async def test_catalog_keeps_stable_operations_and_reports_effective_runtime_models(monkeypatch):
    async def fake_resolve_ai_proxy_provider(provider, model=None):
        assert provider == "gemini-text"
        assert model is None
        return (
            SimpleNamespace(provider="deepseek", model_name="fallback-v4"),
            {"active": True},
        )

    def fake_resolve_provider(provider, operation):
        assert provider == "deepseek"
        return SimpleNamespace(
            provider="deepseek",
            model_name={
                "deepseek-reasoner": "deepseek-v4-pro-custom",
                "deepseek-chat": "deepseek-v4-flash-custom",
            }[operation],
        )

    monkeypatch.setattr(
        text_model_catalog_service,
        "resolve_ai_proxy_provider",
        fake_resolve_ai_proxy_provider,
    )
    monkeypatch.setattr(
        text_model_catalog_service,
        "resolve_provider",
        fake_resolve_provider,
    )

    models = await text_model_catalog_service.build_text_model_catalog()

    assert [item["value"] for item in models] == ["gemini", "deepseek", "deepseek-chat"]
    assert [item["operation"] for item in models] == [
        "gemini-text",
        "deepseek-reasoner",
        "deepseek-chat",
    ]
    assert [item["runtime_model_name"] for item in models] == [
        "fallback-v4",
        "deepseek-v4-pro-custom",
        "deepseek-v4-flash-custom",
    ]
    assert models[0]["provider"] == "deepseek"
    assert models[0]["failover_active"] is True
    assert all("api_key" not in item and "endpoint" not in item for item in models)
