# -*- coding: utf-8 -*-
"""
ComfyUI Agent DAO -- comfyui_agents 表的增删改查
"""
import json
import secrets
import uuid
from typing import Any, Dict, List, Optional

from db_manager import get_db_manager


def _decode_json_fields(row: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not row:
        return row
    normalized = dict(row)
    for field in ("comfyui_instances", "system_info", "stats"):
        value = normalized.get(field)
        if isinstance(value, str):
            try:
                normalized[field] = json.loads(value)
            except (TypeError, ValueError):
                pass
    return normalized


def _decode_json_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [_decode_json_fields(row) for row in rows]


class AgentDAO:

    @staticmethod
    def generate_token() -> str:
        return f"sk-agent-{secrets.token_hex(24)}"

    @staticmethod
    async def create(name: str, token: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        agent_id = f"agent_{uuid.uuid4().hex[:12]}"
        query = """
            INSERT INTO comfyui_agents (agent_id, name, token, created_at)
            VALUES ($1, $2, $3, clock_timestamp())
            RETURNING *
        """
        return _decode_json_fields(
            await db.fetchrow(query, agent_id, name, token)
        )

    @staticmethod
    async def get_by_id(agent_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return _decode_json_fields(
            await db.fetchrow(
                "SELECT * FROM comfyui_agents WHERE agent_id = $1", agent_id
            )
        )

    @staticmethod
    async def get_by_token(token: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return _decode_json_fields(
            await db.fetchrow(
                "SELECT * FROM comfyui_agents WHERE token = $1", token
            )
        )

    @staticmethod
    async def update_heartbeat(
        agent_id: str,
        status: str = "online",
        comfyui_instances: Optional[list] = None,
        system_info: Optional[dict] = None,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        ci_json = (
            json.dumps(comfyui_instances, ensure_ascii=False)
            if comfyui_instances is not None
            else None
        )
        si_json = (
            json.dumps(system_info, ensure_ascii=False)
            if system_info is not None
            else None
        )
        query = """
            UPDATE comfyui_agents
            SET
                status = $2,
                last_heartbeat = CURRENT_TIMESTAMP,
                comfyui_instances = COALESCE($3::jsonb, comfyui_instances),
                system_info = COALESCE($4::jsonb, system_info)
            WHERE agent_id = $1
            RETURNING *
        """
        return _decode_json_fields(
            await db.fetchrow(query, agent_id, status, ci_json, si_json)
        )

    @staticmethod
    async def update_stats(
        agent_id: str, stats: dict
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return _decode_json_fields(
            await db.fetchrow(
                """
                UPDATE comfyui_agents
                SET stats = $2::jsonb
                WHERE agent_id = $1
                RETURNING *
                """,
                agent_id,
                json.dumps(stats, ensure_ascii=False),
            )
        )

    @staticmethod
    async def list_all() -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return _decode_json_rows(
            await db.fetch(
                "SELECT * FROM comfyui_agents ORDER BY created_at DESC"
            )
        )

    @staticmethod
    async def list_all_with_active_task_counts() -> List[Dict[str, Any]]:
        """Return agents with the number of GPU tasks currently assigned to each one."""
        db = get_db_manager()
        if not db:
            return []
        return _decode_json_rows(
            await db.fetch(
                """
                SELECT a.*,
                       COALESCE((
                           SELECT COUNT(*)::int
                           FROM tasks t
                           WHERE t.node_id = a.agent_id
                             AND t.status IN ('processing', 'running')
                       ), 0) AS active_tasks
                FROM comfyui_agents a
                ORDER BY a.created_at DESC
                """
            )
        )

    @staticmethod
    async def get_online_agents() -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return _decode_json_rows(
            await db.fetch(
                """
                SELECT * FROM comfyui_agents
                WHERE status = 'online' AND enabled = true
                ORDER BY created_at DESC
                """
            )
        )

    @staticmethod
    async def set_enabled(
        agent_id: str, enabled: bool
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return _decode_json_fields(
            await db.fetchrow(
                """
                UPDATE comfyui_agents SET enabled = $2
                WHERE agent_id = $1
                RETURNING *
                """,
                agent_id,
                enabled,
            )
        )

    @staticmethod
    async def rename_display_name(
        agent_id: str, display_name: str
    ) -> Optional[Dict[str, Any]]:
        """Rename the operator-facing label without changing routing identity."""
        db = get_db_manager()
        if not db:
            return None
        return _decode_json_fields(
            await db.fetchrow(
                """
                UPDATE comfyui_agents
                SET display_name = $2
                WHERE agent_id = $1
                RETURNING *
                """,
                agent_id,
                display_name,
            )
        )

    @staticmethod
    async def delete(agent_id: str) -> bool:
        db = get_db_manager()
        if not db:
            return False
        result = await db.execute(
            "DELETE FROM comfyui_agents WHERE agent_id = $1", agent_id
        )
        return result == "DELETE 1"

    @staticmethod
    async def mark_stale_offline(timeout_seconds: int = 15) -> int:
        db = get_db_manager()
        if not db:
            return 0
        query = """
            UPDATE comfyui_agents
            SET status = 'offline'
            WHERE status = 'online'
              AND (
                  last_heartbeat IS NULL
                  OR last_heartbeat < (NOW() - ($1::bigint * interval '1 second'))
              )
        """
        result = await db.execute(query, timeout_seconds)
        parts = result.split()
        if len(parts) >= 2 and parts[0] == "UPDATE":
            try:
                return int(parts[1])
            except ValueError:
                return 0
        return 0
