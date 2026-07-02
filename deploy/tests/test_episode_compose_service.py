from datetime import datetime
from pathlib import Path

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
            "audio_urls": ["/storage/audio/one.mp3"],
            "audio_ms": 1000,
        },
        {
            "video_url": "/storage/video/two.mp4",
            "audio_url": None,
            "audio_urls": [],
            "audio_ms": 0,
        },
    ]


@pytest.mark.asyncio
async def test_get_shots_falls_back_to_storyboard_audio_parts_when_mixed_missing(monkeypatch):
    async def fake_rows(_episode_id):
        return [
            {
                "item_id": "shot_1",
                "sort_order": 1,
                "scene_heading": "",
                "dialogue": "",
                "audio_url": None,
                "dialogue_audio_url": "/storage/audio/dialogue.mp3",
                "narration_audio_url": "/storage/audio/narration.mp3",
                "sfx_audio_url": "/storage/audio/sfx.mp3",
                "audio_ms": 3200,
                "segment_id": "seg_1",
                "video_url": "/storage/video/one.mp4",
                "thumbnail_url": None,
                "created_at": None,
            },
        ]

    monkeypatch.setattr(episode_compose_service.EpisodeComposeDAO, "list_shot_take_rows", fake_rows)

    shots = await episode_compose_service._get_shots("ep_1")

    assert shots == [
        {
            "video_url": "/storage/video/one.mp4",
            "audio_url": "/storage/audio/dialogue.mp3",
            "audio_urls": [
                "/storage/audio/dialogue.mp3",
                "/storage/audio/narration.mp3",
                "/storage/audio/sfx.mp3",
            ],
            "audio_ms": 3200,
        },
    ]


@pytest.mark.asyncio
async def test_compose_mixes_multiple_storyboard_audio_parts(monkeypatch, tmp_path):
    storage = tmp_path / "storage"
    video = storage / "video" / "one.mp4"
    dialogue = storage / "audio" / "dialogue.mp3"
    narration = storage / "audio" / "narration.mp3"
    sfx = storage / "audio" / "sfx.mp3"
    for path in (video, dialogue, narration, sfx):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"x")

    commands = []

    async def fake_run(cmd):
        commands.append(cmd)
        output_path = cmd[-1]
        if output_path.endswith(".mp4"):
            Path(output_path).parent.mkdir(parents=True, exist_ok=True)
            Path(output_path).write_bytes(b"video")
        return 0, "", ""

    async def fake_probe(_path):
        return 3.2

    async def fake_get_shots(_episode_id, _selections=None):
        return [
            {
                "video_url": "/storage/video/one.mp4",
                "audio_url": "/storage/audio/dialogue.mp3",
                "audio_urls": [
                    "/storage/audio/dialogue.mp3",
                    "/storage/audio/narration.mp3",
                    "/storage/audio/sfx.mp3",
                ],
                "audio_ms": 3200,
            }
        ]

    async def fake_create_final_cut_records(**_kwargs):
        return None

    monkeypatch.setattr(episode_compose_service, "_STORAGE", str(storage))
    monkeypatch.setattr(episode_compose_service, "_ensure_media_tools", lambda: None)
    monkeypatch.setattr(episode_compose_service, "_run", fake_run)
    monkeypatch.setattr(episode_compose_service, "_probe_dur", fake_probe)
    monkeypatch.setattr(episode_compose_service, "_get_shots", fake_get_shots)
    monkeypatch.setattr(episode_compose_service.EpisodeComposeDAO, "create_final_cut_records", fake_create_final_cut_records)

    job = {}
    await episode_compose_service._compose("ep_1", "user_1", "proj_1", job)

    clip_cmd = commands[0]
    filter_arg = clip_cmd[clip_cmd.index("-filter_complex") + 1]
    assert "amix=inputs=3" in filter_arg
    assert "-i" in clip_cmd
    assert str(dialogue) in clip_cmd
    assert str(narration) in clip_cmd
    assert str(sfx) in clip_cmd
    assert job["status"] == "done"


@pytest.mark.asyncio
async def test_compose_reports_missing_ffmpeg_tools_before_processing(monkeypatch):
    monkeypatch.setattr(episode_compose_service.shutil, "which", lambda _name: None)

    async def fail_get_shots(*_args, **_kwargs):
        pytest.fail("compose should validate ffmpeg tools before loading shots")

    monkeypatch.setattr(episode_compose_service, "_get_shots", fail_get_shots)

    with pytest.raises(RuntimeError, match="ffmpeg.*ffprobe"):
        await episode_compose_service._compose("ep_1", "user_1", "proj_1", {})
