"""DAO helpers for legacy admin statistics/reporting endpoints."""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List

from db_manager import get_db_manager


logger = logging.getLogger(__name__)

VIDEO_TASK_TYPES = (
    "i2v",
    "morph",
    "upscale",
    "minimax_i2v",
    "minimax_morph",
    "sora2_i2v",
    "sora2_morph",
    "veo_i2v",
    "veo_morph",
    "wan2_i2v",
    "wan2_morph",
    "wan26_i2v",
    "kling_t2v",
    "kling_i2v",
    "kling_morph",
    "kling_refer",
    "vidu_r2v",
    "vidu_morph",
    "happyhorse_r2v",
    "seedance_t2v",
    "seedance_i2v",
    "seedance_morph",
    "seedance_multi",
    "seedance_draft",
)


class AdminStatsDAO:
    """Admin reporting queries used by the compatibility admin shell."""

    @staticmethod
    def _empty_summary(active_users_count: int) -> Dict[str, Any]:
        return {
            "totalProjects": 0,
            "totalStoryboards": 0,
            "totalImages": 0,
            "totalVideos": 0,
            "totalText": 0,
            "totalMaterials": 0,
            "storageUsedMB": 0,
            "activeUsers": active_users_count,
            "source": "memory",
        }

    @staticmethod
    def _decode_jsonish(value: Any) -> Any:
        if isinstance(value, str):
            try:
                return json.loads(value)
            except Exception:
                return None
        return value

    @staticmethod
    def _row_get(row: Any, key: str, default: Any = None) -> Any:
        if hasattr(row, "get"):
            return row.get(key, default)
        try:
            return row[key]
        except Exception:
            return default

    @classmethod
    def _count_legacy_project_generations(cls, projects: List[Any]) -> Dict[str, int]:
        totals = {
            "storyboards": 0,
            "images": 0,
            "text": 0,
        }
        for project in projects:
            storyboard = cls._decode_jsonish(cls._row_get(project, "storyboard"))
            if isinstance(storyboard, dict):
                items = storyboard.get("items")
                if isinstance(items, list):
                    totals["storyboards"] += len(items)
                    totals["text"] += len(items)
                    for item in items:
                        if not isinstance(item, dict):
                            continue
                        generated_images = item.get("generatedImages")
                        if isinstance(generated_images, list):
                            totals["images"] += len(generated_images)

            generated_images = cls._decode_jsonish(cls._row_get(project, "generated_images"))
            if isinstance(generated_images, dict):
                for images in generated_images.values():
                    if isinstance(images, list):
                        totals["images"] += len(images)
        return totals

    @staticmethod
    async def _has_legacy_project_generation_columns(db: Any) -> bool:
        try:
            await db.fetch(
                "SELECT storyboard, generated_images FROM projects "
                "WHERE storyboard IS NOT NULL OR generated_images IS NOT NULL LIMIT 1"
            )
            return True
        except Exception as exc:
            logger.warning("projects legacy generation columns unavailable: %s", exc)
            return False

    @staticmethod
    async def _fetch_legacy_project_generations(
        db: Any,
        *,
        requesting_username: str,
        super_admin_username: str,
    ) -> List[Any]:
        if requesting_username == "admin":
            super_admin_user = await db.fetchrow(
                "SELECT user_id FROM users WHERE username = $1",
                super_admin_username,
            )
            super_admin_id = super_admin_user["user_id"] if super_admin_user else None
            if super_admin_id:
                return await db.fetch(
                    "SELECT storyboard, generated_images FROM projects "
                    "WHERE (storyboard IS NOT NULL OR generated_images IS NOT NULL) "
                    "AND user_id != $1",
                    super_admin_id,
                )

        return await db.fetch(
            "SELECT storyboard, generated_images FROM projects "
            "WHERE storyboard IS NOT NULL OR generated_images IS NOT NULL"
        )

    @staticmethod
    async def _get_modern_generation_counts(db: Any) -> Dict[str, int]:
        total_text = await db.fetchval(
            """
            SELECT COUNT(*) FROM tasks
            WHERE status = 'completed'
            """
        ) or 0
        if total_text == 0:
            total_text = await db.fetchval(
                "SELECT COUNT(*) FROM text_contents WHERE is_deleted = FALSE"
            ) or 0

        try:
            total_storyboards = await db.fetchval(
                "SELECT COUNT(*) FROM storyboard_items"
            ) or 0
        except Exception:
            total_storyboards = total_text

        total_images = await db.fetchval(
            """
            SELECT COUNT(*) FROM tasks
            WHERE status = 'completed'
            AND (task_type LIKE '%qwen%'
                 OR task_type LIKE '%kontext%'
                 OR task_type LIKE '%gemini_image%'
                 OR task_type LIKE '%doubao_image%'
                 OR task_type = 'three_view'
                 OR task_type = 'i2i_fj')
            """
        ) or 0

        return {
            "storyboards": total_storyboards,
            "images": total_images,
            "text": total_text,
        }

    @staticmethod
    async def _count_video_generations(db: Any) -> int:
        try:
            total_videos = await db.fetchval(
                """
                SELECT COUNT(*) FROM tasks
                WHERE status = 'completed'
                AND task_type = ANY($1::text[])
                """,
                list(VIDEO_TASK_TYPES),
            ) or 0
            if total_videos == 0:
                total_videos = await db.fetchval(
                    """
                    SELECT COUNT(*) FROM files
                    WHERE file_type = 'video'
                    AND is_deleted = FALSE
                    """
                ) or 0
            return total_videos
        except Exception as exc:
            logger.warning("failed to count video generations: %s", exc)
            return 0

    @classmethod
    async def get_summary_stats(
        cls,
        *,
        requesting_username: str,
        super_admin_username: str,
        active_users_count: int,
    ) -> Dict[str, Any]:
        stats = cls._empty_summary(active_users_count)
        db = get_db_manager()
        if not db:
            return stats

        try:
            stats["totalProjects"] = await db.fetchval(
                "SELECT COUNT(*) FROM projects"
            ) or 0

            if await cls._has_legacy_project_generation_columns(db):
                projects = await cls._fetch_legacy_project_generations(
                    db,
                    requesting_username=requesting_username,
                    super_admin_username=super_admin_username,
                )
                generation_totals = cls._count_legacy_project_generations(projects)
            else:
                try:
                    generation_totals = await cls._get_modern_generation_counts(db)
                except Exception as exc:
                    logger.warning("failed to count modern generation stats: %s", exc)
                    generation_totals = {"storyboards": 0, "images": 0, "text": 0}

            total_videos = await cls._count_video_generations(db)
            storage_used = (generation_totals["images"] * 0.5) + (total_videos * 10)

            stats.update(
                {
                    "totalStoryboards": generation_totals["storyboards"],
                    "totalImages": generation_totals["images"],
                    "totalVideos": total_videos,
                    "totalText": generation_totals["text"],
                    "storageUsedMB": round(storage_used, 2),
                    "source": "backend",
                }
            )
            logger.info(
                "loaded admin summary stats: Text=%s, Images=%s, Videos=%s, Projects=%s",
                stats["totalText"],
                stats["totalImages"],
                stats["totalVideos"],
                stats["totalProjects"],
            )
        except Exception as exc:
            logger.warning("failed to load admin summary stats: %s", exc)
        return stats

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
