# -*- coding: utf-8 -*-
"""
分镜 DAO -- storyboard_items 表的增删改查
"""
import uuid
import json
from typing import List, Dict, Any, Optional

from db_manager import get_db_manager


class StoryboardDAO:
    FIELD_SETS = {
        "audio": (
            "item_id",
            "episode_id",
            "script_id",
            "sort_order",
            "dialogue",
            "dialogue_audio_url",
            "narration_audio_url",
            "sfx_audio_url",
            "mixed_audio_url",
            "audio_duration_ms",
            "planned_duration_ms",
            "status",
        ),
        "video": (
            "item_id",
            "episode_id",
            "script_id",
            "sort_order",
            "dialogue",
            "video_prompt",
            "generated_image_url",
            "audio_duration_ms",
            "planned_duration_ms",
            "status",
        ),
        "audio_stage": (
            "item_id",
            "episode_id",
            "script_id",
            "sort_order",
            "scene_heading",
            "action_text",
            "dialogue",
            "camera_movement",
            "image_prompt",
            "video_prompt",
            "bound_assets",
            "dialogue_audio_url",
            "narration_audio_url",
            "sfx_audio_url",
            "mixed_audio_url",
            "audio_duration_ms",
            "planned_duration_ms",
            "status",
        ),
        "materials": (
            "item_id",
            "episode_id",
            "script_id",
            "sort_order",
            "scene_heading",
            "action_text",
            "dialogue",
            "camera_movement",
            "image_prompt",
            "video_prompt",
            "generated_image_url",
            "bound_assets",
            "status",
        ),
    }

    @staticmethod
    def _select_columns(fields: Optional[str] = None) -> str:
        if not fields:
            return "*"
        columns = StoryboardDAO.FIELD_SETS.get(fields)
        if not columns:
            return "*"
        return ", ".join(columns)

    @staticmethod
    async def create(
        episode_id: str,
        sort_order: int,
        scene_heading: str = '',
        action_text: str = '',
        dialogue: str = '',
        camera_movement: str = '',
        image_prompt: str = '',
        video_prompt: str = '',
        bound_assets: list = None,
        script_id: Optional[str] = None,
        # 2026-05-29 三步生成新增字段
        script_segment_id: Optional[str] = None,
        source_video_shot_no: str = '',
        video_script_block: str = '',
        shot_size: str = '',
        camera_angle: str = '',
        # 2026-06-16：创建时也持久化已生成的画面/时长，否则"删旧建新"会丢图（#4/#5）。
        generated_image_url: str = '',
        planned_duration_ms: Optional[int] = None,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        item_id = f"sb_{uuid.uuid4().hex[:12]}"
        query = """
            INSERT INTO storyboard_items
                (item_id, episode_id, sort_order, scene_heading, action_text,
                 dialogue, camera_movement, image_prompt, video_prompt, bound_assets,
                 script_id, script_segment_id, source_video_shot_no,
                 video_script_block, shot_size, camera_angle,
                 generated_image_url, planned_duration_ms)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb,
                    $11, $12, $13, $14, $15, $16, $17, $18)
            RETURNING *
        """
        return await db.fetchrow(
            query, item_id, episode_id, sort_order,
            scene_heading, action_text, dialogue,
            camera_movement, image_prompt, video_prompt,
            json.dumps(bound_assets or [], ensure_ascii=False),
            script_id, script_segment_id, source_video_shot_no,
            video_script_block, shot_size, camera_angle,
            (generated_image_url or None), planned_duration_ms,
        )

    @staticmethod
    async def batch_create(episode_id: str, items: list, script_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """批量创建分镜。每个 item dict 至少需要 sort_order。"""
        db = get_db_manager()
        if not db:
            return []
        results = []
        for item in items:
            row = await StoryboardDAO.create(
                episode_id=episode_id,
                sort_order=item.get('sort_order', 0),
                scene_heading=item.get('scene_heading', ''),
                action_text=item.get('action_text', ''),
                dialogue=item.get('dialogue', ''),
                camera_movement=item.get('camera_movement', ''),
                image_prompt=item.get('image_prompt', ''),
                video_prompt=item.get('video_prompt', ''),
                bound_assets=item.get('bound_assets'),
                script_id=script_id or item.get('script_id'),
                script_segment_id=item.get('script_segment_id'),
                source_video_shot_no=item.get('source_video_shot_no', ''),
                video_script_block=item.get('video_script_block', ''),
                shot_size=item.get('shot_size', ''),
                camera_angle=item.get('camera_angle', ''),
                generated_image_url=item.get('generated_image_url', ''),
                planned_duration_ms=item.get('planned_duration_ms'),
            )
            if row:
                results.append(dict(row))
        return results

    @staticmethod
    async def batch_create_transactional(conn, episode_id: str, items: list, script_id: Optional[str] = None) -> int:
        """在已有事务连接上批量创建分镜，返回创建数量"""
        count = 0
        for item in items:
            item_id = f"sb_{uuid.uuid4().hex[:12]}"
            sid = script_id or item.get('script_id')
            await conn.execute("""
                INSERT INTO storyboard_items
                    (item_id, episode_id, sort_order, scene_heading, action_text,
                     dialogue, camera_movement, image_prompt, video_prompt,
                     bound_assets, planned_duration_ms, script_id,
                     script_segment_id, source_video_shot_no, video_script_block,
                     shot_size, camera_angle)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12,
                        $13, $14, $15, $16, $17)
            """,
                item_id, episode_id,
                item.get('sort_order', 0),
                item.get('scene_heading', ''),
                item.get('action_text', ''),
                item.get('dialogue', ''),
                item.get('camera_movement', ''),
                item.get('image_prompt', ''),
                item.get('video_prompt', ''),
                json.dumps(item.get('bound_assets', []), ensure_ascii=False),
                item.get('planned_duration_ms'),
                sid,
                item.get('script_segment_id'),
                item.get('source_video_shot_no', ''),
                item.get('video_script_block', ''),
                item.get('shot_size', ''),
                item.get('camera_angle', ''),
            )
            count += 1
        return count

    @staticmethod
    async def delete_by_episode_transactional(conn, episode_id: str, script_id: Optional[str] = None) -> int:
        if script_id:
            result = await conn.execute(
                "DELETE FROM storyboard_items WHERE episode_id = $1 AND script_id = $2",
                episode_id,
                script_id,
            )
        else:
            result = await conn.execute("DELETE FROM storyboard_items WHERE episode_id = $1", episode_id)
        try:
            return int(result.split()[-1])
        except Exception:
            return 0

    @staticmethod
    async def export_script_transaction(
        *,
        episode_script_dao: Any,
        asset_dao: Any,
        episode_id: str,
        project_id: str,
        original_content: str,
        script_content: str,
        storyboard_items: List[Dict[str, Any]],
        characters: List[Dict[str, Any]],
        scenes: List[Dict[str, Any]],
        props: Optional[List[Dict[str, Any]]] = None,
        script_id: Optional[str],
        created_by: str,
    ) -> int:
        db = get_db_manager()
        if not db:
            raise RuntimeError("database unavailable")

        async with db.acquire() as conn:
            async with conn.transaction():
                await episode_script_dao.upsert_transactional(
                    conn,
                    episode_id,
                    original_content=original_content,
                    adapted_script=script_content,
                    metadata={
                        "extracted_characters": [c.get("name", "") for c in characters],
                        "extracted_scenes": [s.get("name", "") for s in scenes],
                        "extracted_props": [p.get("name", "") for p in (props or [])],
                    },
                )
                await StoryboardDAO.delete_by_episode_transactional(conn, episode_id, script_id=script_id)
                created = await StoryboardDAO.batch_create_transactional(
                    conn,
                    episode_id,
                    storyboard_items,
                    script_id=script_id,
                )
                await asset_dao.create_missing_episode_assets_transactional(
                    conn,
                    project_id=project_id,
                    episode_id=episode_id,
                    script_id=script_id,
                    asset_type="character",
                    items=characters,
                    created_by=created_by,
                )
                await asset_dao.create_missing_episode_assets_transactional(
                    conn,
                    project_id=project_id,
                    episode_id=episode_id,
                    script_id=script_id,
                    asset_type="scene",
                    items=scenes,
                    created_by=created_by,
                )
                await asset_dao.create_missing_episode_assets_transactional(
                    conn,
                    project_id=project_id,
                    episode_id=episode_id,
                    script_id=script_id,
                    asset_type="prop",
                    items=props or [],
                    created_by=created_by,
                )
        return created

    @staticmethod
    async def get_by_id(item_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            "SELECT * FROM storyboard_items WHERE item_id = $1", item_id
        )

    @staticmethod
    async def get_by_episode(
        episode_id: str,
        script_id: Optional[str] = None,
        limit: Optional[int] = None,
        offset: int = 0,
        fields: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        limit = max(1, min(int(limit), 500)) if limit is not None else None
        offset = max(0, int(offset or 0))
        select_columns = StoryboardDAO._select_columns(fields)
        if script_id:
            if limit is not None:
                return await db.fetch(
                    f"""
                    SELECT {select_columns} FROM storyboard_items
                    WHERE episode_id = $1 AND script_id = $2
                    ORDER BY sort_order ASC
                    LIMIT $3 OFFSET $4
                    """,
                    episode_id, script_id, limit, offset
                )
            return await db.fetch(
                f"SELECT {select_columns} FROM storyboard_items WHERE episode_id = $1 AND script_id = $2 ORDER BY sort_order ASC",
                episode_id, script_id
            )
        if limit is not None:
            return await db.fetch(
                f"""
                SELECT {select_columns} FROM storyboard_items
                WHERE episode_id = $1
                ORDER BY sort_order ASC
                LIMIT $2 OFFSET $3
                """,
                episode_id, limit, offset
            )
        return await db.fetch(
            f"SELECT {select_columns} FROM storyboard_items WHERE episode_id = $1 ORDER BY sort_order ASC",
            episode_id
        )

    @staticmethod
    async def count_by_episode(episode_id: str, script_id: Optional[str] = None) -> int:
        db = get_db_manager()
        if not db:
            return 0
        if script_id:
            value = await db.fetchval(
                "SELECT COUNT(*) FROM storyboard_items WHERE episode_id = $1 AND script_id = $2",
                episode_id, script_id
            )
        else:
            value = await db.fetchval(
                "SELECT COUNT(*) FROM storyboard_items WHERE episode_id = $1",
                episode_id
            )
        return int(value or 0)

    @staticmethod
    async def update(item_id: str, **kwargs) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        allowed = {
            'sort_order', 'scene_heading', 'action_text', 'dialogue',
            'camera_movement', 'image_prompt', 'video_prompt',
            'generated_image_url', 'status',
            'dialogue_audio_url', 'narration_audio_url', 'sfx_audio_url',
            'audio_duration_ms', 'planned_duration_ms',
            'mixed_audio_url', 'mixed_audio_hash',  # Task 2: backend audio mix cache
            # 2026-05-29 三步生成新增字段
            'script_segment_id', 'source_video_shot_no', 'video_script_block',
            'shot_size', 'camera_angle',
        }
        nullable_fields = {
            'dialogue_audio_url',
            'narration_audio_url',
            'sfx_audio_url',
            'audio_duration_ms',
            'planned_duration_ms',
            'mixed_audio_url',
            'mixed_audio_hash',
        }
        json_fields = {'bound_assets'}
        sets, vals, idx = [], [], 1
        for key, val in kwargs.items():
            if key in allowed and (val is not None or key in nullable_fields):
                sets.append(f"{key} = ${idx}")
                vals.append(val)
                idx += 1
            elif key in json_fields and val is not None:
                sets.append(f"{key} = ${idx}::jsonb")
                vals.append(json.dumps(val, ensure_ascii=False))
                idx += 1
        if not sets:
            return await StoryboardDAO.get_by_id(item_id)
        vals.append(item_id)
        query = f"UPDATE storyboard_items SET {', '.join(sets)} WHERE item_id = ${idx} RETURNING *"
        return await db.fetchrow(query, *vals)

    @staticmethod
    async def reorder(episode_id: str, item_ids: List[str]) -> bool:
        db = get_db_manager()
        if not db:
            return False
        try:
            async with db.acquire() as conn:
                for order, iid in enumerate(item_ids):
                    await conn.execute(
                        "UPDATE storyboard_items SET sort_order = $1 WHERE item_id = $2 AND episode_id = $3",
                        order, iid, episode_id
                    )
            return True
        except Exception:
            return False

    @staticmethod
    async def delete(item_id: str) -> bool:
        db = get_db_manager()
        if not db:
            return False
        result = await db.execute(
            "DELETE FROM storyboard_items WHERE item_id = $1", item_id
        )
        return result == "DELETE 1"

    @staticmethod
    async def delete_by_episode(episode_id: str, script_id: Optional[str] = None) -> int:
        """一条 SQL 删除该集的所有分镜，返回删除数量"""
        db = get_db_manager()
        if not db:
            return 0
        if script_id:
            result = await db.execute(
                "DELETE FROM storyboard_items WHERE episode_id = $1 AND script_id = $2",
                episode_id, script_id
            )
        else:
            result = await db.execute(
                "DELETE FROM storyboard_items WHERE episode_id = $1", episode_id
            )
        try:
            return int(result.split()[-1])
        except Exception:
            return 0
