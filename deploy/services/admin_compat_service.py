"""Business logic for legacy admin compatibility endpoints."""
from __future__ import annotations

from typing import Any, Callable, Dict, Optional


class AdminCompatServiceError(RuntimeError):
    pass


class AdminCompatForbidden(AdminCompatServiceError):
    pass


class InvalidGroupBy(AdminCompatServiceError):
    pass


class MissingUserCredentials(AdminCompatServiceError):
    pass


class WeakPassword(AdminCompatServiceError):
    pass


class UsernameExists(AdminCompatServiceError):
    pass


class SelfDeleteForbidden(AdminCompatServiceError):
    pass


class SystemUserDeleteForbidden(AdminCompatServiceError):
    pass


class UserDeleteFailed(AdminCompatServiceError):
    pass


def _require_admin(username: str, *, super_admin: str) -> None:
    if username not in {"admin", super_admin}:
        raise AdminCompatForbidden("权限不足：仅管理员可访问")


async def get_admin_stats_response(
    username: str,
    *,
    group_by: Optional[str],
    super_admin: str,
    active_users_count: int,
    admin_stats_dao: Any,
    logger: Any,
) -> Dict[str, Any]:
    _require_admin(username, super_admin=super_admin)
    if group_by not in (None, "none", "user", "org"):
        raise InvalidGroupBy("group_by 必须是 'none'|'user'|'org'")

    stats = await admin_stats_dao.get_summary_stats(
        requesting_username=username,
        super_admin_username=super_admin,
        active_users_count=active_users_count,
    )

    breakdown = []
    if group_by in ("user", "org"):
        try:
            breakdown = await admin_stats_dao.get_stats_breakdown(
                group_by=group_by,
                requesting_username=username,
                super_admin_username=super_admin,
            )
        except Exception as exc:
            logger.warning("stats breakdown failed group_by=%s: %s", group_by, exc)
            breakdown = []

    return {
        "success": True,
        "stats": stats,
        "group_by": group_by or "none",
        "breakdown": breakdown,
    }


async def get_admin_logs_response(
    username: str,
    *,
    limit: int,
    super_admin: str,
    admin_stats_dao: Any,
) -> Dict[str, Any]:
    _require_admin(username, super_admin=super_admin)
    logs = await admin_stats_dao.get_generation_logs(
        requesting_username=username,
        super_admin_username=super_admin,
        limit=limit,
    )
    return {"success": True, "logs": logs}


async def create_admin_user_response(
    user_data: Dict[str, Any],
    *,
    request: Any,
    admin_username: str,
    super_admin: str,
    default_users: Dict[str, str],
    user_dao: Any,
    audit_record: Optional[Callable[..., Any]],
    logger: Any,
) -> Dict[str, Any]:
    _require_admin(admin_username, super_admin=super_admin)

    new_username = user_data.get("username")
    password = user_data.get("password")
    email = user_data.get("email") or f"{new_username}@studio.com"
    role = user_data.get("role", "editor")

    if not new_username or not password:
        raise MissingUserCredentials("用户名和密码为必填项")
    if len(str(password)) < 8:
        raise WeakPassword("密码至少 8 位")
    if new_username in default_users:
        raise UsernameExists("用户名已存在")

    default_users[new_username] = password

    try:
        user = await user_dao.create_user(
            username=new_username,
            password=password,
            email=email,
            user_id=new_username,
        )
        logger.info("用户 %s 已创建(ID: %s...)", new_username, user["user_id"][:12])
    except Exception as exc:
        logger.warning("同步用户到数据库失败: %s", exc)

    if audit_record is not None:
        try:
            await audit_record(
                request,
                admin_user_id=admin_username,
                action="user_create",
                target_type="user",
                target_id=new_username,
                after={"username": new_username, "email": email, "role": role},
            )
        except Exception as exc:
            logger.warning("审计记录失败(user_create): %s", exc)

    return {
        "success": True,
        "message": "用户创建成功",
        "user": {
            "username": new_username,
            "email": email,
            "role": role,
        },
    }


async def delete_admin_user_response(
    user_id: str,
    *,
    admin_username: str,
    super_admin: str,
    user_dao: Any,
    logger: Any,
) -> Dict[str, Any]:
    _require_admin(admin_username, super_admin=super_admin)
    if user_id == admin_username:
        raise SelfDeleteForbidden("不能删除自己的账号")
    if user_id in {"admin", super_admin}:
        raise SystemUserDeleteForbidden("不能删除系统管理员账号")

    try:
        result = await user_dao.delete_user_by_id(user_id)
    except Exception as exc:
        logger.error("数据库删除用户失败: %s", exc)
        raise UserDeleteFailed(f"数据库删除失败: {exc}") from exc

    if result is None:
        logger.warning("数据库未连接，无法真正删除用户 %s", user_id)
        return {"success": True, "message": f"用户 {user_id} 已删除（模拟）"}

    logger.info("管理员 %s 删除了用户 %s，影响行数 %s", admin_username, user_id, result)
    return {"success": True, "message": f"用户 {user_id} 已从数据库删除"}
