"""Authentication compatibility routes."""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException

from dao_user import UserDAO
from schemas.auth import LoginRequest
from services.auth_user_service import ensure_login_user_record, verify_database_credentials
from services.user_profile_service import resolve_authenticated_user_id


def create_auth_router(
    *,
    verify_credentials: Any,
    create_session_token: Any,
    logger: logging.Logger,
) -> APIRouter:
    router = APIRouter()

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

        if db_user_record and isinstance(db_user_record, dict):
            user_status = db_user_record.get("status")
            if user_status and user_status != "active":
                reason = db_user_record.get("disabled_reason") or "账号已被管理员禁用"
                logger.warning("User %s login rejected: %s - %s", request.username, user_status, reason)
                raise HTTPException(status_code=403, detail=f"账号已被禁用：{reason}")

        token = create_session_token(request.username)
        logger.info("User %s login succeeded", request.username)

        await ensure_login_user_record(request.username, request.password, logger=logger)
        user_id = await resolve_authenticated_user_id(request.username, user_dao=UserDAO)

        return {
            "success": True,
            "message": "登录成功",
            "token": token,
            "username": request.username,
            "user_id": user_id,
        }

    return router
