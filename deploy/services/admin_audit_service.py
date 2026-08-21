# -*- coding: utf-8 -*-
"""
Admin Audit Service
====================
封装 admin_audit_logs 写入：自动抽取 request.client.host / headers['user-agent']。

"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from dao_admin_audit import AdminAuditLogDAO

logger = logging.getLogger(__name__)


async def record(
    request,
    *,
    admin_user_id: str,
    action: str,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    before: Optional[Dict[str, Any]] = None,
    after: Optional[Dict[str, Any]] = None,
    notes: str = '',
) -> None:
    """写入审计记录，best-effort：失败仅记 warning。"""
    try:
        ip = None
        user_agent = None
        if request is not None:
            try:
                ip = getattr(getattr(request, 'client', None), 'host', None)
            except Exception:
                ip = None
            try:
                headers = getattr(request, 'headers', None)
                if headers:
                    user_agent = headers.get('user-agent') or headers.get('User-Agent')
            except Exception:
                user_agent = None

        await AdminAuditLogDAO.create(
            admin_user_id=admin_user_id or 'unknown',
            action=action,
            target_type=target_type,
            target_id=target_id,
            before_data=before,
            after_data=after,
            ip=ip,
            user_agent=user_agent,
            notes=notes,
        )
    except Exception as e:
        logger.warning(f"admin_audit_service.record 失败 (action={action}): {e}")


def caller_admin_id(request) -> str:
    """
    从 request 中提取当前管理员 ID。
    暂时降级为：从 JWT token 解出用户名（沿用 jwt_auth.verify_token）；
    后续 Slice 加 role check 时再升级到正式 require_admin 依赖。
    """
    try:
        auth = request.headers.get('Authorization') or ''
        if not auth.startswith('Bearer '):
            return 'unknown'
        token = auth[7:]
        import jwt_auth
        name = jwt_auth.verify_token(token)
        return name or 'unknown'
    except Exception:
        return 'unknown'
