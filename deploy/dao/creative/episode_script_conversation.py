"""Persistence for script conversations and immutable storyboard-script versions."""
from __future__ import annotations

import json
import uuid
from typing import Any, Dict, List, Optional

from db_manager import get_db_manager


def _json(value: Any, fallback: Any) -> str:
    return json.dumps(value if value is not None else fallback, ensure_ascii=False)


class EpisodeScriptConversationDAO:
    @staticmethod
    async def list_messages(script_id: str) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        rows = await db.fetch(
            """
            SELECT * FROM episode_script_messages
            WHERE script_id = $1
            ORDER BY created_at, id
            """,
            script_id,
        )
        return [dict(row) for row in rows or []]

    @staticmethod
    async def list_versions(script_id: str) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        rows = await db.fetch(
            """
            SELECT * FROM episode_script_versions
            WHERE script_id = $1
            ORDER BY version_no
            """,
            script_id,
        )
        return [dict(row) for row in rows or []]

    @staticmethod
    async def create_message(
        *,
        episode_id: str,
        script_id: str,
        role: str,
        content: str,
        status: str = "completed",
        model_alias: Optional[str] = None,
        provider: Optional[str] = None,
        model_name: Optional[str] = None,
        reply_to_message_id: Optional[str] = None,
        request_id: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        message_id = f"msg_{uuid.uuid4().hex}"
        row = await db.fetchrow(
            """
            INSERT INTO episode_script_messages (
                message_id, episode_id, script_id, role, content, status,
                model_alias, provider, model_name, reply_to_message_id,
                request_id, metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
            ON CONFLICT DO NOTHING
            RETURNING *
            """,
            message_id,
            episode_id,
            script_id,
            role,
            content,
            status,
            model_alias,
            provider,
            model_name,
            reply_to_message_id,
            request_id,
            _json(metadata, {}),
        )
        if row:
            await db.execute(
                """
                UPDATE episode_scripts
                SET last_message_at = CURRENT_TIMESTAMP,
                    default_model = COALESCE($2, default_model)
                WHERE script_id = $1
                """,
                script_id,
                model_name,
            )
            return dict(row)
        if request_id:
            existing = await db.fetchrow(
                """
                SELECT * FROM episode_script_messages
                WHERE script_id = $1 AND request_id = $2
                """,
                script_id,
                request_id,
            )
            return dict(existing) if existing else None
        return None

    @staticmethod
    async def update_message(
        script_id: str,
        message_id: str,
        *,
        content: Optional[str] = None,
        status: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        row = await db.fetchrow(
            """
            UPDATE episode_script_messages
            SET content = COALESCE($3, content),
                status = COALESCE($4, status),
                metadata = COALESCE($5::jsonb, metadata),
                updated_at = CURRENT_TIMESTAMP
            WHERE script_id = $1 AND message_id = $2
            RETURNING *
            """,
            script_id,
            message_id,
            content,
            status,
            _json(metadata, {}) if metadata is not None else None,
        )
        return dict(row) if row else None

    @staticmethod
    async def create_version(
        *,
        episode_id: str,
        script_id: str,
        content: str,
        storyboard_items: list,
        message_id: Optional[str] = None,
        source: str = "ai",
        status: str = "ready",
        model_alias: Optional[str] = None,
        provider: Optional[str] = None,
        model_name: Optional[str] = None,
        metadata: Optional[dict] = None,
        set_current: bool = True,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        async with db.acquire() as conn:
            async with conn.transaction():
                script = await conn.fetchrow(
                    """
                    SELECT script_id FROM episode_scripts
                    WHERE script_id = $1 AND episode_id = $2
                    FOR UPDATE
                    """,
                    script_id,
                    episode_id,
                )
                if not script:
                    return None
                if message_id:
                    existing = await conn.fetchrow(
                        "SELECT * FROM episode_script_versions WHERE message_id = $1",
                        message_id,
                    )
                    if existing:
                        return dict(existing)
                version_no = await conn.fetchval(
                    """
                    SELECT COALESCE(MAX(version_no), 0) + 1
                    FROM episode_script_versions
                    WHERE script_id = $1
                    """,
                    script_id,
                )
                version_id = f"ver_{uuid.uuid4().hex}"
                row = await conn.fetchrow(
                    """
                    INSERT INTO episode_script_versions (
                        version_id, episode_id, script_id, message_id, version_no,
                        content, storyboard_items, source, status, model_alias,
                        provider, model_name, metadata
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9,
                            $10, $11, $12, $13::jsonb)
                    RETURNING *
                    """,
                    version_id,
                    episode_id,
                    script_id,
                    message_id,
                    version_no,
                    content,
                    _json(storyboard_items, []),
                    source,
                    status,
                    model_alias,
                    provider,
                    model_name,
                    _json(metadata, {}),
                )
                if set_current:
                    await conn.execute(
                        """
                        UPDATE episode_scripts
                        SET current_version_id = $2,
                            adapted_script = $3,
                            last_message_at = CURRENT_TIMESTAMP,
                            default_model = COALESCE($4, default_model),
                            updated_at = CURRENT_TIMESTAMP
                        WHERE script_id = $1
                        """,
                        script_id,
                        version_id,
                        content,
                        model_name,
                    )
                return dict(row) if row else None

    @staticmethod
    async def select_version(script_id: str, version_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        async with db.acquire() as conn:
            async with conn.transaction():
                version = await conn.fetchrow(
                    """
                    SELECT * FROM episode_script_versions
                    WHERE script_id = $1 AND version_id = $2
                    """,
                    script_id,
                    version_id,
                )
                if not version:
                    return None
                await conn.execute(
                    """
                    UPDATE episode_scripts
                    SET current_version_id = $2,
                        adapted_script = $3,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE script_id = $1
                    """,
                    script_id,
                    version_id,
                    version["content"],
                )
                return dict(version)

    @staticmethod
    async def merge_version_metadata(
        script_id: str,
        version_id: str,
        metadata: dict,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        row = await db.fetchrow(
            """
            UPDATE episode_script_versions
            SET metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
                updated_at = CURRENT_TIMESTAMP
            WHERE script_id = $1 AND version_id = $2
            RETURNING *
            """,
            script_id,
            version_id,
            _json(metadata, {}),
        )
        return dict(row) if row else None
