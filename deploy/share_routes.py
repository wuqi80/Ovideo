# -*- coding: utf-8 -*-
"""
Share Routes — `/api/shares`
============================
2026-05-26 组织管理 MVP — Slice 4

资源共享 CRUD（用户对自己 owner 的资源；admin 不受限）。
挂载方式：cluster_main.py 中 `from share_routes import router as share_router`，
然后 `app.include_router(share_router)`。

详见 docs/superpowers/specs/2026-05-26-organization-management-design.md §5.3
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from dao_resource_share import ResourceShareDAO
from dao_organization import OrganizationMemberDAO

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/shares", tags=["shares"])


def _row(d):
    if d is None:
        return None
    out = {}
    for k, v in dict(d).items():
        if hasattr(v, 'isoformat'):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


# 简单 JWT 解析 — 避免与 cluster_main 互相 import（share_routes 在 cluster_main include 时被加载）
async def _current_user(request: Request) -> str:
    auth = request.headers.get("Authorization") or ""
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="需要登录")
    import jwt_auth
    username = jwt_auth.verify_token(auth[7:])
    if not username:
        raise HTTPException(status_code=401, detail="Token 已失效或不存在")
    return username


async def _is_system_admin(user_id: str) -> bool:
    try:
        from dao_user import UserDAO
        u = await UserDAO.get_user_by_id(user_id) or await UserDAO.get_user_by_username(user_id)
        if not u:
            return False
        role = (u.get('role') if isinstance(u, dict) else None) or 'user'
        if role in ('admin', 'super_admin'):
            return True
    except Exception as e:
        logger.warning(f"_is_system_admin check failed user={user_id} err={e}")
    return False


async def _check_resource_owner(
    user_id: str,
    resource_type: str,
    resource_id: str,
) -> bool:
    """检查 user 是否是该资源的 owner。admin 调用方应跳过此检查。"""
    try:
        if resource_type == 'project':
            from dao_content import ProjectDAO
            p = await ProjectDAO.get_project(resource_id)
            return bool(p and p.get('user_id') == user_id)
        if resource_type == 'media':
            from dao_media_library import MediaLibraryDAO
            m = await MediaLibraryDAO.get(resource_id)
            return bool(m and m.get('user_id') == user_id)
        if resource_type == 'group':
            from dao_project_group import ProjectGroupDAO
            g = await ProjectGroupDAO.get(resource_id)
            return bool(g and g.get('user_id') == user_id)
    except Exception as e:
        logger.warning(f"_check_resource_owner failed type={resource_type} id={resource_id} err={e}")
    return False


async def _check_target_valid(
    user_id: str,
    share_target_type: str,
    share_target_id: str,
) -> bool:
    """检查 target 存在且 user 是 target 成员（防止把资源 share 给我没加入的组织）。"""
    if share_target_type == 'org':
        return await OrganizationMemberDAO.is_member(share_target_id, user_id)
    if share_target_type == 'project':
        # 用户必须是该 project 的 member（owner 或被邀请）
        try:
            from dao_content import ProjectMemberDAO
            return bool(await ProjectMemberDAO.check_permission(
                share_target_id, user_id, 'readonly',
            ))
        except Exception as e:
            logger.warning(f"_check_target_valid project membership check failed err={e}")
            return False
    return False


# ── Models ───────────────────────────────────────────

class ShareCreateBody(BaseModel):
    resource_type: str
    resource_id: str
    share_target_type: str
    share_target_id: str


# ── Endpoints ───────────────────────────────────────────

@router.get("")
async def list_shares(
    resource_type: str,
    resource_id: str,
    username: str = Depends(_current_user),
):
    """列出资源的所有共享目标。仅 owner / admin 可调。"""
    is_admin = await _is_system_admin(username)
    if not is_admin and not await _check_resource_owner(username, resource_type, resource_id):
        raise HTTPException(status_code=403, detail="只有资源 owner 能查看共享列表")
    rows = await ResourceShareDAO.list_for_resource(resource_type, resource_id)
    return {"success": True, "shares": [_row(r) for r in rows]}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_share(body: ShareCreateBody, username: str = Depends(_current_user)):
    """创建共享：用户只能 share 自己 owner 的资源；admin 不限。target 必须是 user 加入的 org/project。"""
    is_admin = await _is_system_admin(username)
    if not is_admin:
        if not await _check_resource_owner(username, body.resource_type, body.resource_id):
            raise HTTPException(status_code=403, detail="只有资源 owner 能共享该资源")
        if not await _check_target_valid(username, body.share_target_type, body.share_target_id):
            raise HTTPException(
                status_code=400,
                detail="共享目标不存在或你不在该目标里（只能共享给已加入的组织或项目）",
            )

    try:
        share = await ResourceShareDAO.create(
            resource_type=body.resource_type,
            resource_id=body.resource_id,
            share_target_type=body.share_target_type,
            share_target_id=body.share_target_id,
            granted_by_user_id=username,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("create_share failed")
        raise HTTPException(status_code=500, detail=f"创建共享失败: {e}")

    return {"success": True, "share": _row(share)}


@router.delete("/{share_id}")
async def delete_share(share_id: str, username: str = Depends(_current_user)):
    """取消共享。仅 grant 者 / 资源 owner / admin 可调。"""
    existing = await ResourceShareDAO.get(share_id)
    if not existing:
        raise HTTPException(status_code=404, detail="共享记录不存在")

    is_admin = await _is_system_admin(username)
    if not is_admin:
        is_grantor = existing.get('granted_by_user_id') == username
        is_owner = await _check_resource_owner(
            username, existing.get('resource_type'), existing.get('resource_id'),
        )
        if not (is_grantor or is_owner):
            raise HTTPException(status_code=403, detail="只有授权者 / 资源 owner 能取消共享")

    await ResourceShareDAO.delete(share_id)
    return {"success": True}
