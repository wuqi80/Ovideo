# -*- coding: utf-8 -*-
"""
测试配置 - fixtures 和测试数据库设置
"""
import pytest
import json
import os
import sys
import asyncpg
from contextlib import asynccontextmanager
from httpx import AsyncClient, ASGITransport


os.environ.setdefault("ALLOW_DEV_ADMIN_PASSWORD", "true")


_test_db_unavailable_reason = None


class _TransactionalTestDatabaseManager:
    """Route DAO calls through the fixture transaction instead of a global pool."""

    def __init__(self):
        self.connection = None

    def bind(self, connection):
        self.connection = connection

    def unbind(self, connection):
        if self.connection is connection:
            self.connection = None

    def _require_connection(self):
        if self.connection is None or self.connection.is_closed():
            raise RuntimeError("The test database transaction is not active")
        return self.connection

    @asynccontextmanager
    async def acquire(self):
        yield self._require_connection()

    async def execute(self, query, *args):
        return await self._require_connection().execute(query, *args)

    async def fetch(self, query, *args):
        rows = await self._require_connection().fetch(query, *args)
        return [dict(row) for row in rows]

    async def fetchrow(self, query, *args):
        row = await self._require_connection().fetchrow(query, *args)
        return dict(row) if row else None

    async def fetchval(self, query, *args):
        return await self._require_connection().fetchval(query, *args)


_test_db_manager = _TransactionalTestDatabaseManager()


async def _seed_test_parents(conn):
    """Create the minimal parent records required by DAO integration tests."""
    await conn.execute(
        """
        INSERT INTO users (user_id, username, password_hash)
        VALUES ('user_dao_fixture', 'dao_fixture_user', 'test-only')
        ON CONFLICT (user_id) DO NOTHING
        """
    )
    for project_id in ("proj_test1", "proj_1", "proj_A"):
        await conn.execute(
            """
            INSERT INTO projects (project_id, user_id, project_name)
            VALUES ($1, 'user_dao_fixture', $2)
            ON CONFLICT (project_id) DO NOTHING
            """,
            project_id,
            f"DAO fixture {project_id}",
        )
    for episode_id, episode_number in (("ep_1", 1), ("ep_test1", 2)):
        await conn.execute(
            """
            INSERT INTO episodes (
                episode_id, project_id, episode_number, episode_name
            )
            VALUES ($1, 'proj_1', $2, $3)
            ON CONFLICT (episode_id) DO NOTHING
            """,
            episode_id,
            episode_number,
            f"DAO fixture {episode_id}",
        )
    for item_id, sort_order in (("sb_001", -2), ("sb_005", -1)):
        await conn.execute(
            """
            INSERT INTO storyboard_items (item_id, episode_id, sort_order)
            VALUES ($1, 'ep_1', $2)
            ON CONFLICT (item_id) DO NOTHING
            """,
            item_id,
            sort_order,
        )


@pytest.fixture
async def test_db(monkeypatch):
    """提供测试数据库连接，每个测试用事务包裹，结束后回滚"""
    global _test_db_unavailable_reason
    if _test_db_unavailable_reason:
        pytest.skip(_test_db_unavailable_reason)

    from core.db_manager import DatabaseConfig

    config = DatabaseConfig()
    try:
        conn = await asyncpg.connect(
            host=config.HOST,
            port=config.PORT,
            database=config.DATABASE,
            user=config.USER,
            password=config.PASSWORD,
        )
    except (OSError, asyncpg.PostgresError) as exc:
        reason = f"PostgreSQL integration tests unavailable: {exc}"
        if os.environ.get("OSTORY_REQUIRE_TEST_DB", "").lower() == "true":
            raise RuntimeError(reason) from exc
        _test_db_unavailable_reason = reason
        pytest.skip(reason)

    tx = conn.transaction()
    await tx.start()
    _test_db_manager.bind(conn)
    await _seed_test_parents(conn)

    # DAO modules import this compatibility function at module load time. Patch
    # both import paths with a stable proxy. DAO modules may cache this function
    # across tests, so the proxy itself must outlive an individual connection.
    import core.db_manager as core_db_manager
    import db_manager as legacy_db_manager

    monkeypatch.setattr(core_db_manager, "get_db_manager", lambda: _test_db_manager)
    monkeypatch.setattr(legacy_db_manager, "get_db_manager", lambda: _test_db_manager)
    for module_name, module in list(sys.modules.items()):
        if not module_name.startswith("dao") or module is None:
            continue
        if hasattr(module, "get_db_manager"):
            monkeypatch.setattr(
                module,
                "get_db_manager",
                lambda: _test_db_manager,
            )
    try:
        yield conn
    finally:
        await tx.rollback()
        _test_db_manager.unbind(conn)
        await conn.close()


@pytest.fixture
async def client():
    """提供 FastAPI 测试客户端"""
    from cluster_main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
async def auth_headers(client):
    """登录获取 token，返回 Authorization header"""
    resp = await client.post("/api/login", json={
        "username": "admin",
        "password": "admin123"
    })
    if resp.status_code == 200 and resp.json().get("token"):
        return {"Authorization": f"Bearer {resp.json()['token']}"}
    return {"Authorization": "Bearer test-fallback-token"}
