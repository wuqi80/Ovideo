from datetime import datetime

import pytest

from services import episode_compose_service


@pytest.mark.asyncio
async def test_get_takes_groups_video_segments_and_dedupes_join_rows(monkeypatch):
    async def fake_rows(_episode_id):
        created = datetime(2026, 6, 22, 12, 0, 0)
        return [
            {
                "item_id": "shot_1",
                "sort_order": 1,
                "scene_heading": "Scene",
                "dialogue": "Line",
                "audio_url": "/storage/audio/a.mp3",
                "audio_ms": 1200,
                "segment_id": "seg_new",
                "video_url": "/storage/video/new.mp4",
                "thumbnail_url": "/storage/thumb/new.jpg",
                "created_at": created,
            },
            {
                "item_id": "shot_1",
                "sort_order": 1,
                "scene_heading": "Scene",
                "dialogue": "Line",
                "audio_url": "/storage/audio/a.mp3",
                "audio_ms": 1200,
                "segment_id": "seg_new",
                "video_url": "/storage/video/new.mp4",
                "thumbnail_url": "/storage/thumb/duplicate.jpg",
                "created_at": created,
            },
            {
                "item_id": "shot_1",
                "sort_order": 1,
                "scene_heading": "Scene",
                "dialogue": "Line",
                "audio_url": "/storage/audio/a.mp3",
                "audio_ms": 1200,
                "segment_id": "seg_old",
                "video_url": "/storage/video/old.mp4",
                "thumbnail_url": "/storage/thumb/old.jpg",
                "created_at": None,
            },
        ]

    monkeypatch.setattr(episode_compose_service.EpisodeComposeDAO, "list_shot_take_rows", fake_rows)

    shots = await episode_compose_service.get_takes("ep_1")

    assert len(shots) == 1
    assert shots[0]["item_id"] == "shot_1"
    assert shots[0]["audio_url"] == "/storage/audio/a.mp3"
    assert [take["segment_id"] for take in shots[0]["takes"]] == ["seg_new", "seg_old"]
    assert shots[0]["takes"][0]["created_at"] == "2026-06-22T12:00:00"


@pytest.mark.asyncio
async def test_get_shots_uses_selected_take_with_latest_default(monkeypatch):
    async def fake_rows(_episode_id):
        return [
            {
                "item_id": "shot_1",
                "sort_order": 1,
                "scene_heading": "",
                "dialogue": "",
                "audio_url": "/storage/audio/one.mp3",
                "audio_ms": 1000,
                "segment_id": "seg_latest",
                "video_url": "/storage/video/latest.mp4",
                "thumbnail_url": None,
                "created_at": None,
            },
            {
                "item_id": "shot_1",
                "sort_order": 1,
                "scene_heading": "",
                "dialogue": "",
                "audio_url": "/storage/audio/one.mp3",
                "audio_ms": 1000,
                "segment_id": "seg_selected",
                "video_url": "/storage/video/selected.mp4",
                "thumbnail_url": None,
                "created_at": None,
            },
            {
                "item_id": "shot_2",
                "sort_order": 2,
                "scene_heading": "",
                "dialogue": "",
                "audio_url": None,
                "audio_ms": 0,
                "segment_id": "seg_two",
                "video_url": "/storage/video/two.mp4",
                "thumbnail_url": None,
                "created_at": None,
            },
        ]

    monkeypatch.setattr(episode_compose_service.EpisodeComposeDAO, "list_shot_take_rows", fake_rows)

    shots = await episode_compose_service._get_shots("ep_1", {"shot_1": "seg_selected"})

    assert shots == [
        {
            "video_url": "/storage/video/selected.mp4",
            "audio_url": "/storage/audio/one.mp3",
            "audio_ms": 1000,
        },
        {
            "video_url": "/storage/video/two.mp4",
            "audio_url": None,
            "audio_ms": 0,
        },
    ]
