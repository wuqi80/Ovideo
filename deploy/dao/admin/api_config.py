# -*- coding: utf-8 -*-
"""
API configuration DAO -- api_configurations 表的增删改查
"""
import base64
import json
import logging
import os
import uuid
from typing import Any, Dict, List, Optional

from db_manager import get_db_manager

logger = logging.getLogger(__name__)

try:
    from cryptography.fernet import Fernet, InvalidToken
    _HAS_FERNET = True
except ImportError:
    _HAS_FERNET = False

_FERNET_PREFIX = "fernet:"


def _get_fernet():
    """从环境变量 API_CONFIG_ENC_KEY 取 Fernet 实例。
    未配置/无效则返回 None → 退回 base64（与历史一致，保证不破坏现有功能）。"""
    key = os.getenv("API_CONFIG_ENC_KEY")
    if not key or not _HAS_FERNET:
        return None
    try:
        return Fernet(key.encode() if isinstance(key, str) else key)
    except Exception as e:
        logger.warning(f"API_CONFIG_ENC_KEY 无效，退回 base64：{e}")
        return None


class ApiConfigDAO:
    @staticmethod
    def _encrypt_key(key: str) -> str:
        # 安全：DB 存 API key 改为 Fernet 真加密（原先只是 base64 伪加密，DB 泄露即明文）。
        # 配置了 API_CONFIG_ENC_KEY 才真加密；未配置则退回 base64（不破坏本地/历史）。
        if not key:
            return ""
        f = _get_fernet()
        if f:
            return _FERNET_PREFIX + f.encrypt(key.encode()).decode()
        return base64.b64encode(key.encode()).decode()

    @staticmethod
    def _decrypt_key(encrypted: str) -> str:
        # 向后兼容：fernet: 前缀走 Fernet 解密；否则按旧 base64 值处理。
        if not encrypted:
            return ""
        if encrypted.startswith(_FERNET_PREFIX):
            f = _get_fernet()
            if not f:
                logger.error("遇到 Fernet 加密的 API key 但 API_CONFIG_ENC_KEY 未配置/无效，无法解密")
                return ""
            try:
                return f.decrypt(encrypted[len(_FERNET_PREFIX):].encode()).decode()
            except InvalidToken:
                logger.error("API key Fernet 解密失败（密钥不匹配？）")
                return ""
        try:
            return base64.b64decode(encrypted.encode()).decode()
        except Exception:
            return encrypted

    @staticmethod
    def decrypt_key(encrypted: str) -> str:
        """Public API for decrypting stored API keys."""
        return ApiConfigDAO._decrypt_key(encrypted)

    @staticmethod
    async def create(
        name: str,
        provider: str,
        endpoint: str,
        api_key: str,
        model_name: str = "",
        proxy_mode: str = "direct",
        request_template: Optional[dict] = None,
        headers: Optional[dict] = None,
        custom_proxy: str = "",
        category: str = "",
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        config_id = f"apicfg_{uuid.uuid4().hex[:12]}"
        enc = ApiConfigDAO._encrypt_key(api_key)
        rt = json.dumps(
            request_template if request_template is not None else {},
            ensure_ascii=False,
        )
        hd = json.dumps(headers if headers is not None else {}, ensure_ascii=False)
        # 2026-05-24：加 category 列。CHECK 约束在 schema 里强制 ('','text','image','video','audio')。
        query = """
            INSERT INTO api_configurations (
                config_id, name, provider, endpoint, api_key_encrypted,
                model_name, request_template, headers, proxy_mode, custom_proxy, category
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)
            RETURNING *
        """
        return await db.fetchrow(
            query,
            config_id,
            name,
            provider,
            endpoint,
            enc,
            model_name,
            rt,
            hd,
            proxy_mode,
            custom_proxy,
            category,
        )

    @staticmethod
    async def get_by_id(config_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            "SELECT * FROM api_configurations WHERE config_id = $1", config_id
        )

    @staticmethod
    async def get_decrypted_key(config_id: str) -> Optional[str]:
        row = await ApiConfigDAO.get_by_id(config_id)
        if not row:
            return None
        enc = row.get("api_key_encrypted")
        if enc is None or enc == "":
            return None
        return ApiConfigDAO.decrypt_key(enc)

    @staticmethod
    async def list_all() -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch(
            "SELECT * FROM api_configurations ORDER BY name"
        )

    @staticmethod
    async def list_enabled() -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch(
            """
            SELECT * FROM api_configurations
            WHERE enabled = TRUE
            ORDER BY name
            """
        )

    @staticmethod
    async def list_by_proxy_mode(mode: str) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch(
            """
            SELECT * FROM api_configurations
            WHERE proxy_mode = $1 AND enabled = TRUE
            ORDER BY name
            """,
            mode,
        )

    @staticmethod
    async def update(
        config_id: str, **kwargs: Any
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        allowed_json = {"request_template", "headers"}
        # 2026-05-24：把 category 列入可更新字段，admin UI 编辑表单可改分类。
        allowed_plain = {
            "name",
            "provider",
            "endpoint",
            "model_name",
            "proxy_mode",
            "custom_proxy",
            "enabled",
            "category",
        }
        sets: List[str] = []
        vals: List[Any] = []
        idx = 1

        if "api_key" in kwargs:
            sets.append(f"api_key_encrypted = ${idx}")
            vals.append(ApiConfigDAO._encrypt_key(kwargs["api_key"]))
            idx += 1

        for key, val in kwargs.items():
            if key == "api_key":
                continue
            if key in allowed_json:
                sets.append(f"{key} = ${idx}::jsonb")
                vals.append(
                    json.dumps(val if val is not None else {}, ensure_ascii=False)
                )
                idx += 1
            elif key in allowed_plain and val is not None:
                sets.append(f"{key} = ${idx}")
                vals.append(val)
                idx += 1

        if not sets:
            return await ApiConfigDAO.get_by_id(config_id)

        vals.append(config_id)
        query = (
            f"UPDATE api_configurations SET {', '.join(sets)} "
            f"WHERE config_id = ${idx} RETURNING *"
        )
        return await db.fetchrow(query, *vals)

    @staticmethod
    async def update_by_id(
        config_id: str, fields: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        # 2026-05-24：dict-style 包装，方便 admin Pydantic body.dict() 直接传入。
        # 内部仍走 update() 的 allowed_json/allowed_plain 白名单过滤。
        return await ApiConfigDAO.update(config_id, **(fields or {}))

    @staticmethod
    async def delete(config_id: str) -> bool:
        db = get_db_manager()
        if not db:
            return False
        result = await db.execute(
            "DELETE FROM api_configurations WHERE config_id = $1", config_id
        )
        return result == "DELETE 1"
