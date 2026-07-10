# -*- coding: utf-8 -*-
from unittest.mock import AsyncMock


async def test_export_api_config_keys_decrypts_key_and_omits_encrypted_field(monkeypatch):
    from services import api_config_service as service

    encrypted = service.ApiConfigDAO._encrypt_key("sk-backup-secret")
    monkeypatch.setattr(
        service.ApiConfigDAO,
        "list_all",
        AsyncMock(
            return_value=[
                {
                    "config_id": "apicfg_1",
                    "name": "Gemini TTS",
                    "provider": "google",
                    "endpoint": "https://generativelanguage.googleapis.com/v1beta",
                    "api_key_encrypted": encrypted,
                    "model_name": "gemini-3.1-flash-tts-preview",
                    "proxy_mode": "direct",
                    "custom_proxy": "",
                    "request_template": '{"voice":"Kore"}',
                    "headers": {"X-Test": "yes"},
                    "category": "audio",
                    "enabled": True,
                }
            ]
        ),
    )

    result = await service.export_api_config_keys()

    assert result["success"] is True
    assert result["schema"] == "mecha.api_config_keys"
    assert result["schema_version"] == 2
    assert result["count"] == 1
    exported = result["configs"][0]
    assert exported["api_key"] == "sk-backup-secret"
    assert exported["request_template"] == {"voice": "Kore"}
    assert exported["headers"] == {"X-Test": "yes"}
    assert exported["has_key"] is True
    assert exported["model_bindings"] == [
        {
            "operation": "default",
            "label": "default",
            "model_name": "gemini-3.1-flash-tts-preview",
        }
    ]
    assert "api_key_encrypted" not in exported


async def test_import_api_config_keys_dry_run_skips_existing_and_counts_invalid(monkeypatch):
    from services import api_config_service as service

    monkeypatch.setattr(
        service.ApiConfigDAO,
        "list_all",
        AsyncMock(
            return_value=[
                {
                    "config_id": "apicfg_existing",
                    "name": "Existing Gemini",
                    "provider": "google",
                    "endpoint": "https://generativelanguage.googleapis.com/v1beta",
                    "model_name": "gemini-3.1-flash-tts-preview",
                    "api_key_encrypted": service.ApiConfigDAO._encrypt_key("sk-existing"),
                    "enabled": True,
                }
            ]
        ),
    )

    payload = {
        "configs": [
            {
                "name": "Existing Gemini",
                "provider": "google",
                "endpoint": "https://generativelanguage.googleapis.com/v1beta",
                "model_name": "gemini-3.1-flash-tts-preview",
                "api_key": "sk-existing",
            },
            {
                "name": "New Gemini",
                "provider": "google",
                "endpoint": "https://generativelanguage.googleapis.com/v1beta",
                "model_name": "gemini-2.5-flash-image",
                "api_key": "sk-new",
            },
            {
                "name": "Broken",
                "provider": "google",
                "endpoint": "https://generativelanguage.googleapis.com/v1beta",
            },
        ]
    }

    result = await service.import_api_config_keys(payload, dry_run=True)

    assert result["success"] is True
    assert result["dry_run"] is True
    assert result["total"] == 3
    assert result["created"] == 1
    assert result["updated"] == 1
    assert result["skipped"] == 0
    assert result["invalid"] == 1
    assert result["env_refreshed"] is None


async def test_import_key_body_accepts_backup_configs():
    import admin_api_config_routes

    body = admin_api_config_routes.ApiConfigKeyImportBody(
        configs=[
            {
                "name": "SeedDream",
                "provider": "doubao",
                "endpoint": "https://ark.cn-beijing.volces.com/api/v3/images/generations",
                "api_key": "sk-seed",
            }
        ]
    )

    assert len(body.configs) == 1
    assert body.overwrite_existing is False
