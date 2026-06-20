# -*- coding: utf-8 -*-
"""Legacy authentication and profile routes."""

from __future__ import annotations

import os
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel


class UserRegister(BaseModel):
    username: str
    password: str
    email: Optional[str] = None


class UserLogin(BaseModel):
    username: str
    password: str


def create_auth_legacy_router(
    *,
    get_current_user_dependency: Any,
    user_dao: Any,
    activity_log_dao: Any,
) -> APIRouter:
    router = APIRouter()
    get_current_user = get_current_user_dependency
    UserDAO = user_dao
    ActivityLogDAO = activity_log_dao

    @router.post("/api/auth/register")
    async def register_user(user_data: UserRegister):
        """Register a user through the legacy auth path."""
        if os.getenv("ALLOW_PUBLIC_REGISTRATION", "false").lower() not in ("1", "true", "yes", "on"):
            raise HTTPException(status_code=403, detail="公开注册已关闭，请联系管理员开通账号")
        try:
            if len(user_data.password) < 8:
                raise HTTPException(status_code=400, detail="密码至少 8 位")

            existing_user = await UserDAO.get_user_by_username(user_data.username)
            if existing_user:
                raise HTTPException(status_code=400, detail="用户名已存在")

            user = await UserDAO.create_user(
                username=user_data.username,
                password=user_data.password,
                email=user_data.email,
                user_id=user_data.username,
            )

            return {
                "success": True,
                "user_id": user['user_id'],
                "username": user['username']
            }

        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/api/auth/login")
    async def login_user(login_data: UserLogin):
        """Log in through the legacy auth path."""
        try:
            user = await UserDAO.verify_password(
                login_data.username,
                login_data.password
            )

            if not user:
                raise HTTPException(status_code=401, detail="用户名或密码错误")

            user_status = user.get('status') if isinstance(user, dict) else None
            if user_status and user_status != 'active':
                reason = (user.get('disabled_reason') if isinstance(user, dict) else None) or '账户已被管理员禁用'
                raise HTTPException(status_code=403, detail=f"账户已被禁用：{reason}")

            await ActivityLogDAO.log_activity(
                user_id=user['user_id'],
                action='login'
            )

            return {
                "success": True,
                "user_id": user['user_id'],
                "username": user['username'],
                "token": user['user_id']
            }

        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/api/user/profile")
    async def get_user_profile(user_id: str = Depends(get_current_user)):
        """Return the current user's profile and storage statistics."""
        try:
            user = await UserDAO.get_user_by_id(user_id)
            if not user:
                raise HTTPException(status_code=404, detail="用户不存在")

            storage_stats = await UserDAO.get_storage_stats(user_id)

            return {
                "success": True,
                "user": user,
                "storage_stats": storage_stats
            }

        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    return router
