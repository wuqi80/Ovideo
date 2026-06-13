"""
集数 DAO -- episodes 表的增删改查
"""
import uuid
import json
from typing import List, Dict, Any, Optional

from db_manager import get_db_manager


class EpisodeDAO:

    @staticmethod
    async def create_episode(
        project_id: str,
        episode_number: int,
        episode_name: str = '',
        description: str = '',
        settings: dict = None,
    ) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        eid = f"ep_{uuid.uuid4().hex[:12]}"
        query = """
            INSERT INTO episodes
                (episode_id, project_id, episode_number, episode_name,
                 description, sort_order, settings)
            VALUES ($1, $2, $3, $4, $5, $3, $6)
            RETURNING *
        """
        return await db.fetchrow(
            query, eid, project_id, episode_number,
            episode_name or f'第{episode_number}集',
            description or '',
            json.dumps(settings) if settings else '{}'
        )

    @staticmethod
    async def get_episodes(project_id: str) -> List[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return []
        return await db.fetch(
            """SELECT * FROM episodes
               WHERE project_id=$1
               ORDER BY sort_order ASC, episode_number ASC""",
            project_id
        )

    @staticmethod
    async def get_episode(episode_id: str) -> Optional[Dict[str, Any]]:
        db = get_db_manager()
        if not db:
            return None
        return await db.fetchrow(
            "SELECT * FROM episodes WHERE episode_id=$1",
            episode_id
        )

    @staticmethod
    async def update_episode(
        episode_id: str,
        episode_name: str = None,
        description: str = None,
        status: str = None,
        settings: dict = None,
        sort_order: int = None,
    ) -> bool:
        db = get_db_manager()
        if not db:
            return False
        sets = []
        args = []
        idx = 1
        if episode_name is not None:
            sets.append(f"episode_name=${idx}")
            args.append(episode_name)
            idx += 1
        if description is not None:
            sets.append(f"description=${idx}")
            args.append(description)
            idx += 1
        if status is not None:
            sets.append(f"status=${idx}")
            args.append(status)
            idx += 1
        if settings is not None:
            sets.append(f"settings=${idx}")
            args.append(json.dumps(settings))
            idx += 1
        if sort_order is not None:
            sets.append(f"sort_order=${idx}")
            args.append(sort_order)
            idx += 1
        if not sets:
            return True
        args.append(episode_id)
        await db.execute(
            f"UPDATE episodes SET {', '.join(sets)} WHERE episode_id=${idx}",
            *args
        )
        return True

    @staticmethod
    async def delete_episode(episode_id: str) -> bool:
        db = get_db_manager()
        if not db:
            return False
        await db.execute(
            "DELETE FROM episodes WHERE episode_id=$1",
            episode_id
        )
        return True

    @staticmethod
    async def get_next_episode_number(project_id: str) -> int:
        db = get_db_manager()
        if not db:
            return 1
        val = await db.fetchval(
            "SELECT COALESCE(MAX(episode_number), 0) + 1 FROM episodes WHERE project_id=$1",
            project_id
        )
        return val or 1

    @staticmethod
    async def reorder_episodes(project_id: str, episode_ids: List[str]) -> bool:
        db = get_db_manager()
        if not db:
            return False
        for i, eid in enumerate(episode_ids):
            await db.execute(
                "UPDATE episodes SET sort_order=$1 WHERE episode_id=$2 AND project_id=$3",
                i, eid, project_id
            )
        return True
