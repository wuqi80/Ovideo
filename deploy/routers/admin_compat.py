"""Compatibility admin routes still used by the React admin shell.

These endpoints preserve legacy `/api/admin/*` URLs while moving their handlers
out of cluster_main.py. New admin functionality should live in admin_routes.py
or a focused admin router instead of growing this compatibility module.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from dao.admin.admin_stats import AdminStatsDAO


def create_admin_compat_router(
    *,
    require_auth: Callable[..., Any],
    get_db_manager: Callable[[], Any],
    online_users: Dict[str, Any],
    default_users: Dict[str, str],
    super_admin: str,
    logger: Any,
) -> APIRouter:
    router = APIRouter()
    SUPER_ADMIN = super_admin
    _online_users = online_users
    DEFAULT_USERS = default_users

    @router.get("/api/admin/stats")
    async def get_admin_stats(
        username: str = Depends(require_auth),
        group_by: Optional[str] = None,
    ):
        """获取系统统计（仅管理员）

        2026-05-26 组织管理 MVP — Slice 6: 新增 group_by 参数
            - 不传 / 'none': 旧行为，返回聚合数字
            - 'user': 额外返回 breakdown=[{user_id, username, projects, images, videos, text}]
            - 'org':  额外返回 breakdown=[{org_id, name, member_count, projects, images, videos, text}]
        """
        # 🔐 权限检查：允许admin和超级管理员访问
        if username not in ['admin', SUPER_ADMIN]:
            raise HTTPException(status_code=403, detail="权限不足：仅管理员可访问")
        if group_by not in (None, 'none', 'user', 'org'):
            raise HTTPException(status_code=400, detail="group_by 必须是 'none'|'user'|'org'")

        try:
            stats = await AdminStatsDAO.get_summary_stats(
                requesting_username=username,
                super_admin_username=SUPER_ADMIN,
                active_users_count=len(_online_users),
            )

            # 2026-05-26 Slice 6: 按 user / org 分组的明细
            breakdown: List[Dict[str, Any]] = []
            if group_by in ('user', 'org'):
                try:
                    # 公共子查询：每个 user 各项资产计数
                    # （complete = files 表过滤已删除；保留与上面一致的视频任务白名单也可，但太复杂；
                    #  这里按 files 表 file_type 简单聚合，保证表能跑）
                    breakdown = await AdminStatsDAO.get_stats_breakdown(
                        group_by=group_by,
                        requesting_username=username,
                        super_admin_username=SUPER_ADMIN,
                    )
                except Exception as e:
                    logger.warning(f"⚠️ stats breakdown 失败 group_by={group_by}: {e}")
                    breakdown = []

            return {
                "success": True,
                "stats": stats,
                "group_by": group_by or 'none',
                "breakdown": breakdown,
            }

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"获取系统统计失败: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/api/admin/logs")
    async def get_admin_logs(username: str = Depends(require_auth), limit: int = 100):
        """获取生成日志（仅管理员）"""
        # 🔐 权限检查：允许admin和超级管理员访问
        if username not in ['admin', SUPER_ADMIN]:
            raise HTTPException(status_code=403, detail="权限不足：仅管理员可访问")

        try:
            logs = await AdminStatsDAO.get_generation_logs(
                requesting_username=username,
                super_admin_username=SUPER_ADMIN,
                limit=limit,
            )

            return {
                "success": True,
                "logs": logs
            }
        except Exception as e:
            logger.error(f"获取生成日志失败: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/api/admin/users/create")
    async def create_user(
        user_data: dict,
        request: Request,
        username: str = Depends(require_auth)
    ):
        """创建新用户（仅管理员）"""
        # 🔐 权限检查
        if username not in ['admin', SUPER_ADMIN]:
            raise HTTPException(status_code=403, detail="权限不足：仅管理员可访问")

        db_manager = get_db_manager()

        try:
            new_username = user_data.get('username')
            password = user_data.get('password')
            email = user_data.get('email') or f"{new_username}@studio.com"
            role = user_data.get('role', 'editor')

            if not new_username or not password:
                raise HTTPException(status_code=400, detail="用户名和密码为必填项")
            if len(str(password)) < 8:
                raise HTTPException(status_code=400, detail="密码至少 8 位")

            # 检查用户名是否已存在
            if new_username in DEFAULT_USERS:
                raise HTTPException(status_code=400, detail="用户名已存在")

            # 添加到DEFAULT_USERS（内存）
            DEFAULT_USERS[new_username] = password

            # 如果数据库可用，同步到数据库
            if db_manager:
                try:
                    from dao_user import UserDAO
                    user = await UserDAO.create_user(
                        username=new_username,
                        password=password,
                        email=email,
                        user_id=new_username,  # user_id 必须 == username（全站资源表外键约定）
                    )
                    logger.info(f"✅ 用户 {new_username} 已创建（ID: {user['user_id'][:12]}...）")
                except Exception as e:
                    logger.warning(f"⚠️ 同步用户到数据库失败: {e}")

            # 审计留痕：新建用户（best-effort，失败不影响主流程）
            try:
                import admin_audit_service
                await admin_audit_service.record(
                    request,
                    admin_user_id=username,
                    action='user_create', target_type='user', target_id=new_username,
                    after={'username': new_username, 'email': email, 'role': role},
                )
            except Exception as _audit_e:
                logger.warning(f"⚠️ 审计记录失败(user_create): {_audit_e}")

            return {
                "success": True,
                "message": "用户创建成功",
                "user": {
                    "username": new_username,
                    "email": email,
                    "role": role
                }
            }
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"创建用户失败: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.delete("/api/admin/users/{user_id}")
    async def delete_user(
        user_id: str,
        username: str = Depends(require_auth)
    ):
        """删除用户（仅管理员）"""
        # 🔐 权限检查：只有admin和超级管理员可以删除用户
        if username not in ['admin', SUPER_ADMIN]:
            raise HTTPException(status_code=403, detail="权限不足：仅管理员可访问")

        db_manager = get_db_manager()

        try:
            # 防止删除自己
            if user_id == username:
                raise HTTPException(status_code=400, detail="不能删除自己的账号")

            # 防止删除admin和超级管理员
            if user_id in ['admin', SUPER_ADMIN]:
                raise HTTPException(status_code=400, detail="不能删除系统管理员账号")

            # 如果数据库可用，从数据库删除
            if db_manager:
                try:
                    # 删除用户记录（使用user_id字段，不是username）
                    from dao_user import UserDAO
                    result = await UserDAO.delete_user_by_id(user_id)

                    logger.info(f"✅ 管理员 {username} 删除了用户: {user_id}，影响行数: {result}")
                    return {
                        "success": True,
                        "message": f"用户 {user_id} 已从数据库删除"
                    }
                except Exception as db_error:
                    logger.error(f"数据库删除用户失败: {db_error}")
                    raise HTTPException(status_code=500, detail=f"数据库删除失败: {str(db_error)}")
            else:
                # 如果没有数据库，只返回成功（前端会从列表移除）
                logger.warning(f"⚠️ 数据库未连接，无法真正删除用户 {user_id}")
                return {
                    "success": True,
                    "message": f"用户 {user_id} 已删除（模拟）"
                }
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"删除用户失败: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    return router
