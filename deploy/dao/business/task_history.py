# -*- coding: utf-8 -*-
"""
Task history DAO -- task_history 表的增删改查与统计
"""
import json
from typing import Any, Dict, List, Optional

from db_manager import get_db_manager


class TaskHistoryDAO:
    @staticmethod
    async def create(
        task_id: str,
        task_type: str = "comfyui",
        agent_id: Optional[str] = None,
        workflow_id: Optional[str] = None,
        params: Optional[dict] = None,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        p = json.dumps(params if params is not None else {}, ensure_ascii=False)
        query = """
            INSERT INTO task_history (
                task_id, agent_id, workflow_id, task_type, params, status
            )
            VALUES ($1, $2, $3, $4, $5::jsonb, 'queued')
            RETURNING *
        """
        return await db.fetchrow(
            query, task_id, agent_id, workflow_id, task_type, p
        )

    @staticmethod
    async def update_status(
        task_id: str,
        status: str,
        agent_id: Optional[str] = None,
        result: Optional[dict] = None,
        error_message: str = "",
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        res_json = (
            json.dumps(result, ensure_ascii=False) if result is not None else None
        )
        query = """
            UPDATE task_history SET
                status = $2::text,
                agent_id = COALESCE($3, agent_id),
                result = COALESCE($4::jsonb, result),
                error_message = $5,
                started_at = CASE
                    WHEN $2::text = 'processing' THEN CURRENT_TIMESTAMP
                    ELSE started_at
                END,
                completed_at = CASE
                    WHEN $2::text IN ('completed', 'failed') THEN CURRENT_TIMESTAMP
                    ELSE completed_at
                END
            WHERE task_id = $1
            RETURNING *
        """
        return await db.fetchrow(
            query, task_id, status, agent_id, res_json, error_message
        )

    @staticmethod
    async def get_recent(limit: int = 50) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch(
            """
            SELECT * FROM task_history
            ORDER BY queued_at DESC
            LIMIT $1
            """,
            limit,
        )

    @staticmethod
    async def get_stats() -> Dict[str, Any]:
        db = get_db_manager()
        if not db:
            return {
                "total": 0,
                "completed": 0,
                "failed": 0,
                "queued": 0,
                "processing": 0,
                "avg_duration": 0.0,
                "today_completed": 0,
            }
        row = await db.fetchrow(
            """
            SELECT
                COUNT(*)::bigint AS total,
                COUNT(*) FILTER (WHERE status = 'completed')::bigint AS completed,
                COUNT(*) FILTER (WHERE status = 'failed')::bigint AS failed,
                COUNT(*) FILTER (WHERE status = 'queued')::bigint AS queued,
                COUNT(*) FILTER (WHERE status = 'processing')::bigint AS processing,
                AVG(
                    EXTRACT(EPOCH FROM (completed_at - started_at))
                ) FILTER (
                    WHERE status = 'completed'
                      AND started_at IS NOT NULL
                      AND completed_at IS NOT NULL
                ) AS avg_duration,
                COUNT(*) FILTER (
                    WHERE status = 'completed'
                      AND completed_at >= (NOW() - INTERVAL '24 hours')
                )::bigint AS today_completed
            FROM task_history
            """
        )
        if not row:
            return {
                "total": 0,
                "completed": 0,
                "failed": 0,
                "queued": 0,
                "processing": 0,
                "avg_duration": 0.0,
                "today_completed": 0,
            }
        avg = row["avg_duration"]
        return {
            "total": int(row["total"] or 0),
            "completed": int(row["completed"] or 0),
            "failed": int(row["failed"] or 0),
            "queued": int(row["queued"] or 0),
            "processing": int(row["processing"] or 0),
            "avg_duration": float(avg) if avg is not None else 0.0,
            "today_completed": int(row["today_completed"] or 0),
        }
