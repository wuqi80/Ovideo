"""Read-only database probes used by the runtime health endpoint."""
from __future__ import annotations

from typing import Any


class RuntimeHealthDAO:
    @staticmethod
    async def get_database_snapshot(db_manager: Any) -> dict[str, Any]:
        ping = await db_manager.fetchval("SELECT 1")
        ledger_exists = await db_manager.fetchval(
            "SELECT to_regclass('public.schema_migrations') IS NOT NULL"
        )
        latest = None
        if ledger_exists:
            latest = await db_manager.fetchrow(
                """
                SELECT
                    migration_id,
                    checksum_sha256,
                    applied_at,
                    execution_ms,
                    git_sha,
                    (SELECT COUNT(*)::INTEGER FROM schema_migrations) AS applied_count
                FROM schema_migrations
                ORDER BY applied_at DESC, migration_id DESC
                LIMIT 1
                """
            )
        task_queue = await db_manager.fetchrow(
            """
            SELECT
                COUNT(*) FILTER (WHERE status IN ('pending', 'queued'))::INTEGER AS pending_count,
                COUNT(*) FILTER (WHERE status = 'processing')::INTEGER AS processing_count,
                MIN(created_at) FILTER (WHERE status IN ('pending', 'queued')) AS oldest_pending_at,
                MIN(started_at) FILTER (WHERE status = 'processing') AS oldest_processing_at
            FROM tasks
            WHERE status IN ('pending', 'queued', 'processing')
            """
        )
        return {
            "ping": ping,
            "ledger_exists": bool(ledger_exists),
            "latest": latest,
            "task_queue": task_queue or {},
        }
