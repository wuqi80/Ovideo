"""Current-user session and organization self-service routes."""
from __future__ import annotations

import logging
from collections.abc import MutableMapping
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException


def _serialize_record(record: dict) -> dict:
    out = {}
    for key, value in record.items():
        if hasattr(value, "isoformat"):
            out[key] = value.isoformat()
        else:
            out[key] = value
    return out


def create_user_session_router(
    *,
    require_auth_dependency: Any,
    online_users: MutableMapping[str, datetime],
    logger: logging.Logger,
) -> APIRouter:
    router = APIRouter()

    @router.post("/api/logout")
    async def logout(username: str = Depends(require_auth_dependency)):
        online_users.pop(username, None)
        return {"success": True, "message": "登出成功"}

    @router.get("/api/user/info")
    async def get_user_info(username: str = Depends(require_auth_dependency)):
        return {
            "username": username,
            "login_time": datetime.now().isoformat(),
        }

    @router.get("/api/me/organizations")
    async def list_my_organizations(username: str = Depends(require_auth_dependency)):
        try:
            from dao_organization import OrganizationMemberDAO

            orgs = await OrganizationMemberDAO.list_orgs_for_user(username)
        except Exception as exc:
            logger.warning("list_my_organizations: DAO 调用失败 username=%s err=%s", username, exc)
            return {"success": True, "organizations": []}

        return {"success": True, "organizations": [_serialize_record(org) for org in orgs]}

    @router.post("/api/me/organizations/{org_id}/leave")
    async def leave_organization(org_id: str, username: str = Depends(require_auth_dependency)):
        from dao_organization import OrganizationDAO, OrganizationMemberDAO

        org = await OrganizationDAO.get(org_id)
        if not org:
            raise HTTPException(status_code=404, detail="组织不存在")
        if org.get("owner_user_id") == username:
            raise HTTPException(status_code=400, detail="owner 不能主动退出，请先转让 owner 角色")
        if not await OrganizationMemberDAO.is_member(org_id, username):
            raise HTTPException(status_code=400, detail="你不是该组织成员")
        await OrganizationMemberDAO.remove_member(org_id, username)
        return {"success": True}

    return router
