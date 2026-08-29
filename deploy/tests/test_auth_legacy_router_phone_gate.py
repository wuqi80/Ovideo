import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from routers import auth_legacy


class FakeUserDAO:
    row = None

    @classmethod
    async def verify_password(cls, _username, _password):
        return cls.row


class FakeActivityLogDAO:
    calls = []

    @classmethod
    async def log_activity(cls, **kwargs):
        cls.calls.append(kwargs)


def app():
    api = FastAPI()
    api.include_router(
        auth_legacy.create_auth_legacy_router(
            get_current_user_dependency=lambda: "admin",
            user_dao=FakeUserDAO,
            activity_log_dao=FakeActivityLogDAO,
        )
    )
    return api


@pytest.fixture(autouse=True)
def reset(monkeypatch):
    FakeUserDAO.row = {
        "user_id": "admin",
        "username": "admin",
        "role": "super_admin",
        "status": "active",
        "legacy_login_enabled": True,
        "phone_verified": False,
    }
    FakeActivityLogDAO.calls = []
    monkeypatch.setattr(auth_legacy, "create_binding_token", lambda user_id: f"bind:{user_id}")


@pytest.mark.asyncio
async def test_unverified_super_admin_cannot_bypass_phone_binding_on_legacy_api():
    async with AsyncClient(transport=ASGITransport(app=app()), base_url="http://test") as client:
        response = await client.post("/api/auth/login", json={"username": "admin", "password": "secret"})

    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "requires_phone_binding": True,
        "binding_token": "bind:admin",
        "username": "admin",
        "user_id": "admin",
    }
    assert FakeActivityLogDAO.calls == []


@pytest.mark.asyncio
async def test_phone_migrated_admin_cannot_use_legacy_api_login():
    FakeUserDAO.row.update(phone_verified=True, legacy_login_enabled=False)
    async with AsyncClient(transport=ASGITransport(app=app()), base_url="http://test") as client:
        response = await client.post("/api/auth/login", json={"username": "admin", "password": "secret"})

    assert response.status_code == 401
    assert "手机号登录" in response.json()["detail"]


@pytest.mark.asyncio
async def test_verified_legacy_admin_can_finish_migration_window_login():
    FakeUserDAO.row.update(phone_verified=True, legacy_login_enabled=True)
    async with AsyncClient(transport=ASGITransport(app=app()), base_url="http://test") as client:
        response = await client.post("/api/auth/login", json={"username": "admin", "password": "secret"})

    assert response.status_code == 200
    assert response.json()["token"] == "admin"
    assert FakeActivityLogDAO.calls == [{"user_id": "admin", "action": "login"}]
