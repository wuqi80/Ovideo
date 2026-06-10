# -*- coding: utf-8 -*-
"""
测试配置 - fixtures 和测试数据库设置
"""
import pytest
import asyncio
import json
from httpx import AsyncClient, ASGITransport


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
async def test_db():
    """提供测试数据库连接，每个测试用事务包裹，结束后回滚"""
    from db_manager import get_db_manager, init_db_manager
    db = get_db_manager()
    if not db or not db.pool:
        db = await init_db_manager()
    conn = await db.pool.acquire()
    tx = conn.transaction()
    await tx.start()
    yield conn
    await tx.rollback()
    await db.pool.release(conn)


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
