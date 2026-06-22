from __future__ import annotations

import pytest

from services import episode_video_service


class FakeVideoSegmentDAO:
    rows = [
        {"segment_id": "seg_1", "episode_id": "ep_1", "sort_order": 1},
        {"segment_id": "seg_2", "episode_id": "ep_1", "sort_order": 2},
    ]
    created = None
    updated = None
    deleted = []

    @classmethod
    async def get_by_episode(cls, episode_id: str):
        return [row for row in cls.rows if row["episode_id"] == episode_id]

    @classmethod
    async def create(cls, **kwargs):
        cls.created = kwargs
        return {"segment_id": "seg_new", **kwargs}

    @classmethod
    async def update(cls, segment_id: str, **kwargs):
        cls.updated = {"segment_id": segment_id, **kwargs}
        if segment_id == "missing":
            return None
        return cls.updated

    @classmethod
    async def delete(cls, segment_id: str):
        cls.deleted.append(segment_id)
        return segment_id != "missing"


class FakeEpisodeDAO:
    project_id = "proj_1"

    @classmethod
    async def get_project_id(cls, episode_id: str):
        return cls.project_id


class FakeComposeService:
    started = None

    @staticmethod
    async def get_takes(episode_id: str):
        return [{"episode_id": episode_id, "takes": []}]

    @classmethod
    def start_compose(cls, episode_id: str, user_id: str, project_id: str, selections):
        cls.started = {
            "episode_id": episode_id,
            "user_id": user_id,
            "project_id": project_id,
            "selections": selections,
        }
        return {"status": "running", "total": 3, "done": 1}

    @staticmethod
    def get_status(episode_id: str):
        return {"status": "running", "episode_id": episode_id}


def setup_function():
    FakeVideoSegmentDAO.created = None
    FakeVideoSegmentDAO.updated = None
    FakeVideoSegmentDAO.deleted = []
    FakeEpisodeDAO.project_id = "proj_1"
    FakeComposeService.started = None


async def test_list_video_segments_returns_dict_rows():
    result = await episode_video_service.list_video_segments(
        "ep_1",
        video_segment_dao=FakeVideoSegmentDAO,
    )

    assert result["success"] is True
    assert [row["segment_id"] for row in result["segments"]] == ["seg_1", "seg_2"]


async def test_create_video_segment_passes_expected_fields():
    result = await episode_video_service.create_video_segment(
        "ep_1",
        sort_order=7,
        storyboard_item_id="shot_1",
        generation_mode="i2v",
        model="seedance",
        input_params={"duration": 5},
        video_segment_dao=FakeVideoSegmentDAO,
    )

    assert result["segment"]["segment_id"] == "seg_new"
    assert FakeVideoSegmentDAO.created == {
        "episode_id": "ep_1",
        "sort_order": 7,
        "storyboard_item_id": "shot_1",
        "generation_mode": "i2v",
        "model": "seedance",
        "input_params": {"duration": 5},
    }


async def test_update_video_segment_raises_when_missing():
    with pytest.raises(episode_video_service.VideoSegmentNotFound):
        await episode_video_service.update_video_segment(
            "missing",
            {"status": "done"},
            video_segment_dao=FakeVideoSegmentDAO,
        )


async def test_delete_video_segment_returns_success():
    result = await episode_video_service.delete_video_segment(
        "seg_1",
        video_segment_dao=FakeVideoSegmentDAO,
    )

    assert result == {"success": True}
    assert FakeVideoSegmentDAO.deleted == ["seg_1"]


async def test_start_episode_compose_uses_project_id_and_selections():
    result = await episode_video_service.start_episode_compose(
        "ep_1",
        "user_1",
        {"shot_1": "seg_1"},
        episode_dao=FakeEpisodeDAO,
        compose_service=FakeComposeService,
    )

    assert result == {"success": True, "status": "running", "total": 3, "done": 1}
    assert FakeComposeService.started == {
        "episode_id": "ep_1",
        "user_id": "user_1",
        "project_id": "proj_1",
        "selections": {"shot_1": "seg_1"},
    }


async def test_start_episode_compose_raises_when_episode_missing():
    FakeEpisodeDAO.project_id = None

    with pytest.raises(episode_video_service.EpisodeNotFound):
        await episode_video_service.start_episode_compose(
            "missing",
            "user_1",
            None,
            episode_dao=FakeEpisodeDAO,
            compose_service=FakeComposeService,
        )
