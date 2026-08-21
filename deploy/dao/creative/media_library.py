# -*- coding: utf-8 -*-
"""
Media Library DAO
===================
通用素材库索引表（media_library_items）和引用表（media_library_usages）的 CRUD。

设计原则：
- 真实文件继续保存在 files 表；本表只是索引 + 权限 + 引用统计。
- 列表查询统一 JOIN files 表，前端拿到 file_url / thumbnail_url / size 等真实文件元数据。
- permission_scope='private' 仅 owner 可见；'project' 项目所有成员可见。

"""
from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Dict, List, Optional

from db_manager import get_db_manager

logger = logging.getLogger(__name__)


def _coerce_jsonb(value: Any) -> Any:
    """asyncpg 在没有显式注册 JSONB 解码器时会返回 str；这里兼容两种格式。"""
    if value is None:
        return None
    if isinstance(value, (list, dict)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return value
    return value


def _normalize_row(row: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if row is None:
        return None
    out = dict(row)
    for k in ('tags', 'metadata'):
        if k in out:
            out[k] = _coerce_jsonb(out[k])
    return out


class MediaLibraryDAO:
    """media_library_items 表 CRUD"""

    @staticmethod
    async def create(
        file_id: str,
        user_id: str,
        item_type: str,
        source: str,
        project_id: Optional[str] = None,
        episode_id: Optional[str] = None,
        team_id: Optional[str] = None,
        title: Optional[str] = None,
        description: str = "",
        tags: Optional[List[str]] = None,
        permission_scope: str = "private",
        source_task_id: Optional[str] = None,
        source_entity_type: Optional[str] = None,
        source_entity_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        library_item_id: Optional[str] = None,
        visibility: str = "private",
        folder_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """插入一条素材库索引记录

        2026-05-26 组织管理 MVP — Slice 5: 新增 visibility 列
        ('private' | 'org-default'). 仅做 UI badge 显示，
        真实可见性走 resource_shares。
        """
        db = get_db_manager()
        lid = library_item_id or f"mli_{uuid.uuid4().hex[:16]}"
        if visibility not in ('private', 'org-default'):
            visibility = 'private'
        row = await db.fetchrow(
            """
            INSERT INTO media_library_items (
                library_item_id, file_id, user_id, project_id, episode_id, team_id,
                item_type, source, title, description, tags, permission_scope,
                source_task_id, source_entity_type, source_entity_id, metadata, visibility,
                folder_id
            ) VALUES (
                $1,$2,$3,$4,$5,$6,
                $7,$8,$9,$10,$11::jsonb,$12,
                $13,$14,$15,$16::jsonb,$17,
                $18
            )
            RETURNING *
            """,
            lid, file_id, user_id, project_id, episode_id, team_id,
            item_type, source, title, description, json.dumps(tags or []), permission_scope,
            source_task_id, source_entity_type, source_entity_id, json.dumps(metadata or {}),
            visibility, folder_id,
        )
        return _normalize_row(row)

    @staticmethod
    async def get(library_item_id: str) -> Optional[Dict[str, Any]]:
        """获取单条素材（含 file 信息）"""
        db = get_db_manager()
        row = await db.fetchrow(
            """
            SELECT ml.*,
                   f.file_name, f.file_url, f.file_type, f.mime_type,
                   f.file_size_bytes, f.width, f.height, f.duration_seconds,
                   f.thumbnail_url, f.metadata AS file_metadata, f.is_deleted AS file_is_deleted
            FROM media_library_items ml
            JOIN files f ON f.file_id = ml.file_id
            WHERE ml.library_item_id = $1 AND ml.is_deleted = FALSE
            """,
            library_item_id,
        )
        return _normalize_row(row)

    @staticmethod
    async def get_by_file_id(file_id: str) -> Optional[Dict[str, Any]]:
        """按 file_id 查（用于幂等检查/历史迁移）"""
        db = get_db_manager()
        row = await db.fetchrow(
            "SELECT * FROM media_library_items WHERE file_id = $1 AND is_deleted = FALSE",
            file_id,
        )
        return _normalize_row(row)

    @staticmethod
    async def list_for_user(
        user_id: str,
        *,
        project_id: Optional[str] = None,
        item_type: Optional[str] = None,
        source: Optional[str] = None,
        permission_scope: Optional[str] = None,
        is_favorite: Optional[bool] = None,
        keyword: Optional[str] = None,
        tag: Optional[str] = None,
        episode_id: Optional[str] = None,
        include_shared: bool = False,
        folder_id: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
        org_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        列出用户可见的素材：
        - org_id=None：自己 + project_members 项目里 scope='project' 的（旧行为）
        - org_id=X：自己 + 被 share 给 org X 的（组织 workspace 视图）
          权限前提（user ∈ org X members）由调用方校验。

        2026-05-26 组织管理 MVP — Slice 3
        """
        db = get_db_manager()

        if org_id is None:
            visibility_clause = """(
                ml.user_id = $1
                OR (
                    ml.permission_scope = 'project'
                    AND ml.project_id IN (
                        SELECT project_id FROM project_members WHERE user_id = $1
                    )
                )
            )"""
            params: List[Any] = [user_id]
            idx = 2
        else:
            visibility_clause = """(
                ml.user_id = $1
                OR ml.library_item_id IN (
                    SELECT resource_id FROM resource_shares
                    WHERE resource_type='media'
                      AND share_target_type='org' AND share_target_id=$2
                )
                OR ml.project_id IN (
                    SELECT resource_id FROM resource_shares
                    WHERE resource_type='project'
                      AND share_target_type='org' AND share_target_id=$2
                )
            )"""
            params = [user_id, org_id]
            idx = 3

        where = [
            "ml.is_deleted = FALSE",
            "f.is_deleted = FALSE",
            visibility_clause,
        ]

        if project_id:
            where.append(f"ml.project_id = ${idx}")
            params.append(project_id)
            idx += 1
        if episode_id:
            if include_shared:
                where.append(f"(ml.episode_id = ${idx} OR ml.episode_id IS NULL)")
            else:
                where.append(f"ml.episode_id = ${idx}")
            params.append(episode_id)
            idx += 1
        if folder_id is not None:
            if folder_id == "__unfiled__":
                where.append("ml.folder_id IS NULL")
            else:
                where.append(f"ml.folder_id = ${idx}")
                params.append(folder_id)
                idx += 1
        if item_type:
            where.append(f"ml.item_type = ${idx}")
            params.append(item_type)
            idx += 1
        if source:
            where.append(f"ml.source = ${idx}")
            params.append(source)
            idx += 1
        if permission_scope:
            where.append(f"ml.permission_scope = ${idx}")
            params.append(permission_scope)
            idx += 1
        if is_favorite is not None:
            where.append(f"ml.is_favorite = ${idx}")
            params.append(is_favorite)
            idx += 1
        if keyword:
            where.append(f"(ml.title ILIKE ${idx} OR ml.description ILIKE ${idx})")
            params.append(f"%{keyword}%")
            idx += 1
        if tag:
            where.append(f"ml.tags @> ${idx}::jsonb")
            params.append(json.dumps([tag]))
            idx += 1

        params.extend([limit, offset])
        query = f"""
            SELECT ml.*,
                   f.file_name, f.file_url, f.file_type, f.mime_type,
                   f.file_size_bytes, f.width, f.height, f.duration_seconds,
                   f.thumbnail_url
            FROM media_library_items ml
            JOIN files f ON f.file_id = ml.file_id
            WHERE {' AND '.join(where)}
            ORDER BY ml.created_at DESC
            LIMIT ${idx} OFFSET ${idx + 1}
        """
        rows = await db.fetch(query, *params)
        return [_normalize_row(r) for r in rows]

    @staticmethod
    async def list_admin(
        *,
        user_id: Optional[str] = None,
        project_id: Optional[str] = None,
        item_type: Optional[str] = None,
        source: Optional[str] = None,
        is_deleted: Optional[bool] = False,
        keyword: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """
        2026-05-26 Slice 5: 管理员视角列出所有素材（不受权限 scope 限制）。
        """
        db = get_db_manager()
        where: List[str] = ["TRUE"]
        params: List[Any] = []
        idx = 1
        if is_deleted is False:
            where.append("ml.is_deleted = FALSE")
        elif is_deleted is True:
            where.append("ml.is_deleted = TRUE")
        if user_id:
            where.append(f"ml.user_id = ${idx}"); params.append(user_id); idx += 1
        if project_id:
            where.append(f"ml.project_id = ${idx}"); params.append(project_id); idx += 1
        if item_type:
            where.append(f"ml.item_type = ${idx}"); params.append(item_type); idx += 1
        if source:
            where.append(f"ml.source = ${idx}"); params.append(source); idx += 1
        if keyword:
            where.append(f"(ml.title ILIKE ${idx} OR ml.description ILIKE ${idx})")
            params.append(f"%{keyword}%"); idx += 1
        params.extend([limit, offset])
        query = f"""
            SELECT ml.*,
                   f.file_name, f.file_url, f.file_type, f.mime_type,
                   f.file_size_bytes, f.width, f.height, f.duration_seconds,
                   f.thumbnail_url
            FROM media_library_items ml
            LEFT JOIN files f ON f.file_id = ml.file_id
            WHERE {' AND '.join(where)}
            ORDER BY ml.created_at DESC
            LIMIT ${idx} OFFSET ${idx + 1}
        """
        rows = await db.fetch(query, *params)
        return [_normalize_row(r) for r in rows]

    @staticmethod
    async def count_for_user(
        user_id: str,
        *,
        project_id: Optional[str] = None,
        item_type: Optional[str] = None,
        source: Optional[str] = None,
        permission_scope: Optional[str] = None,
        is_favorite: Optional[bool] = None,
        keyword: Optional[str] = None,
        tag: Optional[str] = None,
        episode_id: Optional[str] = None,
        include_shared: bool = False,
        folder_id: Optional[str] = None,
        org_id: Optional[str] = None,
    ) -> int:
        """count_for_user 与 list_for_user 同义；org_id 模式下也复用相同可见性子句。

        2026-05-26 组织管理 MVP — Slice 3 加 org_id 参数。
        """
        db = get_db_manager()

        if org_id is None:
            visibility = """(
                ml.user_id = $1
                OR (
                    ml.permission_scope = 'project'
                    AND ml.project_id IN (
                        SELECT project_id FROM project_members WHERE user_id = $1
                    )
                )
            )"""
            params: List[Any] = [user_id]
            idx = 2
        else:
            visibility = """(
                ml.user_id = $1
                OR ml.library_item_id IN (
                    SELECT resource_id FROM resource_shares
                    WHERE resource_type='media'
                      AND share_target_type='org' AND share_target_id=$2
                )
                OR ml.project_id IN (
                    SELECT resource_id FROM resource_shares
                    WHERE resource_type='project'
                      AND share_target_type='org' AND share_target_id=$2
                )
            )"""
            params = [user_id, org_id]
            idx = 3

        extra_where: List[str] = []
        if project_id:
            extra_where.append(f"ml.project_id = ${idx}")
            params.append(project_id)
            idx += 1
        if episode_id:
            if include_shared:
                extra_where.append(f"(ml.episode_id = ${idx} OR ml.episode_id IS NULL)")
            else:
                extra_where.append(f"ml.episode_id = ${idx}")
            params.append(episode_id)
            idx += 1
        if folder_id is not None:
            if folder_id == "__unfiled__":
                extra_where.append("ml.folder_id IS NULL")
            else:
                extra_where.append(f"ml.folder_id = ${idx}")
                params.append(folder_id)
                idx += 1
        if item_type:
            extra_where.append(f"ml.item_type = ${idx}")
            params.append(item_type)
            idx += 1
        if source:
            extra_where.append(f"ml.source = ${idx}")
            params.append(source)
            idx += 1
        if permission_scope:
            extra_where.append(f"ml.permission_scope = ${idx}")
            params.append(permission_scope)
            idx += 1
        if is_favorite is not None:
            extra_where.append(f"ml.is_favorite = ${idx}")
            params.append(is_favorite)
            idx += 1
        if keyword:
            extra_where.append(f"(ml.title ILIKE ${idx} OR ml.description ILIKE ${idx})")
            params.append(f"%{keyword}%")
            idx += 1
        if tag:
            extra_where.append(f"ml.tags @> ${idx}::jsonb")
            params.append(json.dumps([tag]))
            idx += 1

        extra = "".join(f" AND {clause}" for clause in extra_where)

        return await db.fetchval(
            f"""
            SELECT COUNT(*) FROM media_library_items ml
            JOIN files f ON f.file_id = ml.file_id
            WHERE ml.is_deleted = FALSE AND f.is_deleted = FALSE
              AND {visibility}{extra}
            """,
            *params,
        ) or 0

    @staticmethod
    async def update(
        library_item_id: str,
        fields: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        """更新素材元信息（title/description/tags/permission_scope/is_favorite/folder/...）"""
        if not fields:
            return await MediaLibraryDAO.get(library_item_id)

        allowed = {
            'title', 'description', 'permission_scope', 'is_favorite',
            'tags', 'metadata', 'source_entity_type', 'source_entity_id',
            'project_id', 'episode_id', 'team_id', 'folder_id',
        }
        sets = []
        params: List[Any] = []
        idx = 1
        for k, v in fields.items():
            if k not in allowed:
                continue
            if k in ('tags', 'metadata'):
                sets.append(f"{k} = ${idx}::jsonb")
                params.append(json.dumps(v if v is not None else ([] if k == 'tags' else {})))
            else:
                sets.append(f"{k} = ${idx}")
                params.append(v)
            idx += 1

        if not sets:
            return await MediaLibraryDAO.get(library_item_id)

        params.append(library_item_id)
        db = get_db_manager()
        await db.execute(
            f"UPDATE media_library_items SET {', '.join(sets)} WHERE library_item_id = ${idx}",
            *params,
        )
        return await MediaLibraryDAO.get(library_item_id)

    @staticmethod
    async def soft_delete(
        library_item_id: str,
        *,
        deleted_by: Optional[str] = None,
        deleted_reason: Optional[str] = None,
    ) -> None:
        """软删除：仅取消素材库索引，files 表本体保留。
        deleted_by/deleted_reason 字段在 Slice 5 才会 ALTER 出来，
        这里以 metadata 字段兜底，等 Slice 5 落表后改成原生列。
        """
        db = get_db_manager()
        # 优先尝试原生列（Slice 5 后存在）；不存在则降级写到 metadata
        try:
            await db.execute(
                """
                UPDATE media_library_items
                SET is_deleted = TRUE,
                    deleted_at = CURRENT_TIMESTAMP,
                    deleted_by = $2,
                    deleted_reason = $3
                WHERE library_item_id = $1
                """,
                library_item_id, deleted_by, deleted_reason or "",
            )
        except Exception:
            await db.execute(
                """
                UPDATE media_library_items
                SET is_deleted = TRUE,
                    deleted_at = CURRENT_TIMESTAMP,
                    metadata = COALESCE(metadata, '{}'::jsonb)
                              || jsonb_build_object(
                                  'deleted_by', $2::text,
                                  'deleted_reason', $3::text
                              )
                WHERE library_item_id = $1
                """,
                library_item_id, deleted_by, deleted_reason or "",
            )

    @staticmethod
    async def increment_use_count(library_item_id: str, delta: int = 1) -> None:
        db = get_db_manager()
        await db.execute(
            "UPDATE media_library_items SET use_count = use_count + $2 WHERE library_item_id = $1",
            library_item_id, delta,
        )


class MediaLibraryUsageDAO:
    """media_library_usages 表 CRUD"""

    @staticmethod
    async def record(
        library_item_id: str,
        file_id: str,
        user_id: str,
        usage_context: str,
        *,
        project_id: Optional[str] = None,
        task_id: Optional[str] = None,
        target_entity_type: Optional[str] = None,
        target_entity_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        db = get_db_manager()
        usage_id = f"mlu_{uuid.uuid4().hex[:16]}"
        row = await db.fetchrow(
            """
            INSERT INTO media_library_usages (
                usage_id, library_item_id, file_id, user_id, project_id,
                task_id, usage_context, target_entity_type, target_entity_id
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            RETURNING *
            """,
            usage_id, library_item_id, file_id, user_id, project_id,
            task_id, usage_context, target_entity_type, target_entity_id,
        )
        return dict(row) if row else None

    @staticmethod
    async def list_for_item(library_item_id: str, limit: int = 100) -> List[Dict[str, Any]]:
        db = get_db_manager()
        rows = await db.fetch(
            """
            SELECT * FROM media_library_usages
            WHERE library_item_id = $1
            ORDER BY created_at DESC
            LIMIT $2
            """,
            library_item_id, limit,
        )
        return [dict(r) for r in rows]
