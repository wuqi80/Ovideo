# -*- coding: utf-8 -*-
"""Entity File DAO — 按业务实体查询/管理 files 表"""
import json
import uuid
from typing import Any, Dict, List, Optional
from db_manager import get_db_manager


class EntityFileDAO:
    @staticmethod
    async def get_entity_files(
        entity_type: str,
        entity_id: str,
        file_role: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> Dict[str, Any]:
        db = get_db_manager()
        if not db:
            return {"items": [], "total": 0}

        conditions = [
            "entity_type = $1",
            "entity_id = $2",
            "is_deleted = FALSE",
        ]
        params: list = [entity_type, entity_id]
        idx = 3

        if file_role:
            conditions.append(f"file_role = ${idx}")
            params.append(file_role)
            idx += 1

        where = " AND ".join(conditions)

        count_q = f"SELECT COUNT(*) FROM files WHERE {where}"
        total = await db.fetchval(count_q, *params)

        params.extend([limit, offset])
        data_q = f"""
            SELECT * FROM files WHERE {where}
            ORDER BY created_at DESC
            LIMIT ${idx} OFFSET ${idx + 1}
        """
        rows = await db.fetch(data_q, *params)
        return {"items": [dict(r) for r in rows], "total": total or 0}

    @staticmethod
    async def link_file(
        file_id: str,
        entity_type: str,
        entity_id: str,
        file_role: str,
        is_selected: bool = False,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        row = await db.fetchrow(
            """UPDATE files
               SET entity_type = $2, entity_id = $3,
                   file_role = $4, is_selected = $5
               WHERE file_id = $1 AND is_deleted = FALSE
               RETURNING *""",
            file_id, entity_type, entity_id, file_role, is_selected,
        )
        return dict(row) if row else None

    @staticmethod
    async def select_file(
        file_id: str,
        entity_type: str,
        entity_id: str,
        file_role: str,
    ) -> Optional[Dict[str, Any]]:
        """在事务内完成 select：先取消同组选中，再选中目标。"""
        db = get_db_manager()
        if not db:
            return None

        async with db.pool.acquire() as conn:
            async with conn.transaction():
                target = await conn.fetchrow(
                    """SELECT * FROM files
                       WHERE file_id = $1
                         AND entity_type = $2
                         AND entity_id = $3
                         AND file_role = $4
                         AND is_deleted = FALSE
                       FOR UPDATE""",
                    file_id, entity_type, entity_id, file_role,
                )
                if not target:
                    return None

                await conn.execute(
                    """UPDATE files SET is_selected = FALSE
                       WHERE entity_type = $1 AND entity_id = $2
                         AND file_role = $3 AND is_deleted = FALSE""",
                    entity_type, entity_id, file_role,
                )
                row = await conn.fetchrow(
                    """UPDATE files SET is_selected = TRUE
                       WHERE file_id = $1 RETURNING *""",
                    file_id,
                )
                return dict(row) if row else None

    @staticmethod
    async def soft_delete(file_id: str) -> bool:
        db = get_db_manager()
        if not db:
            return False
        row = await db.fetchrow(
            """UPDATE files
               SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP
               WHERE file_id = $1 AND is_deleted = FALSE
               RETURNING file_id""",
            file_id,
        )
        return row is not None

    @staticmethod
    async def hard_delete(file_id: str) -> Optional[Dict[str, Any]]:
        """硬删除：删除磁盘文件 + 数据库记录。返回被删文件信息或 None。"""
        import os
        db = get_db_manager()
        if not db:
            return None
        row = await db.fetchrow(
            "SELECT file_id, file_path, file_size_bytes FROM files WHERE file_id = $1",
            file_id,
        )
        if not row:
            return None

        file_path = row["file_path"]
        freed_bytes = row["file_size_bytes"] or 0

        if file_path:
            try:
                if os.path.exists(file_path):
                    os.remove(file_path)
            except OSError as e:
                import logging
                logging.getLogger(__name__).warning(f"磁盘文件删除失败 {file_path}: {e}")

        await db.execute("DELETE FROM files WHERE file_id = $1", file_id)
        return {"file_id": file_id, "freed_bytes": freed_bytes}

    @staticmethod
    async def hard_delete_batch(file_ids: list) -> Dict[str, Any]:
        """批量硬删除多个文件。返回 {deleted: int, freed_bytes: int, errors: [...]}。"""
        import os
        import logging
        logger = logging.getLogger(__name__)
        db = get_db_manager()
        if not db:
            return {"deleted": 0, "freed_bytes": 0, "errors": ["DB 不可用"]}

        rows = await db.fetch(
            "SELECT file_id, file_path, file_size_bytes FROM files WHERE file_id = ANY($1)",
            file_ids,
        )

        deleted = 0
        freed_bytes = 0
        errors = []

        for row in rows:
            fid = row["file_id"]
            fpath = row["file_path"]
            if fpath:
                try:
                    if os.path.exists(fpath):
                        os.remove(fpath)
                except OSError as e:
                    logger.warning(f"磁盘文件删除失败 {fpath}: {e}")
                    errors.append(f"{fid}: {e}")

            await db.execute("DELETE FROM files WHERE file_id = $1", fid)
            deleted += 1
            freed_bytes += row["file_size_bytes"] or 0

        return {"deleted": deleted, "freed_bytes": freed_bytes, "errors": errors}

    @staticmethod
    async def soft_delete_entity_files(
        entity_type: str, entity_id: str
    ) -> int:
        db = get_db_manager()
        if not db:
            return 0
        result = await db.execute(
            """UPDATE files
               SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP
               WHERE entity_type = $1 AND entity_id = $2
                 AND is_deleted = FALSE""",
            entity_type, entity_id,
        )
        return int(result.split()[-1]) if result else 0

    @staticmethod
    async def get_selected_file(
        entity_type: str, entity_id: str, file_role: str
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        row = await db.fetchrow(
            """SELECT * FROM files
               WHERE entity_type = $1 AND entity_id = $2
                 AND file_role = $3 AND is_selected = TRUE
                 AND is_deleted = FALSE""",
            entity_type, entity_id, file_role,
        )
        return dict(row) if row else None

    @staticmethod
    async def copy_file(
        source_file_id: str,
        target_entity_type: str,
        target_entity_id: str,
        file_role: str,
    ) -> Optional[Dict[str, Any]]:
        """复制一条 files 记录到新的实体（复用同一物理文件）"""
        db = get_db_manager()
        if not db:
            return None
        source = await db.fetchrow(
            "SELECT * FROM files WHERE file_id = $1 AND is_deleted = FALSE",
            source_file_id,
        )
        if not source:
            return None
        import uuid
        new_id = f"file_{uuid.uuid4().hex[:12]}"
        row = await db.fetchrow(
            """INSERT INTO files
               (file_id, user_id, file_type, file_name, file_path, file_url,
                file_size_bytes, mime_type, entity_type, entity_id, file_role,
                episode_id, source, is_selected, metadata)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,FALSE,$14)
               RETURNING *""",
            new_id,
            source["user_id"],
            source["file_type"],
            source["file_name"],
            source["file_path"],
            source["file_url"],
            source["file_size_bytes"],
            source["mime_type"],
            target_entity_type,
            target_entity_id,
            file_role,
            source.get("episode_id"),
            source.get("source", "copy"),
            source.get("metadata"),
        )
        return dict(row) if row else None

    @staticmethod
    async def get_files_for_entities(
        entity_type: str,
        entity_ids: list,
        file_role: str = None,
    ) -> dict:
        """批量获取多个实体的文件，返回 {entity_id: [file_record, ...]}"""
        if not entity_ids:
            return {}
        db = get_db_manager()
        if not db:
            return {}

        conditions = [
            "entity_type = $1",
            "entity_id = ANY($2)",
            "is_deleted = FALSE",
        ]
        params: list = [entity_type, entity_ids]
        if file_role:
            conditions.append(f"file_role = ${len(params) + 1}")
            params.append(file_role)

        rows = await db.fetch(
            f"SELECT * FROM files WHERE {' AND '.join(conditions)} ORDER BY created_at",
            *params,
        )
        result: dict = {}
        for row in rows:
            eid = row["entity_id"]
            if eid not in result:
                result[eid] = []
            result[eid].append(dict(row))
        return result
