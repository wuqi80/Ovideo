"""Compatibility admin routes still used by the React admin shell.

These endpoints preserve legacy `/api/admin/*` URLs while moving their handlers
out of cluster_main.py. New admin functionality should live in admin_routes.py
or a focused admin router instead of growing this compatibility module.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from services.admin_compat_service import (
    AdminCompatForbidden,
    InvalidGroupBy,
    MissingUserCredentials,
    SelfDeleteForbidden,
    SystemUserDeleteForbidden,
    UserDeleteFailed,
    UsernameExists,
    WeakPassword,
    create_admin_user_response,
    delete_admin_user_response,
    get_admin_logs_response,
    get_admin_stats_response,
)


def create_admin_compat_router(
    *,
    require_auth: Callable[..., Any],
    require_super_admin: Callable[..., Any] | None = None,
    online_users: Dict[str, Any],
    default_users: Dict[str, str],
    super_admin: str,
    admin_stats_dao: Any,
    user_dao: Any,
    audit_record: Callable[..., Any] | None,
    logger: Any,
) -> APIRouter:
    router = APIRouter()
    super_admin_dependency = require_super_admin or require_auth

    @router.get("/api/admin/stats")
    async def get_admin_stats(
        username: str = Depends(require_auth),
        group_by: Optional[str] = None,
    ):
        try:
            return await get_admin_stats_response(
                username,
                group_by=group_by,
                super_admin=username,
                active_users_count=len(online_users),
                admin_stats_dao=admin_stats_dao,
                logger=logger,
            )
        except AdminCompatForbidden as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        except InvalidGroupBy as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            logger.error("获取系统统计失败: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.get("/api/admin/logs")
    async def get_admin_logs(username: str = Depends(require_auth), limit: int = 100):
        try:
            return await get_admin_logs_response(
                username,
                limit=limit,
                super_admin=username,
                admin_stats_dao=admin_stats_dao,
            )
        except AdminCompatForbidden as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        except Exception as exc:
            logger.error("获取生成日志失败: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.post("/api/admin/users/create")
    async def create_user(
        user_data: dict,
        request: Request,
        username: str = Depends(super_admin_dependency),
    ):
        try:
            return await create_admin_user_response(
                user_data,
                request=request,
                admin_username=username,
                super_admin=username,
                default_users=default_users,
                user_dao=user_dao,
                audit_record=audit_record,
                logger=logger,
            )
        except AdminCompatForbidden as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        except (MissingUserCredentials, WeakPassword, UsernameExists) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            logger.error("创建用户失败: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.delete("/api/admin/users/{user_id}")
    async def delete_user(
        user_id: str,
        username: str = Depends(super_admin_dependency),
    ):
        try:
            return await delete_admin_user_response(
                user_id,
                admin_username=username,
                super_admin=username,
                user_dao=user_dao,
                logger=logger,
            )
        except AdminCompatForbidden as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        except (SelfDeleteForbidden, SystemUserDeleteForbidden) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except UserDeleteFailed as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        except Exception as exc:
            logger.error("删除用户失败: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    return router
