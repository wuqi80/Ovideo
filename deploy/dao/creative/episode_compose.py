# -*- coding: utf-8 -*-
"""DAO helpers for episode final-video composition."""
from __future__ import annotations

import json
from typing import Any, Dict, List

from db_manager import get_db_manager


class EpisodeComposeDAO:
    @staticmethod
    async def list_shot_take_rows(episode_id: str) -> List[Dict[str, Any]]:
        db = get_db_manager()
        rows = await db.fetch(
            """
            SELECT si.item_id, si.sort_order,
                   si.scene_heading, si.dialogue,
                   si.mixed_audio_url AS audio_url,
                   si.dialogue_audio_url, si.narration_audio_url, si.sfx_audio_url,
                   si.audio_segments,
                   COALESCE(si.audio_duration_ms,0) AS audio_ms,
                   vs.segment_id, vs.video_url, vs.created_at,
                   f.thumbnail_url
            FROM storyboard_items si
            JOIN video_segments vs
              ON vs.storyboard_item_id = si.item_id
             AND vs.video_url IS NOT NULL
            LEFT JOIN files f
              ON f.file_url = split_part(vs.video_url, '?', 1)
            WHERE si.episode_id = $1
            ORDER BY si.sort_order, vs.created_at DESC
            """,
            episode_id,
        )
        return [dict(row) for row in rows]

    @staticmethod
    async def list_audio_tracks(episode_id: str) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        rows = await db.fetch(
            """
            SELECT track_id, track_type, name, audio_url, duration_ms,
                   generation_params
            FROM audio_tracks
            WHERE episode_id = $1
              AND track_type IN ('bgm', 'sfx_global')
              AND audio_url IS NOT NULL
            ORDER BY created_at ASC
            """,
            episode_id,
        )
        return [dict(row) for row in rows]

    @staticmethod
    async def create_final_cut_records(
        *,
        file_id: str,
        library_item_id: str,
        user_id: str,
        project_id: str,
        episode_id: str,
        file_name: str,
        file_path: str,
        file_url: str,
        file_size_bytes: int,
        duration_seconds: float,
        title: str,
        metadata: Dict[str, Any],
    ) -> None:
        db = get_db_manager()
        if not db.pool:
            await db.connect()

        async with db.pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    """
                    INSERT INTO files (
                        file_id, user_id, file_type, file_name, file_path,
                        file_url, file_size_bytes, mime_type, duration_seconds,
                        entity_type, entity_id, metadata, created_at
                    )
                    VALUES (
                        $1,$2,'video',$3,$4,$5,$6,'video/mp4',$7,
                        'episode',$8,$9::jsonb,now()
                    )
                    """,
                    file_id,
                    user_id,
                    file_name,
                    file_path,
                    file_url,
                    file_size_bytes,
                    duration_seconds,
                    episode_id,
                    json.dumps(metadata or {}, ensure_ascii=False),
                )

                await conn.execute(
                    """
                    INSERT INTO media_library_items (
                        library_item_id, file_id, user_id, item_type, source,
                        title, project_id, episode_id, created_at
                    )
                    VALUES ($1,$2,$3,'video','composed_final',$4,$5,$6,now())
                    """,
                    library_item_id,
                    file_id,
                    user_id,
                    title,
                    project_id,
                    episode_id,
                )
