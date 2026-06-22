from __future__ import annotations

import pytest

from services import episode_service


class FakeEpisodeDAO:
    episodes = [
        {"episode_id": "ep_1", "project_id": "proj_1", "episode_number": 1, "episode_name": "第一集"},
        {"episode_id": "ep_2", "project_id": "proj_1", "episode_number": 2, "episode_name": "第二集"},
    ]
    next_number = 3
    created = []
    updated = None
    deleted = []
    reordered = None
    create_returns_none = False

    @classmethod
    async def get_episodes(cls, project_id: str):
        return [row for row in cls.episodes if row["project_id"] == project_id]

    @classmethod
    async def get_next_episode_number(cls, project_id: str):
        return cls.next_number

    @classmethod
    async def create_episode(cls, **kwargs):
        cls.created.append(kwargs)
        if cls.create_returns_none:
            return None
        return {
            "episode_id": f"ep_new_{len(cls.created)}",
            **kwargs,
        }

    @classmethod
    async def get_episode(cls, episode_id: str):
        if episode_id == "ep_source":
            return {
                "episode_id": "ep_source",
                "project_id": "proj_1",
                "episode_name": "源分集",
                "description": "desc",
                "settings": '{"fps": 24}',
            }
        return next((row for row in cls.episodes if row["episode_id"] == episode_id), None)

    @classmethod
    async def update_episode(cls, episode_id: str, **kwargs):
        cls.updated = {"episode_id": episode_id, **kwargs}
        return True

    @classmethod
    async def delete_episode(cls, episode_id: str):
        cls.deleted.append(episode_id)
        return True

    @classmethod
    async def reorder_episodes(cls, project_id: str, episode_ids: list[str]):
        cls.reordered = {"project_id": project_id, "episode_ids": episode_ids}
        return True


class FakeEpisodeScriptDAO:
    created = []

    @classmethod
    async def list_by_episode(cls, episode_id: str):
        return [
            {
                "file_name": "script-a",
                "original_content": "original",
                "adapted_script": "adapted",
                "sort_order": 0,
                "metadata": '{"tone": "warm"}',
            },
            {
                "file_name": "",
                "original_content": "",
                "adapted_script": "",
                "sort_order": None,
                "metadata": "bad-json",
            },
        ]

    @classmethod
    async def create(cls, **kwargs):
        cls.created.append(kwargs)
        return {"script_id": f"script_{len(cls.created)}", **kwargs}


def setup_function():
    FakeEpisodeDAO.created = []
    FakeEpisodeDAO.updated = None
    FakeEpisodeDAO.deleted = []
    FakeEpisodeDAO.reordered = None
    FakeEpisodeDAO.create_returns_none = False
    FakeEpisodeScriptDAO.created = []


async def test_list_episodes_returns_project_rows():
    result = await episode_service.list_episodes("proj_1", episode_dao=FakeEpisodeDAO)

    assert result["success"] is True
    assert [row["episode_id"] for row in result["episodes"]] == ["ep_1", "ep_2"]


async def test_create_episode_uses_next_number_and_default_name():
    result = await episode_service.create_episode(
        "proj_1",
        episode_name="",
        description="desc",
        episode_dao=FakeEpisodeDAO,
    )

    assert result["episode"]["episode_name"] == "第3集"
    assert FakeEpisodeDAO.created == [
        {
            "project_id": "proj_1",
            "episode_number": 3,
            "episode_name": "第3集",
            "description": "desc",
        }
    ]


async def test_get_episode_raises_when_missing():
    with pytest.raises(episode_service.EpisodeNotFound):
        await episode_service.get_episode("missing", episode_dao=FakeEpisodeDAO)


async def test_update_episode_preserves_zero_sort_order():
    result = await episode_service.update_episode(
        "ep_1",
        {
            "episode_name": None,
            "description": "",
            "status": "draft",
            "settings": {"locked": False},
            "sort_order": 0,
        },
        episode_dao=FakeEpisodeDAO,
    )

    assert result == {"success": True}
    assert FakeEpisodeDAO.updated == {
        "episode_id": "ep_1",
        "episode_name": None,
        "description": "",
        "status": "draft",
        "settings": {"locked": False},
        "sort_order": 0,
    }


async def test_delete_episode_delegates_to_dao():
    result = await episode_service.delete_episode("ep_1", episode_dao=FakeEpisodeDAO)

    assert result == {"success": True}
    assert FakeEpisodeDAO.deleted == ["ep_1"]


async def test_duplicate_episode_copies_scripts_and_metadata():
    result = await episode_service.duplicate_episode(
        "ep_source",
        episode_dao=FakeEpisodeDAO,
        episode_script_dao=FakeEpisodeScriptDAO,
    )

    assert result["success"] is True
    assert result["copied_scripts"] == 2
    assert FakeEpisodeDAO.created[0]["episode_name"] == "源分集 副本"
    assert FakeEpisodeDAO.created[0]["settings"] == {"fps": 24}
    assert FakeEpisodeScriptDAO.created[0]["metadata"] == {"tone": "warm"}
    assert FakeEpisodeScriptDAO.created[1]["file_name"] == "未命名文件"
    assert FakeEpisodeScriptDAO.created[1]["metadata"] is None


async def test_duplicate_episode_raises_when_create_fails():
    FakeEpisodeDAO.create_returns_none = True

    with pytest.raises(episode_service.EpisodeDuplicateFailed):
        await episode_service.duplicate_episode(
            "ep_source",
            episode_dao=FakeEpisodeDAO,
            episode_script_dao=FakeEpisodeScriptDAO,
        )


async def test_reorder_episodes_delegates_ids():
    result = await episode_service.reorder_episodes(
        "proj_1",
        ["ep_2", "ep_1"],
        episode_dao=FakeEpisodeDAO,
    )

    assert result == {"success": True}
    assert FakeEpisodeDAO.reordered == {"project_id": "proj_1", "episode_ids": ["ep_2", "ep_1"]}
