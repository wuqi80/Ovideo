"""Current-user session and organization self-service routes."""
from __future__ import annotations

import logging
from collections.abc import MutableMapping
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from services.user_session_service import (
    OrganizationMemberRequired,
    OrganizationNotFound,
    OrganizationOwnerLeaveForbidden,
    get_user_info as get_user_info_service,
    leave_organization as leave_organization_service,
    list_user_organizations,
    logout_user,
)


def create_user_session_router(
    *,
    require_auth_dependency: Any,
    online_users: MutableMapping[str, Any],
    organization_dao: Any,
    organization_member_dao: Any,
    logger: logging.Logger,
) -> APIRouter:
    router = APIRouter()

    @router.post("/api/logout")
    async def logout(username: str = Depends(require_auth_dependency)):
        return logout_user(username, online_users=online_users)

    @router.get("/api/user/info")
    async def get_user_info(username: str = Depends(require_auth_dependency)):
        return get_user_info_service(username)

    @router.get("/api/me/organizations")
    async def list_my_organizations(username: str = Depends(require_auth_dependency)):
        return await list_user_organizations(
            username,
            organization_member_dao=organization_member_dao,
            logger=logger,
        )

    @router.post("/api/me/organizations/{org_id}/leave")
    async def leave_organization(org_id: str, username: str = Depends(require_auth_dependency)):
        try:
            return await leave_organization_service(
                org_id,
                username,
                organization_dao=organization_dao,
                organization_member_dao=organization_member_dao,
            )
        except OrganizationNotFound as exc:
            raise HTTPException(status_code=404, detail="组织不存在") from exc
        except OrganizationOwnerLeaveForbidden as exc:
            raise HTTPException(status_code=400, detail="owner 不能主动退出，请先转让 owner 角色") from exc
        except OrganizationMemberRequired as exc:
            raise HTTPException(status_code=400, detail="你不是该组织成员") from exc

    return router
