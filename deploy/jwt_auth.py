"""
JWT 无状态令牌认证模块
使用 HMAC-SHA256 签名，零外部依赖
"""
import hmac
import hashlib
import json
import base64
import time
import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

_secret_key: str = ""

def init(secret_key: str = ""):
    """初始化签名密钥"""
    global _secret_key
    _secret_key = secret_key or os.environ.get("JWT_SECRET_KEY", "messiah-default-jwt-secret-2026")
    logger.info("✅ JWT 认证模块已初始化")

def create_token(username: str, ttl: int = 86400) -> str:
    """
    创建签名令牌
    Args:
        username: 用户名
        ttl: 过期时间（秒），默认 24 小时
    Returns:
        格式: {base64_payload}.{hex_signature}
    """
    now = int(time.time())
    payload = json.dumps({"u": username, "exp": now + ttl, "iat": now}, separators=(',', ':'))
    payload_b64 = base64.urlsafe_b64encode(payload.encode()).decode().rstrip('=')
    sig = hmac.new(_secret_key.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}"

def verify_token(token: str) -> Optional[str]:
    """
    验证令牌签名和过期时间
    Args:
        token: Bearer token 字符串
    Returns:
        验证成功返回 username，失败返回 None
    """
    if not token or '.' not in token:
        return None
    try:
        payload_b64, sig = token.rsplit('.', 1)
        expected = hmac.new(_secret_key.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        padding = 4 - len(payload_b64) % 4
        if padding != 4:
            payload_b64 += '=' * padding
        data = json.loads(base64.urlsafe_b64decode(payload_b64))
        if data.get("exp", 0) < time.time():
            logger.debug(f"Token 已过期: {data.get('u')}")
            return None
        return data.get("u")
    except Exception as e:
        logger.debug(f"Token 验证失败: {e}")
        return None
