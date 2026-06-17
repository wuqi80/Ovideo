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
import secrets
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_secret_key: str = ""


def _resolve_secret(secret_key: str = "") -> str:
    """解析 JWT 签名密钥。

    安全要求：绝不使用硬编码默认密钥（否则任何拿到源码者都能伪造 admin 令牌）。
    优先级：显式传参 → 环境变量 JWT_SECRET_KEY（生产推荐）
            → 持久化随机密钥文件 deploy/.jwt_secret（gitignored，重启不失效，零配置即安全）
            → 进程内随机（文件不可写时的兜底；重启会使令牌失效但绝不硬编码）。
    """
    if secret_key:
        return secret_key
    env = os.environ.get("JWT_SECRET_KEY")
    if env:
        return env
    secret_file = Path(__file__).resolve().parent.parent / ".jwt_secret"
    try:
        if secret_file.exists():
            val = secret_file.read_text(encoding="utf-8").strip()
            if val:
                return val
        new = secrets.token_urlsafe(48)
        secret_file.write_text(new, encoding="utf-8")
        try:
            os.chmod(secret_file, 0o600)
        except Exception:
            pass
        logger.warning(
            "⚠️ 未设置 JWT_SECRET_KEY，已生成随机密钥并持久化到 deploy/.jwt_secret"
            "（生产建议改用环境变量注入；本次更换会使旧令牌全部失效，需重新登录）"
        )
        return new
    except Exception as e:
        logger.error(
            f"无法持久化 JWT 密钥（{e}），改用进程内随机密钥；重启将使令牌失效。"
            "请设置 JWT_SECRET_KEY 环境变量。"
        )
        return secrets.token_urlsafe(48)


def init(secret_key: str = ""):
    """初始化签名密钥"""
    global _secret_key
    _secret_key = _resolve_secret(secret_key)
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
