#!/usr/bin/env python3
"""Verify admin API config CRUD service without touching a real database."""
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

    from services import api_config_service as service  # noqa: PLC0415

    rows: list[dict[str, Any]] = [
        {
            "config_id": "apicfg_existing",
            "name": "Existing DeepSeek",
            "provider": "deepseek",
            "endpoint": "https://api.deepseek.com",
            "api_key_encrypted": "encrypted-key",
            "model_name": "deepseek-reasoner",
            "proxy_mode": "direct",
            "custom_proxy": "",
            "category": "text",
            "enabled": True,
            "request_template": {},
            "headers": {},
        },
        {
            "config_id": "apicfg_empty",
            "name": "Empty GPT Image",
            "provider": "laozhang-gpt-image",
            "endpoint": "https://api.laozhang.ai/v1",
            "api_key_encrypted": "",
            "model_name": "gpt-image-2-vip",
            "proxy_mode": "direct",
            "custom_proxy": "",
            "category": "image",
            "enabled": False,
            "request_template": {},
            "headers": {},
        },
    ]
    creates: list[dict[str, Any]] = []
    updates: list[tuple[str, dict[str, Any]]] = []
    deletes: list[str] = []
    invalidations: list[tuple[str, ...]] = []
    reload_calls = 0

    class FakeDAO:
        @staticmethod
        async def list_all():
            return copy.deepcopy(rows)

        @staticmethod
        async def create(**fields):
            creates.append(dict(fields))
            row = dict(fields)
            row["config_id"] = f"created_{len(creates)}"
            row["api_key_encrypted"] = f"encrypted:{fields.get('api_key')}" if fields.get("api_key") else ""
            row["enabled"] = True
            rows.append(row)
            return copy.deepcopy(row)

        @staticmethod
        async def get_by_id(config_id):
            for row in rows:
                if row["config_id"] == config_id:
                    return copy.deepcopy(row)
            return None

        @staticmethod
        async def get_decrypted_key(config_id):
            row = await FakeDAO.get_by_id(config_id)
            if not row or not row.get("api_key_encrypted"):
                return None
            return "decrypted-key"

        @staticmethod
        async def update(config_id, **fields):
            updates.append((config_id, dict(fields)))
            for row in rows:
                if row["config_id"] == config_id:
                    if "api_key" in fields:
                        row["api_key_encrypted"] = f"encrypted:{fields['api_key']}"
                    for key, value in fields.items():
                        if key != "api_key":
                            row[key] = value
                    return copy.deepcopy(row)
            return None

        @staticmethod
        async def delete(config_id):
            deletes.append(config_id)
            for idx, row in enumerate(rows):
                if row["config_id"] == config_id:
                    rows.pop(idx)
                    return True
            return False

    async def fake_reload():
        nonlocal reload_calls
        reload_calls += 1
        return True

    async def fake_invalidate(providers):
        invalidations.append(tuple(providers))
        return sorted(set(providers))

    original_dao = service.ApiConfigDAO
    original_invalidate = service.delete_cached_provider_health_many
    service.ApiConfigDAO = FakeDAO
    service.delete_cached_provider_health_many = fake_invalidate
    try:
        presets = service.get_api_config_presets()
        if len(presets.get("presets") or []) != 17:
            fail(f"preset facade count changed: {len(presets.get('presets') or [])}")
        if len(presets.get("providers") or []) != 12:
            fail(f"provider facade count changed: {len(presets.get('providers') or [])}")

        listed = await service.list_api_configs()
        if listed["api_configs"][0].get("api_key_encrypted") != "***":
            fail("list_api_configs did not mask encrypted API key")
        if listed["api_configs"][1].get("api_key_encrypted") != "":
            fail("list_api_configs should keep empty API key marker empty")
        if not listed.get("providers") or not listed.get("provider_status") or not listed.get("runtime_status"):
            fail("list_api_configs response missing provider/runtime metadata")

        created = await service.create_api_config(
            name="  New Config  ",
            provider=" deepseek ",
            endpoint=" https://api.example.test/v1 ",
            api_key="new-secret",
            model_name="deepseek-chat",
            request_template={"group_id": "runtime-group"},
            headers={"X-Test": "yes"},
            reload_api_env=fake_reload,
        )
        if created["api_config"]["name"] != "New Config":
            fail("create_api_config did not trim name")
        if created["api_config"]["provider"] != "deepseek":
            fail("create_api_config did not trim provider")
        if created["api_config"]["endpoint"] != "https://api.example.test/v1":
            fail("create_api_config did not trim endpoint")
        if created["api_config"]["api_key_encrypted"] != "***":
            fail("create_api_config did not mask API key")
        if created["api_config"].get("request_template") != {"group_id": "runtime-group"}:
            fail("create_api_config did not persist request_template")
        if created["api_config"].get("headers") != {"X-Test": "yes"}:
            fail("create_api_config did not persist headers")
        if created.get("env_refreshed") is not True:
            fail(f"create_api_config did not report env_refreshed=true: {created}")
        if created.get("disabled_conflicting_config_ids") != ["apicfg_existing"]:
            fail(f"create_api_config did not disable same-provider keyed conflict: {created}")
        existing_after_create = next(row for row in rows if row["config_id"] == "apicfg_existing")
        if existing_after_create.get("enabled") is not False:
            fail("create_api_config did not disable previous active DeepSeek config")
        if reload_calls != 1:
            fail(f"create_api_config should reload once, got {reload_calls}")
        if invalidations[-1] != ("deepseek",):
            fail(f"create_api_config should invalidate created provider health cache: {invalidations}")

        empty_update = await service.update_api_config("apicfg_existing", {}, reload_api_env=fake_reload)
        if empty_update["api_config"]["config_id"] != "apicfg_existing":
            fail("empty update did not return existing config")
        if reload_calls != 1:
            fail("empty update should not reload API env")
        if len(invalidations) != 1:
            fail("empty update should not invalidate provider health cache")

        updated = await service.update_api_config(
            "apicfg_existing",
            {"enabled": True, "api_key": "changed-secret"},
            reload_api_env=fake_reload,
        )
        if updated["api_config"]["enabled"] is not True:
            fail("update_api_config did not apply enabled=true")
        if updated["api_config"]["api_key_encrypted"] != "***":
            fail("update_api_config did not mask updated API key")
        if updated.get("disabled_conflicting_config_ids") != ["created_1"]:
            fail(f"update_api_config did not disable same-provider keyed conflict: {updated}")
        created_after_update = next(row for row in rows if row["config_id"] == "created_1")
        if created_after_update.get("enabled") is not False:
            fail("update_api_config did not disable previous active created config")
        if updated.get("env_refreshed") is not True:
            fail(f"update_api_config did not report env_refreshed=true: {updated}")
        if reload_calls != 2:
            fail(f"update_api_config should reload once, got {reload_calls}")
        if "deepseek" not in invalidations[-1]:
            fail(f"update_api_config should invalidate updated provider health cache: {invalidations}")

        health = await service.test_saved_api_config_health("apicfg_empty")
        test = health.get("test") or {}
        if test.get("ok") is not False or test.get("error") != "No API key configured":
            fail(f"health wrapper result changed: {test}")

        deleted = await service.delete_api_config("apicfg_empty", reload_api_env=fake_reload)
        if deleted != {"success": True, "deleted": True, "env_refreshed": True}:
            fail(f"delete_api_config result changed: {deleted}")
        if reload_calls != 3:
            fail(f"delete_api_config should reload once, got {reload_calls}")
        if invalidations[-1] != ("laozhang-gpt-image",):
            fail(f"delete_api_config should invalidate deleted provider health cache: {invalidations}")

        try:
            await service.delete_api_config("missing", reload_api_env=fake_reload)
            fail("delete_api_config should raise ApiConfigNotFound for missing id")
        except service.ApiConfigNotFound:
            pass

        rows[:] = [
            {
                "config_id": "dup_old",
                "name": "A MiniMax old",
                "provider": "minimax",
                "endpoint": "https://minimax-old.example.test/v1",
                "api_key_encrypted": "encrypted-old",
                "model_name": "MiniMax-Hailuo-02",
                "proxy_mode": "direct",
                "custom_proxy": "",
                "category": "video",
                "enabled": True,
                "headers": {},
            },
            {
                "config_id": "dup_winner",
                "name": "Z MiniMax winner",
                "provider": "minimax",
                "endpoint": "https://minimax-winner.example.test/v1",
                "api_key_encrypted": "encrypted-winner",
                "model_name": "MiniMax-Hailuo-02",
                "proxy_mode": "direct",
                "custom_proxy": "",
                "category": "video",
                "enabled": True,
                "headers": {},
            },
            {
                "config_id": "dup_empty",
                "name": "MiniMax empty",
                "provider": "minimax",
                "endpoint": "https://minimax-empty.example.test/v1",
                "api_key_encrypted": "",
                "model_name": "MiniMax-Hailuo-02",
                "proxy_mode": "direct",
                "custom_proxy": "",
                "category": "video",
                "enabled": True,
                "headers": {},
            },
            {
                "config_id": "solo",
                "name": "Solo DeepSeek",
                "provider": "deepseek",
                "endpoint": "https://deepseek.example.test",
                "api_key_encrypted": "encrypted-solo",
                "model_name": "deepseek-reasoner",
                "proxy_mode": "direct",
                "custom_proxy": "",
                "category": "text",
                "enabled": True,
                "headers": {},
            },
        ]
        reload_before_repair = reload_calls
        dry = await service.repair_api_config_provider_conflicts(
            reload_api_env=fake_reload,
            dry_run=True,
        )
        if dry.get("total_conflicts") != 1 or dry.get("would_disable") != 1 or dry.get("total_disabled") != 0:
            fail(f"repair dry_run summary changed: {dry}")
        if any(row["config_id"] == "dup_old" and row.get("enabled") is False for row in rows):
            fail("repair dry_run disabled a row")
        if reload_calls != reload_before_repair:
            fail("repair dry_run should not reload API env")

        repaired = await service.repair_api_config_provider_conflicts(reload_api_env=fake_reload)
        if repaired.get("total_conflicts") != 1 or repaired.get("total_disabled") != 1:
            fail(f"repair summary changed: {repaired}")
        conflict = repaired.get("conflicts", [{}])[0]
        if conflict.get("kept_config_id") != "dup_winner" or conflict.get("disabled_config_ids") != ["dup_old"]:
            fail(f"repair kept/disabled wrong rows: {repaired}")
        if next(row for row in rows if row["config_id"] == "dup_old").get("enabled") is not False:
            fail("repair did not disable old duplicate")
        if next(row for row in rows if row["config_id"] == "dup_winner").get("enabled") is not True:
            fail("repair disabled winning duplicate")
        if next(row for row in rows if row["config_id"] == "dup_empty").get("enabled") is not True:
            fail("repair should ignore enabled rows without keys")
        if reload_calls != reload_before_repair + 1:
            fail("repair should reload API env exactly once")
        if invalidations[-1] != ("minimax",):
            fail(f"repair should invalidate repaired provider health cache: {invalidations}")

    finally:
        service.ApiConfigDAO = original_dao
        service.delete_cached_provider_health_many = original_invalidate

    print("Admin API config CRUD contract OK")
    print("  list_masks_key=1")
    print("  presets_facade=17/12")
    print("  create_update_delete_reload_calls=3")
    print("  empty_update_reload_calls=0")
    print("  same_provider_conflict_disabled=1")
    print("  historical_conflict_repair=1")
    print("  provider_health_invalidations=4")
    print("  health_wrapper_no_key=1")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
