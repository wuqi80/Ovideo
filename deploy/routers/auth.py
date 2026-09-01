"""Authentication compatibility routes."""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException

from dao_user import UserDAO
from schemas.auth import LoginRequest
from services.auth_user_service import ensure_login_user_record, verify_database_credentials
from services.binding_token_service import create_binding_token
from services.user_profile_service import resolve_authenticated_user_id


def create_auth_router(
    *,
    verify_credentials: Any,
    create_session_token: Any,
    logger: logging.Logger,
    mark_user_online: Any = None,
) -> APIRouter:
    router = APIRouter()

    def record_value(record: Any, key: str, default: Any = None) -> Any:
        if not record:
            return default
        getter = getattr(record, "get", None)
        if callable(getter):
            return getter(key, default)
        try:
            return record[key]
        except Exception:
            return default

    @router.post("/api/login")
    async def login(request: LoginRequest):
        """User login, supporting built-in credentials and DB users."""
        is_valid = False

        if verify_credentials(request.username, request.password):
            is_valid = True
            logger.info("User %s authenticated with built-in credentials", request.username)

        db_user_record = None
        if not is_valid:
            db_user_record = await verify_database_credentials(
                request.username,
                request.password,
                logger=logger,
            )
            if db_user_record:
                is_valid = True
                logger.info("User %s authenticated with database credentials", request.username)

        if not is_valid:
            logger.warning("User %s login failed: invalid credentials", request.username)
            raise HTTPException(status_code=401, detail="用户名或密码错误")

        await ensure_login_user_record(request.username, request.password, logger=logger)
        user_id = await resolve_authenticated_user_id(request.username, user_dao=UserDAO)
        # Built-in legacy credentials are mirrored into users only after the
        # first successful login. Reload the authoritative account row so they
        # cannot bypass disable status or the mandatory phone-binding gate.
        current_user_record = await UserDAO.get_user_auth_by_id(user_id)
        auth_record = current_user_record or db_user_record

        user_status = record_value(auth_record, "status")
        if user_status and user_status != "active":
            reason = record_value(auth_record, "disabled_reason") or "账号已被管理员禁用"
            logger.warning("User %s login rejected: %s - %s", request.username, user_status, reason)
            raise HTTPException(status_code=403, detail=f"账号已被禁用：{reason}")

        if auth_record:
            if not bool(record_value(auth_record, "legacy_login_enabled")):
                raise HTTPException(status_code=401, detail="该账号已切换为手机号登录")
            if not bool(record_value(auth_record, "phone_verified")):
                logger.info("Legacy user %s must bind a verified phone", request.username)
                return {
                    "success": True,
                    "requires_phone_binding": True,
                    "binding_token": create_binding_token(user_id),
                    "username": request.username,
                    "user_id": user_id,
                }

        if hasattr(UserDAO, "update_last_login"):
            await UserDAO.update_last_login(user_id)
        if mark_user_online:
            await mark_user_online(user_id)
        token = create_session_token(user_id)
        logger.info("User %s login succeeded", request.username)

        return {
            "success": True,
            "message": "登录成功",
            "token": token,
            "username": request.username,
            "user_id": user_id,
        }

    return router
