import pytest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

from services import admin_user_service as svc


class _UserDAO:
    users = {}

    @classmethod
    def reset(cls):
        cls.users = {
            "user_1": {"user_id": "user_1", "username": "old_name", "role": "user"},
            "user_2": {"user_id": "user_2", "username": "taken_name", "role": "user"},
            "admin": {"user_id": "admin", "username": "admin", "role": "super_admin"},
        }

    @classmethod
    async def admin_get_user_detail(cls, user_id):
        row = cls.users.get(user_id)
        return dict(row) if row else None

    @classmethod
    async def get_user_by_username_any(cls, username):
        return next((dict(row) for row in cls.users.values() if row["username"] == username), None)

    @classmethod
    async def update_self_profile(cls, user_id, **fields):
        cls.users[user_id].update(fields)
        return True


@pytest.fixture(autouse=True)
def _reset_user_dao():
    _UserDAO.reset()


@pytest.mark.asyncio
async def test_rename_user_changes_only_username_and_keeps_stable_user_id():
    result = await svc.rename_user("user_1", "new_name", user_dao=_UserDAO)

    assert result["changed"] is True
    assert result["before"]["username"] == "old_name"
    assert result["user"]["username"] == "new_name"
    assert result["user"]["user_id"] == "user_1"


@pytest.mark.asyncio
async def test_rename_user_rejects_invalid_or_duplicate_username():
    with pytest.raises(svc.AdminUsernameInvalid):
        await svc.rename_user("user_1", "bad name", user_dao=_UserDAO)

    with pytest.raises(svc.AdminUsernameExists):
        await svc.rename_user("user_1", "taken_name", user_dao=_UserDAO)


@pytest.mark.asyncio
async def test_rename_user_protects_bootstrap_admin_identity():
    with pytest.raises(svc.ProtectedSystemUsername):
        await svc.rename_user("admin", "renamed_admin", user_dao=_UserDAO)


@pytest.mark.asyncio
async def test_rename_user_treats_same_name_as_noop():
    result = await svc.rename_user("user_1", " old_name ", user_dao=_UserDAO)

    assert result["changed"] is False
    assert result["user"]["username"] == "old_name"


@pytest.mark.asyncio
async def test_admin_rename_of_current_uuid_account_refreshes_session_and_audits_stable_id(monkeypatch):
    import admin_audit_service
    import admin_routes
    import jwt_auth

    request = SimpleNamespace(
        headers={"Authorization": "Bearer old-token"},
        client=SimpleNamespace(host="127.0.0.1"),
    )
    caller = {"user_id": "user_uuid_1", "username": "old_admin", "role": "super_admin"}

    async def fake_load(subject):
        assert subject == "old_admin"
        return dict(caller)

    async def fake_rename(user_id, username, *, user_dao):
        assert user_id == "user_uuid_1"
        assert username == "new_admin"
        assert user_dao is admin_routes.UserDAO
        return {
            "changed": True,
            "before": dict(caller),
            "user": {**caller, "username": "new_admin"},
        }

    audit = AsyncMock()
    monkeypatch.setattr(admin_routes, "_require_db", lambda: None)
    monkeypatch.setattr(admin_routes, "_load_admin_identity", fake_load)
    monkeypatch.setattr(admin_routes.UserDAO, "get_user_by_id", AsyncMock(return_value=dict(caller)))
    monkeypatch.setattr(admin_routes.admin_user_service, "rename_user", fake_rename)
    monkeypatch.setattr(admin_audit_service, "record", audit)
    monkeypatch.setattr(jwt_auth, "verify_token", lambda token: "old_admin")
    monkeypatch.setattr(jwt_auth, "create_token", lambda username: f"token-for-{username}")

    response = await admin_routes.admin_update_username(
        "user_uuid_1",
        admin_routes.AdminUsernameUpdateBody(username="new_admin"),
        request,
    )

    assert response["session"] == {
        "token": "token-for-new_admin",
        "username": "new_admin",
    }
    assert audit.await_args.kwargs["admin_user_id"] == "user_uuid_1"
    assert audit.await_args.kwargs["target_id"] == "user_uuid_1"


def test_admin_user_normalization_preserves_phone_and_recent_login():
    import admin_routes

    last_login = datetime(2026, 8, 31, 9, 30, tzinfo=timezone.utc)
    user = admin_routes._normalize_admin_user(
        {
            "user_id": "user_phone",
            "username": "creator",
            "phone_number": "13800138000",
            "last_login_at": last_login,
            "status": "active",
        }
    )

    assert user["phone_number"] == "13800138000"
    assert user["last_login_at"] == last_login.isoformat()
    assert user["lastLogin"] == int(last_login.timestamp() * 1000)
