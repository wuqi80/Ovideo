"""Authentication compatibility routes."""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException

from schemas.auth import LoginRequest


DEFAULT_ALLOWED_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-image",
    "wan2-i2v",
    "wan2-morph",
    "wan26-i2v",
    "sora2-i2v",
    "veo-i2v",
    "minimax-i2v",
]


def create_auth_router(
    *,
    verify_credentials: Any,
    create_session_token: Any,
    get_db_manager: Any,
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
        db_manager = get_db_manager()
        if not is_valid and db_manager:
            try:
                from dao_user import UserDAO

                user = await UserDAO.verify_password(request.username, request.password)
                if user:
                    is_valid = True
                    db_user_record = user
                    logger.info("User %s authenticated with database credentials", request.username)
            except Exception as exc:
                logger.error("Database authentication failed: %s", exc)

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

        if db_manager:
            try:
                from dao_user import UserDAO

                logger.info("Checking user row for %s during login", request.username)
                existing_user = await UserDAO.get_user_by_username(request.username)

                if not existing_user:
                    logger.info("User %s not found in DB, creating row", request.username)
                    user = await UserDAO.create_user(
                        username=request.username,
                        password=request.password,
                        email=f"{request.username}@local.com",
                        user_id=request.username,
                    )
                    if user:
                        logger.info("User %s synced to DB with id=%s", request.username, user["user_id"])
                        await UserDAO.update_user_permissions(
                            request.username,
                            {
                                "allowedModels": DEFAULT_ALLOWED_MODELS,
                                "priority": "normal",
                                "canExport": True,
                            },
                        )
                        logger.info("Default permissions assigned for user %s", request.username)
                    else:
                        logger.error("Creating user row for %s returned None", request.username)
                else:
                    logger.info("User %s already exists in DB with id=%s", request.username, existing_user["user_id"])
                    user_permissions = existing_user.get("permissions")
                    if not user_permissions or not isinstance(user_permissions, dict):
                        logger.info("User %s has no permission payload, assigning defaults", request.username)
                        await UserDAO.update_user_permissions(
                            request.username,
                            {
                                "allowedModels": DEFAULT_ALLOWED_MODELS,
                                "priority": "normal",
                                "canExport": True,
                            },
                        )
                        logger.info("Default permissions assigned for existing user %s", request.username)
            except Exception as exc:
                logger.error("User sync during login failed: %s", exc, exc_info=True)
        else:
            logger.warning("Database unavailable, skipping login user sync")

        return {
            "success": True,
            "message": "登录成功",
            "token": token,
            "username": request.username,
        }

    return router
