from __future__ import annotations

import json
from datetime import datetime, timezone

from services import runtime_health_service
from services.runtime_health_service import collect_database_health, read_release_metadata


class HealthyDatabase:
    async def fetchval(self, query: str):
        if query == "SELECT 1":
            return 1
        assert "schema_migrations" in query
        return True

    async def fetchrow(self, query: str):
        if "FROM schema_migrations" in query:
            return {
                "migration_id": "sql/001.sql",
                "checksum_sha256": "a" * 64,
                "applied_at": datetime(2026, 7, 18, 3, 4, 5, tzinfo=timezone.utc),
                "execution_ms": 12,
                "git_sha": "abc123",
                "applied_count": 4,
            }
        assert "FROM tasks" in query
        return {
            "pending_count": 2,
            "processing_count": 1,
            "oldest_pending_at": datetime.now(timezone.utc),
            "oldest_processing_at": None,
        }


async def test_collect_database_health_includes_latest_migration():
    result = await collect_database_health(HealthyDatabase())

    assert result["status"] == "healthy"
    assert result["migrations"]["applied_count"] == 4
    assert result["migrations"]["latest"]["migration_id"] == "sql/001.sql"
    assert result["migrations"]["latest"]["applied_at"] == "2026-07-18T03:04:05+00:00"
    assert result["task_queue"]["pending_count"] == 2
    assert result["task_queue"]["oldest_pending_age_seconds"] <= 1


async def test_collect_database_health_reports_missing_ledger():
    class DatabaseWithoutLedger:
        async def fetchval(self, query: str):
            return 1 if query == "SELECT 1" else False

        async def fetchrow(self, query: str):
            assert "FROM tasks" in query
            return {
                "pending_count": 0,
                "processing_count": 0,
                "oldest_pending_at": None,
                "oldest_processing_at": None,
            }

    result = await collect_database_health(DatabaseWithoutLedger())

    assert result["status"] == "healthy"
    assert result["migrations"] == {"status": "uninitialized", "applied_count": 0}
    assert result["task_queue"]["pending_count"] == 0


async def test_collect_database_health_degrades_without_database():
    result = await collect_database_health(None)

    assert result["status"] == "unhealthy"
    assert result["migrations"]["status"] == "unknown"


def test_read_release_metadata(tmp_path):
    path = tmp_path / "release_metadata.json"
    path.write_text(
        json.dumps(
            {
                "git_sha": "abc123",
                "backend_source_sha256": "b" * 64,
                "frontend_source_sha256": "f" * 64,
                "released_at": "2026-07-18T03:04:05Z",
            }
        ),
        encoding="utf-8",
    )

    result = read_release_metadata(path)

    assert result["status"] == "available"
    assert result["git_sha"] == "abc123"
    assert result["frontend_source_sha256"] == "f" * 64


def test_read_release_metadata_reports_invalid_json(tmp_path):
    path = tmp_path / "release_metadata.json"
    path.write_text("not-json", encoding="utf-8")

    result = read_release_metadata(path)

    assert result["status"] == "invalid"
    assert result["error"] == "JSONDecodeError"


async def test_collect_provider_health_uses_cache_without_running_generation(monkeypatch):
    calls = []

    async def cached(providers):
        calls.append(providers)
        return [
            {
                "provider": "seedance",
                "model_name": "seedance-2.0",
                "status": "ok",
                "cached_at": "2026-07-18T03:04:05Z",
            }
        ]

    monkeypatch.setenv("HEALTH_CRITICAL_PROVIDERS", "seedance,minimax")
    monkeypatch.setattr(
        "services.runtime_health_service.ApiConfigDAO.list_enabled",
        lambda: _async_result(
            [{"provider": "seedance", "api_key_encrypted": "encrypted"}]
        ),
    )
    monkeypatch.setattr(
        "services.api_provider_health_monitor.list_cached_provider_health",
        cached,
    )
    monkeypatch.setattr(
        "services.api_provider_health_monitor.provider_health_monitor_state",
        lambda: {"loop_running": True},
    )

    result = await runtime_health_service.collect_provider_health()

    assert calls == [["seedance", "minimax"]]
    assert result["status"] == "healthy"
    assert result["summary"]["ok"] == 1
    assert result["channels"][0]["checked_at"] == "2026-07-18T03:04:05Z"


def test_critical_provider_ids_falls_back_to_configured_providers_when_env_is_blank(monkeypatch):
    monkeypatch.setenv("HEALTH_CRITICAL_PROVIDERS", "")

    result = runtime_health_service.critical_provider_ids(
        ["DeepSeek", "minimax", "deepseek", ""],
    )

    assert result == ["deepseek", "minimax"]


async def _async_result(value):
    return value
