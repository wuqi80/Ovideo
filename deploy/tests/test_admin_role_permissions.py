from __future__ import annotations

import pytest
from fastapi import HTTPException
from starlette.requests import Request

import admin_routes
import jwt_auth


def _request() -> Request:
    return Request({
        "type": "http",
        "method": "GET",
        "path": "/api/admin/session",
        "headers": [(b"authorization", b"Bearer test-token")],
    })


@pytest.mark.asyncio
async def test_admin_role_can_enter_admin_but_not_super_admin_policy(monkeypatch):
    async def load_identity(subject: str):
        return {"user_id": "ops-1", "username": "operator", "role": "admin"}

    monkeypatch.setattr(admin_routes, "_load_admin_identity", load_identity)
    monkeypatch.setattr(jwt_auth, "verify_token", lambda token: "ops-1")

    assert await admin_routes.require_admin(_request()) == "operator"
    with pytest.raises(HTTPException) as exc:
        await admin_routes.require_super_admin(_request())
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_super_admin_role_can_change_platform_policy(monkeypatch):
    async def load_identity(subject: str):
        return {"user_id": "owner-1", "username": "owner", "role": "super_admin"}

    monkeypatch.setattr(admin_routes, "_load_admin_identity", load_identity)
    monkeypatch.setattr(jwt_auth, "verify_token", lambda token: "owner-1")

    assert await admin_routes.require_super_admin(_request()) == "owner"


def test_legacy_empty_model_list_inherits_platform_catalog():
    normalized = admin_routes._normalize_admin_user({
        "user_id": "legacy-1",
        "username": "legacy",
        "role": "user",
        "permissions": {"allowedModels": []},
    })

    assert normalized["permissions"]["accessMode"] == "inherit"
    assert normalized["permissions"]["allowedModels"] == []
