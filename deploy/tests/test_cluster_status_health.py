from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from routers.cluster_status import create_cluster_status_router


async def _async_value(value):
    return value


class FakeRedis:
    async def ping(self):
        return True


class FakeDatabase:
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


class FakeTaskQueue:
    async def get_queue_length(self):
        return 0

    async def get_processing_count(self):
        return 0


class BackloggedTaskQueue(FakeTaskQueue):
    async def get_queue_length(self):
        return 1


async def test_health_includes_database_migrations_and_release(monkeypatch):
    monkeypatch.setattr(
        "routers.cluster_status.read_release_metadata",
        lambda: {"status": "available", "git_sha": "abc123"},
    )
    monkeypatch.setattr("routers.cluster_status.task_service.get_queue", lambda: FakeTaskQueue())
    monkeypatch.setattr(
        "routers.cluster_status.collect_provider_health",
        lambda: _async_value({"status": "healthy", "summary": {"ok": 1}}),
    )
    monkeypatch.setattr(
        "routers.cluster_status.list_agent_nodes",
        lambda include_offline=False: _async_value([]),
    )
    app = FastAPI()
    app.include_router(
        create_cluster_status_router(
            require_auth_dependency=lambda: "tester",
            get_cluster_manager=lambda: None,
            get_workers=lambda: [],
            get_redis_client=lambda: FakeRedis(),
            get_db_manager=lambda: FakeDatabase(),
        )
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "healthy"
    assert body["database"]["status"] == "healthy"
    assert body["database"]["migrations"]["status"] == "uninitialized"
    assert body["queue"]["status"] == "healthy"
    assert body["release"]["git_sha"] == "abc123"


async def test_health_degrades_when_database_is_unavailable(monkeypatch):
    monkeypatch.setattr(
        "routers.cluster_status.read_release_metadata",
        lambda: {"status": "missing"},
    )
    monkeypatch.setattr("routers.cluster_status.task_service.get_queue", lambda: FakeTaskQueue())
    monkeypatch.setattr(
        "routers.cluster_status.collect_provider_health",
        lambda: _async_value({"status": "healthy"}),
    )
    monkeypatch.setattr(
        "routers.cluster_status.list_agent_nodes",
        lambda include_offline=False: _async_value([]),
    )
    app = FastAPI()
    app.include_router(
        create_cluster_status_router(
            require_auth_dependency=lambda: "tester",
            get_cluster_manager=lambda: None,
            get_workers=lambda: [],
            get_redis_client=lambda: FakeRedis(),
            get_db_manager=lambda: None,
        )
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "degraded"


async def test_health_degrades_when_oldest_queued_task_is_stalled(monkeypatch):
    class StalledDatabase(FakeDatabase):
        async def fetchrow(self, query: str):
            assert "FROM tasks" in query
            return {
                "pending_count": 1,
                "processing_count": 0,
                "oldest_pending_at": datetime.now(timezone.utc) - timedelta(minutes=5),
                "oldest_processing_at": None,
            }

    monkeypatch.setenv("HEALTH_QUEUE_MAX_AGE_SECONDS", "60")
    monkeypatch.setattr(
        "routers.cluster_status.read_release_metadata",
        lambda: {"status": "available", "git_sha": "abc123"},
    )
    monkeypatch.setattr(
        "routers.cluster_status.task_service.get_queue",
        lambda: BackloggedTaskQueue(),
    )
    monkeypatch.setattr(
        "routers.cluster_status.collect_provider_health",
        lambda: _async_value({"status": "healthy"}),
    )
    monkeypatch.setattr(
        "routers.cluster_status.list_agent_nodes",
        lambda include_offline=False: _async_value([]),
    )
    app = FastAPI()
    app.include_router(
        create_cluster_status_router(
            require_auth_dependency=lambda: "tester",
            get_cluster_manager=lambda: None,
            get_workers=lambda: [],
            get_redis_client=lambda: FakeRedis(),
            get_db_manager=lambda: StalledDatabase(),
        )
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health")

    assert response.json()["status"] == "degraded"
    assert response.json()["queue"]["status"] == "stalled"


async def test_health_degrades_when_configured_gpu_agents_are_offline(monkeypatch):
    monkeypatch.setattr(
        "routers.cluster_status.read_release_metadata",
        lambda: {"status": "available", "git_sha": "abc123"},
    )
    monkeypatch.setattr("routers.cluster_status.task_service.get_queue", lambda: FakeTaskQueue())
    monkeypatch.setattr(
        "routers.cluster_status.collect_provider_health",
        lambda: _async_value({"status": "healthy"}),
    )
    monkeypatch.setattr(
        "routers.cluster_status.list_agent_nodes",
        lambda include_offline=False: _async_value(
            [{"agent_id": "gpu_1", "status": "offline"}]
        ),
    )
    app = FastAPI()
    app.include_router(
        create_cluster_status_router(
            require_auth_dependency=lambda: "tester",
            get_cluster_manager=lambda: None,
            get_workers=lambda: [],
            get_redis_client=lambda: FakeRedis(),
            get_db_manager=lambda: FakeDatabase(),
        )
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health")

    assert response.json()["status"] == "degraded"
    assert response.json()["gpu_agents"] == {
        "status": "unavailable",
        "configured": 1,
        "available": 0,
        "busy": 0,
        "unavailable": 1,
    }
