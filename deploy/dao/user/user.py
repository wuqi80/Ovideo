# -*- coding: utf-8 -*-
"""
用户数据访问对象 (DAO)
"""
import uuid
import json
import logging
from typing import Optional, List, Dict, Any
from datetime import datetime
from db_manager import get_db_manager
import hashlib

logger = logging.getLogger(__name__)

class UserDAO:
    """用户数据访问对象"""
    
    @staticmethod
    async def create_user(
        username: str, 
        password: str, 
        email: Optional[str] = None,
        user_id: Optional[str] = None,
        password_hash: Optional[str] = None
    ) -> Dict[str, Any]:
        """创建新用户
        
        Args:
            username: 用户名
            password: 密码（如果提供了password_hash则忽略）
            email: 邮箱
            user_id: 用户ID（可选，如果不提供则自动生成）
            password_hash: 密码哈希（可选，如果不提供则从password生成）
        """
        db = get_db_manager()
        
        # 如果没有提供user_id，则自动生成
        if not user_id:
            user_id = f"user_{uuid.uuid4().hex[:12]}"
        
        # 如果没有提供password_hash，则从password生成
        if not password_hash:
            password_hash = hashlib.sha256(password.encode()).hexdigest()
        
        query = """
            INSERT INTO users (user_id, username, password_hash, email)
            VALUES ($1, $2, $3, $4)
            RETURNING id, user_id, username, email, created_at
        """
        return await db.fetchrow(query, user_id, username, password_hash, email)
    
    @staticmethod
    async def get_user_by_id(user_id: str) -> Optional[Dict[str, Any]]:
        """根据user_id获取用户"""
        db = get_db_manager()
        query = """
            SELECT id, user_id, username, email, avatar_url, 
                   storage_quota_gb, used_storage_bytes, created_at, 
                   last_login_at, is_active
            FROM users
            WHERE user_id = $1 AND is_active = TRUE
        """
        return await db.fetchrow(query, user_id)

    @staticmethod
    async def delete_user_by_id(user_id: str) -> Optional[str]:
        """Hard-delete a user row by user_id for the legacy admin endpoint."""
        db = get_db_manager()
        if not db:
            logger.warning("delete_user_by_id skipped because database manager is unavailable: %s", user_id)
            return None
        return await db.execute(
            "DELETE FROM users WHERE user_id = $1",
            user_id,
        )
    
    @staticmethod
    async def get_user_by_username(username: str) -> Optional[Dict[str, Any]]:
        """根据用户名获取用户"""
        db = get_db_manager()
        # 2026-05-26 Slice 4: 同时返回 role/status/disabled_reason（列不存在时降级）
        try:
            query = """
                SELECT id, user_id, username, password_hash, email, avatar_url,
                       storage_quota_gb, used_storage_bytes, created_at,
                       last_login_at, is_active,
                       role, status, disabled_reason
                FROM users
                WHERE username = $1 AND is_active = TRUE
            """
            return await db.fetchrow(query, username)
        except Exception:
            query = """
                SELECT id, user_id, username, password_hash, email, avatar_url,
                       storage_quota_gb, used_storage_bytes, created_at,
                       last_login_at, is_active
                FROM users
                WHERE username = $1 AND is_active = TRUE
            """
            return await db.fetchrow(query, username)

    @staticmethod
    async def is_admin_user(username: str) -> bool:
        """Return whether a username has platform-admin privileges."""
        if not username:
            return False
        if username == "admin":
            # Built-in bootstrap admin remains valid even before role seeding.
            return True
        user = await UserDAO.get_user_by_username(username)
        return bool(user and user.get("role") in ("admin", "super_admin"))
    
    @staticmethod
    async def verify_password(username: str, password: str) -> Optional[Dict[str, Any]]:
        """验证用户密码"""
        user = await UserDAO.get_user_by_username(username)
        if not user:
            return None
        
        password_hash = hashlib.sha256(password.encode()).hexdigest()
        if user['password_hash'] == password_hash:
            # 更新最后登录时间
            await UserDAO.update_last_login(user['user_id'])
            return user
        return None
    
    @staticmethod
    async def update_last_login(user_id: str):
        """更新最后登录时间"""
        db = get_db_manager()
        query = """
            UPDATE users
            SET last_login_at = $1
            WHERE user_id = $2
        """
        await db.execute(query, datetime.now(), user_id)
    
    @staticmethod
    async def get_storage_stats(user_id: str) -> Dict[str, Any]:
        """获取用户存储统计"""
        db = get_db_manager()
        query = """
            SELECT * FROM user_storage_stats
            WHERE user_id = $1
        """
        return await db.fetchrow(query, user_id)
    
    @staticmethod
    async def update_user_profile(user_id: str, **kwargs) -> bool:
        """更新用户资料"""
        db = get_db_manager()
        
        # 构建动态更新SQL
        fields = []
        values = []
        param_idx = 1
        
        for key, value in kwargs.items():
            if key in ['email', 'avatar_url', 'storage_quota_gb']:
                fields.append(f"{key} = ${param_idx}")
                values.append(value)
                param_idx += 1
        
        if not fields:
            return False
        
        values.append(user_id)
        query = f"""
            UPDATE users
            SET {', '.join(fields)}, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ${param_idx}
        """
        
        await db.execute(query, *values)
        return True
    
    @staticmethod
    async def update_user_permissions(user_id: str, permissions: Dict[str, Any]) -> bool:
        """更新用户权限
        
        Args:
            user_id: 用户ID
            permissions: 权限配置字典
        """
        db = get_db_manager()
        
        # 更新权限（启动时已确保字段存在）
        # asyncpg会自动处理JSONB类型，不需要json.dumps
        query = """
            UPDATE users
            SET permissions = $1::jsonb, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = $2
        """
        result = await db.execute(query, json.dumps(permissions), user_id)
        
        # 验证更新
        verify_query = "SELECT permissions FROM users WHERE user_id = $1"
        row = await db.fetchrow(verify_query, user_id)
        if row:
            logger.info(f"🔍 验证用户 {user_id} 权限更新: {type(row['permissions']).__name__} = {row['permissions']}")
        
        return result == "UPDATE 1"
    
    @staticmethod
    async def get_user_permissions(user_id: str) -> Optional[Dict[str, Any]]:
        """获取用户权限
        
        Args:
            user_id: 用户ID
        """
        db = get_db_manager()
        
        query = """
            SELECT permissions FROM users WHERE user_id = $1
        """
        row = await db.fetchrow(query, user_id)
        if row and row['permissions']:
            return json.loads(row['permissions']) if isinstance(row['permissions'], str) else row['permissions']
        return None

    # ============================================
    # 2026-05-26 Slice 4: 管理员侧扩展
    # 详见 docs/superpowers/plans/2026-05-26-feature-rollout/04-admin-users-project-groups.md
    # ============================================

    @staticmethod
    async def admin_list_users(
        keyword: Optional[str] = None,
        role: Optional[str] = None,
        status_filter: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """管理员列表：分页 + 关键字 + 过滤。返回 role/status 字段（若已 ALTER）。"""
        db = get_db_manager()
        where = ["1=1"]
        params: List[Any] = []
        idx = 1
        if keyword:
            where.append(f"(username ILIKE ${idx} OR email ILIKE ${idx})")
            params.append(f"%{keyword}%"); idx += 1
        if role:
            where.append(f"role = ${idx}"); params.append(role); idx += 1
        if status_filter:
            where.append(f"status = ${idx}"); params.append(status_filter); idx += 1
        params.extend([limit, offset])
        try:
            rows = await db.fetch(
                f"""
                SELECT user_id, username, email, avatar_url, role, status,
                       disabled_reason, disabled_at, disabled_by, plan_tier,
                       storage_quota_gb, used_storage_bytes, created_at, last_login_at, is_active,
                       permissions
                FROM users
                WHERE {' AND '.join(where)}
                ORDER BY created_at DESC
                LIMIT ${idx} OFFSET ${idx + 1}
                """,
                *params,
            )
        except Exception:
            # 列尚未 ALTER（极端情况）；降级到基础字段
            # 2026-05-26：永远尝试带上 permissions（来自 db_migration_add_permissions.sql）；
            # 若该列也缺，进一步降级到不带 permissions 的最小集
            try:
                rows = await db.fetch(
                    f"""
                    SELECT user_id, username, email, avatar_url,
                           storage_quota_gb, used_storage_bytes, created_at, last_login_at, is_active,
                           permissions
                    FROM users
                    WHERE {' AND '.join(where)}
                    ORDER BY created_at DESC
                    LIMIT ${idx} OFFSET ${idx + 1}
                    """,
                    *params,
                )
            except Exception:
                rows = await db.fetch(
                    f"""
                    SELECT user_id, username, email, avatar_url,
                           storage_quota_gb, used_storage_bytes, created_at, last_login_at, is_active
                    FROM users
                    WHERE {' AND '.join(where)}
                    ORDER BY created_at DESC
                    LIMIT ${idx} OFFSET ${idx + 1}
                    """,
                    *params,
                )
        return [dict(r) for r in rows]

    @staticmethod
    async def admin_count_users(
        keyword: Optional[str] = None,
        role: Optional[str] = None,
        status_filter: Optional[str] = None,
    ) -> int:
        db = get_db_manager()
        where = ["1=1"]
        params: List[Any] = []
        idx = 1
        if keyword:
            where.append(f"(username ILIKE ${idx} OR email ILIKE ${idx})")
            params.append(f"%{keyword}%"); idx += 1
        if role:
            where.append(f"role = ${idx}"); params.append(role); idx += 1
        if status_filter:
            where.append(f"status = ${idx}"); params.append(status_filter); idx += 1
        try:
            n = await db.fetchval(
                f"SELECT COUNT(*) FROM users WHERE {' AND '.join(where)}",
                *params,
            )
        except Exception:
            n = await db.fetchval("SELECT COUNT(*) FROM users")
        return int(n or 0)

    @staticmethod
    async def set_role(user_id: str, role: str) -> bool:
        db = get_db_manager()
        result = await db.execute(
            "UPDATE users SET role = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1",
            user_id, role,
        )
        return result == "UPDATE 1"

    @staticmethod
    async def set_status(
        user_id: str,
        status: str,
        *,
        disabled_reason: Optional[str] = None,
        disabled_by: Optional[str] = None,
    ) -> bool:
        db = get_db_manager()
        if status == 'active':
            result = await db.execute(
                """
                UPDATE users
                SET status = 'active',
                    disabled_reason = NULL,
                    disabled_at = NULL,
                    disabled_by = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = $1
                """,
                user_id,
            )
        else:
            result = await db.execute(
                """
                UPDATE users
                SET status = $2,
                    disabled_reason = $3,
                    disabled_at = CURRENT_TIMESTAMP,
                    disabled_by = $4,
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = $1
                """,
                user_id, status, disabled_reason, disabled_by,
            )
        return result == "UPDATE 1"

    @staticmethod
    async def reset_password(user_id: str, new_password: str) -> bool:
        """重置密码（管理员用）。"""
        db = get_db_manager()
        new_hash = hashlib.sha256(new_password.encode()).hexdigest()
        result = await db.execute(
            "UPDATE users SET password_hash = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1",
            user_id, new_hash,
        )
        return result == "UPDATE 1"

    @staticmethod
    async def is_status_active(user_id: str) -> bool:
        """检查 status 是否为 active。列不存在时默认 True。"""
        db = get_db_manager()
        try:
            v = await db.fetchval(
                "SELECT status FROM users WHERE user_id = $1",
                user_id,
            )
            return (v or 'active') == 'active'
        except Exception:
            return True
