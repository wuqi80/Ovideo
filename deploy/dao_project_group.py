# -*- coding: utf-8 -*-
"""
Project Group DAO
==================
project_groups 表 CRUD。

详见 docs/superpowers/plans/2026-05-26-feature-rollout/04-admin-users-project-groups.md
"""
from __future__ import annotations

import logging
import uuid
from typing import Any, Dict, List, Optional

from db_manager import get_db_manager

logger = logging.getLogger(__name__)


class ProjectGroupDAO:

    @staticmethod
    async def create(
        user_id: str,
        group_name: str,
        *,
        description: str = '',
        color: Optional[str] = None,
        sort_order: int = 0,
        team_id: Optional[str] = None,
        group_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        db = get_db_manager()
        gid = group_id or f"grp_{uuid.uuid4().hex[:14]}"
        row = await db.fetchrow(
            """
            INSERT INTO project_groups (
                group_id, user_id, team_id, group_name, description, color, sort_order
            ) VALUES ($1,$2,$3,$4,$5,$6,$7)
            RETURNING *
            """,
            gid, user_id, team_id, group_name, description, color, sort_order,
        )
        return dict(row) if row else None

    @staticmethod
    async def get(group_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        row = await db.fetchrow("SELECT * FROM project_groups WHERE group_id = $1", group_id)
        return dict(row) if row else None

    @staticmethod
    async def list_for_user(user_id: str) -> List[Dict[str, Any]]:
        db = get_db_manager()
        rows = await db.fetch(
            """
            SELECT pg.*,
                   (SELECT COUNT(*) FROM projects p WHERE p.group_id = pg.group_id) AS project_count
            FROM project_groups pg
            WHERE pg.user_id = $1
            ORDER BY pg.sort_order, pg.group_name
            """,
            user_id,
        )
        return [dict(r) for r in rows]

    @staticmethod
    async def list_all() -> List[Dict[str, Any]]:
        """管理员视图：所有分组"""
        db = get_db_manager()
        rows = await db.fetch(
            """
            SELECT pg.*, u.username AS owner_name,
                   (SELECT COUNT(*) FROM projects p WHERE p.group_id = pg.group_id) AS project_count
            FROM project_groups pg
            LEFT JOIN users u ON u.user_id = pg.user_id
            ORDER BY pg.created_at DESC
            """,
        )
        return [dict(r) for r in rows]

    @staticmethod
    async def update(group_id: str, fields: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not fields:
            return await ProjectGroupDAO.get(group_id)
        allowed = {'group_name', 'description', 'color', 'sort_order', 'team_id'}
        sets, params = [], []
        idx = 1
        for k, v in fields.items():
            if k not in allowed:
                continue
            sets.append(f"{k} = ${idx}")
            params.append(v)
            idx += 1
        if not sets:
            return await ProjectGroupDAO.get(group_id)
        params.append(group_id)
        db = get_db_manager()
        row = await db.fetchrow(
            f"UPDATE project_groups SET {', '.join(sets)} WHERE group_id = ${idx} RETURNING *",
            *params,
        )
        return dict(row) if row else None

    @staticmethod
    async def delete(group_id: str) -> None:
        db = get_db_manager()
        await db.execute("DELETE FROM project_groups WHERE group_id = $1", group_id)

    @staticmethod
    async def move_project(project_id: str, group_id: Optional[str]) -> None:
        """把 project 挪到指定分组；group_id=None 表示移出分组。"""
        db = get_db_manager()
        await db.execute(
            "UPDATE projects SET group_id = $2 WHERE project_id = $1",
            project_id, group_id,
        )
