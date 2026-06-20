"""DAO helpers for legacy admin statistics/reporting endpoints."""
from __future__ import annotations

from typing import Any, Dict, List

from db_manager import get_db_manager


class AdminStatsDAO:
    """Admin reporting queries used by the compatibility admin shell."""

    @staticmethod
    async def get_user_asset_breakdown(
        *,
        requesting_username: str,
        super_admin_username: str,
    ) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []

        per_user_sql = """
            WITH u_files AS (
                SELECT user_id,
                    SUM(CASE WHEN file_type='image' THEN 1 ELSE 0 END) AS img_cnt,
                    SUM(CASE WHEN file_type='video' THEN 1 ELSE 0 END) AS vid_cnt,
                    SUM(CASE WHEN file_type='audio' THEN 1 ELSE 0 END) AS aud_cnt
                FROM files WHERE is_deleted = FALSE
                GROUP BY user_id
            ),
            u_proj AS (
                SELECT user_id, COUNT(*) AS proj_cnt
                FROM projects
                GROUP BY user_id
            )
            SELECT u.user_id, u.username,
                COALESCE(p.proj_cnt, 0) AS projects,
                COALESCE(f.img_cnt, 0) AS images,
                COALESCE(f.vid_cnt, 0) AS videos,
                COALESCE(f.aud_cnt, 0) AS audios
            FROM users u
            LEFT JOIN u_files f ON f.user_id = u.user_id
            LEFT JOIN u_proj  p ON p.user_id = u.user_id
            WHERE u.is_deleted = FALSE
        """
        if requesting_username == "admin":
            per_user_sql += " AND u.username <> $1 "
            rows = await db.fetch(per_user_sql, super_admin_username)
        else:
            rows = await db.fetch(per_user_sql)
        return [dict(row) for row in rows]

    @staticmethod
    async def get_active_org_members() -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        rows = await db.fetch(
            """
            SELECT om.org_id, o.name, om.user_id
            FROM organization_members om
            JOIN organizations o ON o.org_id = om.org_id
            WHERE o.status = 'active'
            """
        )
        return [dict(row) for row in rows]

    @classmethod
    async def get_stats_breakdown(
        cls,
        *,
        group_by: str,
        requesting_username: str,
        super_admin_username: str,
    ) -> List[Dict[str, Any]]:
        user_rows = await cls.get_user_asset_breakdown(
            requesting_username=requesting_username,
            super_admin_username=super_admin_username,
        )

        if group_by == "user":
            return sorted(
                user_rows,
                key=lambda row: (row["projects"] + row["images"] + row["videos"]),
                reverse=True,
            )

        if group_by != "org":
            return []

        members = await cls.get_active_org_members()
        user_idx = {row["user_id"]: row for row in user_rows}
        agg: Dict[str, Dict[str, Any]] = {}
        for member in members:
            org_id = member["org_id"]
            if org_id not in agg:
                agg[org_id] = {
                    "org_id": org_id,
                    "name": member["name"],
                    "member_count": 0,
                    "projects": 0,
                    "images": 0,
                    "videos": 0,
                    "audios": 0,
                }
            agg[org_id]["member_count"] += 1
            user_row = user_idx.get(member["user_id"])
            if user_row:
                agg[org_id]["projects"] += user_row["projects"]
                agg[org_id]["images"] += user_row["images"]
                agg[org_id]["videos"] += user_row["videos"]
                agg[org_id]["audios"] += user_row["audios"]

        return sorted(
            agg.values(),
            key=lambda row: (row["projects"] + row["images"] + row["videos"]),
            reverse=True,
        )
