#!/usr/bin/env python3
"""Verify API config DB->env hot-reload service without a real database."""
from __future__ import annotations

import asyncio
import copy
import os
import sys
from pathlib import Path
from typing import Any


def deploy_root() -> Path:
    return Path(__file__).resolve().parents[1]


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


async def main() -> int:
    root = deploy_root()
    os.chdir(root)
    sys.path.insert(0, str(root))

    from services import api_provider_registry as registry  # noqa: PLC0415

    managed_keys: set[str] = set()
    for env_key in registry.PROVIDER_ENV_MAP.values():
        managed_keys.add(env_key)
        managed_keys.add(registry.get_endpoint_env_key(env_key))
        managed_keys.add(registry.get_proxy_mode_env_key(env_key))
        managed_keys.add(registry.get_custom_proxy_env_key(env_key))

    saved_env = {key: os.environ.get(key) for key in managed_keys}
    for key in managed_keys:
        os.environ.pop(key, None)

    os.environ["DEEPSEEK_API_KEY"] = "baseline-deepseek-key"
    os.environ["DEEPSEEK_ENDPOINT"] = "https://baseline.deepseek.example.test"

    from services import api_config_runtime_loader as loader  # noqa: PLC0415

    rows: list[dict[str, Any]] = [
        {
            "provider": "deepseek",
            "api_key_encrypted": "enc:db-deepseek-key",
            "endpoint": "https://db.deepseek.example.test",
            "proxy_mode": "custom",
            "custom_proxy": "http://proxy.example.test:7890",
            "enabled": True,
        },
        {
            "provider": "gemini-text",
            "api_key_encrypted": "",
            "endpoint": "https://should-not-load.example.test",
            "proxy_mode": "direct",
            "custom_proxy": "",
            "enabled": True,
        },
    ]
    creates: list[dict[str, Any]] = []
    updates: list[tuple[str, dict[str, Any]]] = []

    class FakeDAO:
        @staticmethod
        async def list_enabled():
            return copy.deepcopy(rows)

        @staticmethod
        async def list_all():
            return copy.deepcopy(rows)

        @staticmethod
        def decrypt_key(value):
            if not value:
                return ""
            return str(value).replace("enc:", "", 1)

        @staticmethod
        async def create(**fields):
            creates.append(dict(fields))
            row = dict(fields)
            row["config_id"] = f"created_{len(creates)}"
            row["api_key_encrypted"] = ""
            rows.append(row)
            return copy.deepcopy(row)

        @staticmethod
        async def update(config_id, **fields):
            updates.append((config_id, dict(fields)))
            for row in rows:
                if row.get("config_id") == config_id:
                    row.update(fields)
                    return copy.deepcopy(row)
            return copy.deepcopy({"config_id": config_id, **fields})

    original_dao = loader.ApiConfigDAO
    loader.ApiConfigDAO = FakeDAO
    try:
        result = await loader.load_api_configs_to_env()
        if result.get("loaded") != 1:
            fail(f"Expected one loaded keyed row, got {result}")
        if os.environ.get("DEEPSEEK_API_KEY") != "db-deepseek-key":
            fail("DB key did not override baseline env key")
        if os.environ.get("DEEPSEEK_ENDPOINT") != "https://db.deepseek.example.test":
            fail("DB endpoint was not projected to env")
        if os.environ.get("DEEPSEEK_PROXY_MODE") != "custom":
            fail("DB proxy mode was not projected to env")
        if os.environ.get("DEEPSEEK_CUSTOM_PROXY") != "http://proxy.example.test:7890":
            fail("DB custom proxy was not projected to env")
        if os.environ.get("GEMINI_TEXT_API_KEY"):
            fail("Empty-key DB row should not load into env")

        rows[:] = [
            {
                "provider": "deepseek",
                "api_key_encrypted": "boom",
                "endpoint": "https://broken.example.test",
                "proxy_mode": "direct",
                "custom_proxy": "",
                "enabled": True,
            }
        ]
        before_error_key = os.environ.get("DEEPSEEK_API_KEY")
        before_error_endpoint = os.environ.get("DEEPSEEK_ENDPOINT")

        original_decrypt = FakeDAO.decrypt_key

        @staticmethod
        def broken_decrypt(value):
            raise RuntimeError("decrypt exploded")

        FakeDAO.decrypt_key = broken_decrypt
        failed = await loader.load_api_configs_to_env()
        FakeDAO.decrypt_key = original_decrypt
        if failed.get("success") is not False:
            fail(f"Expected failed reload result, got {failed}")
        if os.environ.get("DEEPSEEK_API_KEY") != before_error_key:
            fail("Failed reload changed existing DEEPSEEK_API_KEY")
        if os.environ.get("DEEPSEEK_ENDPOINT") != before_error_endpoint:
            fail("Failed reload changed existing DEEPSEEK_ENDPOINT")

        rows.clear()
        result = await loader.load_api_configs_to_env()
        if result.get("loaded") != 0:
            fail(f"Expected empty DB reload to load zero rows, got {result}")
        if os.environ.get("DEEPSEEK_API_KEY") != "baseline-deepseek-key":
            fail("Empty DB reload did not restore baseline env key")
        if os.environ.get("DEEPSEEK_ENDPOINT") != "https://baseline.deepseek.example.test":
            fail("Empty DB reload did not restore baseline endpoint")
        if os.environ.get("DEEPSEEK_CUSTOM_PROXY"):
            fail("Empty DB reload did not clear DB-only custom proxy")

        rows[:] = [
            {
                "config_id": "legacy_gemini",
                "provider": "gemini-image",
                "name": "Gemini 3 Pro Image",
                "model_name": "gemini-3-pro-image-preview",
                "endpoint": "https://api.laozhang.ai/v1beta",
                "api_key_encrypted": "",
                "enabled": False,
            }
        ]
        creates.clear()
        updates.clear()
        seed = await loader.seed_default_api_providers()
        if seed.get("created") != 2:
            fail(f"Expected two GPT Image placeholders from registry, got {seed}")
        if seed.get("upgraded") != 1:
            fail(f"Expected one legacy Gemini image upgrade, got {seed}")
        created_providers = {item.get("provider") for item in creates}
        if created_providers != {"laozhang-gpt-image", "laozhang-sora2"}:
            fail(f"Unexpected seed providers: {created_providers}")
        disabled_updates = [fields for _, fields in updates if fields.get("enabled") is False]
        if len(disabled_updates) != 2:
            fail("Seed placeholders were not disabled")
        model_updates = [fields for _, fields in updates if fields.get("model_name") == loader.GEMINI_IMAGE_NEW_MODEL]
        if len(model_updates) != 1:
            fail("Legacy Gemini image model was not upgraded")

    finally:
        loader.ApiConfigDAO = original_dao
        for key, value in saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    text = (root / "admin_routes.py").read_text(encoding="utf-8")
    if "from cluster_main import load_api_configs_to_env" in text:
        fail("admin_routes.py must not dynamically import cluster_main for API env reload")

    print("API config runtime loader contract OK")
    print("  hot_reload_loaded_rows=1")
    print("  baseline_restore=1")
    print("  seed_registry_placeholders=2")
    print("  admin_routes_no_cluster_import=1")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
