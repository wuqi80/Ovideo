# -*- coding: utf-8 -*-
"""
资产 DAO -- assets 表的增删改查
"""
import uuid
import json
from typing import List, Dict, Any, Optional

from db_manager import get_db_manager


class AssetDAO:

    @staticmethod
    async def create(
        project_id: str,
        asset_type: str,
        name: str,
        created_by: str,
        episode_id: Optional[str] = None,
        description: str = '',
        thumbnail_url: Optional[str] = None,
        reference_images: Optional[list] = None,
        style_params: Optional[dict] = None,
        tags: Optional[list] = None,
        script_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        aid = f"asset_{uuid.uuid4().hex[:12]}"
        query = """
            INSERT INTO assets
                (asset_id, project_id, episode_id, script_id, asset_type, name, description,
                 thumbnail_url, reference_images, style_params, tags, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12)
            RETURNING *
        """
        return await db.fetchrow(
            query, aid, project_id, episode_id, script_id, asset_type, name, description,
            thumbnail_url,
            json.dumps(reference_images or [], ensure_ascii=False),
            json.dumps(style_params or {}, ensure_ascii=False),
            json.dumps(tags or [], ensure_ascii=False),
            created_by
        )

    @staticmethod
    async def get_by_id(asset_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            "SELECT * FROM assets WHERE asset_id = $1", asset_id
        )

    @staticmethod
    async def get_by_project(
        project_id: str,
        episode_id: Optional[str] = None,
        asset_type: Optional[str] = None,
        script_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        conditions = [
            "a.project_id = $1",
            "(a.episode_id IS NULL OR EXISTS (SELECT 1 FROM episodes e WHERE e.episode_id = a.episode_id))",
        ]
        args: list = [project_id]
        idx = 2

        if episode_id:
            conditions.append(f"(a.episode_id IS NULL OR a.episode_id = ${idx})")
            args.append(episode_id)
            idx += 1

        if script_id:
            conditions.append(f"a.script_id = ${idx}")
            args.append(script_id)
            idx += 1

        if asset_type:
            conditions.append(f"a.asset_type = ${idx}")
            args.append(asset_type)
            idx += 1

        where = " AND ".join(conditions)
        query = f"SELECT a.* FROM assets a WHERE {where} ORDER BY a.created_at DESC"
        return await db.fetch(query, *args)

    @staticmethod
    async def update(asset_id: str, **kwargs) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        allowed = {'name', 'description', 'thumbnail_url', 'reference_images',
                    'style_params', 'tags', 'episode_id', 'script_id'}
        sets, vals, idx = [], [], 1
        for key, val in kwargs.items():
            if key in allowed and val is not None:
                if key in ('reference_images', 'style_params', 'tags'):
                    sets.append(f"{key} = ${idx}::jsonb")
                    vals.append(json.dumps(val, ensure_ascii=False))
                else:
                    sets.append(f"{key} = ${idx}")
                    vals.append(val)
                idx += 1
        if not sets:
            return await AssetDAO.get_by_id(asset_id)
        vals.append(asset_id)
        query = f"UPDATE assets SET {', '.join(sets)} WHERE asset_id = ${idx} RETURNING *"
        return await db.fetchrow(query, *vals)

    @staticmethod
    async def copy_to(
        asset_id: str,
        target_episode_id: str,
        target_script_id: str,
        created_by: str,
    ) -> Optional[Dict[str, Any]]:
        source = await AssetDAO.get_by_id(asset_id)
        if not source:
            return None
        return await AssetDAO.create(
            project_id=source['project_id'],
            asset_type=source['asset_type'],
            name=source['name'],
            created_by=created_by,
            episode_id=target_episode_id,
            description=source.get('description', ''),
            thumbnail_url=source.get('thumbnail_url'),
            reference_images=source.get('reference_images'),
            style_params=source.get('style_params'),
            tags=source.get('tags'),
            script_id=target_script_id,
        )

    @staticmethod
    async def create_missing_episode_assets_transactional(
        conn,
        *,
        project_id: str,
        episode_id: str,
        script_id: Optional[str],
        asset_type: str,
        items: List[Dict[str, Any]],
        created_by: str,
    ) -> int:
        if script_id:
            existing_assets = await conn.fetch(
                """
                SELECT asset_id, name, description FROM assets
                WHERE project_id = $1 AND episode_id = $2 AND script_id = $3 AND asset_type = $4
                """,
                project_id,
                episode_id,
                script_id,
                asset_type,
            )
        else:
            existing_assets = await conn.fetch(
                """
                SELECT asset_id, name, description FROM assets
                WHERE project_id = $1 AND episode_id = $2 AND asset_type = $3
                """,
                project_id,
                episode_id,
                asset_type,
            )
        existing_by_name = {str(row["name"]): row for row in existing_assets}
        created = 0
        for item in items:
            name = str(item.get("name", "")).strip()
            if not name:
                continue
            description = str(item.get("description", "") or "").strip()
            existing = existing_by_name.get(name)
            if existing:
                existing_description = str(existing.get("description", "") or "").strip()
                if description and not existing_description:
                    await conn.execute(
                        """
                        UPDATE assets SET description = $1
                        WHERE asset_id = $2 AND (description IS NULL OR BTRIM(description) = '')
                        """,
                        description,
                        str(existing["asset_id"]),
                    )
                continue
            await conn.execute(
                """
                INSERT INTO assets (asset_id, project_id, episode_id, script_id, asset_type, name, description, created_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """,
                f"asset_{uuid.uuid4().hex[:12]}",
                project_id,
                episode_id,
                script_id,
                asset_type,
                name,
                description,
                created_by,
            )
            existing_by_name[name] = {
                "asset_id": "",
                "name": name,
                "description": description,
            }
            created += 1
        return created

    @staticmethod
    async def delete(asset_id: str) -> bool:
        db = get_db_manager()
        if not db:
            return False
        result = await db.execute(
            "DELETE FROM assets WHERE asset_id = $1", asset_id
        )
        return result == "DELETE 1"
