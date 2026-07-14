from pathlib import Path

import pytest

from services import video_voice_reference_service


class FakeEpisodeDAO:
    @staticmethod
    async def get_project_id(episode_id):
        return "proj_1" if episode_id == "ep_1" else None


class FakeVideoVoiceReferenceDAO:
    last_upsert = None

    @classmethod
    async def upsert(cls, **kwargs):
        cls.last_upsert = kwargs
        return {
            "reference_id": "vvr_1",
            **kwargs,
        }


@pytest.mark.asyncio
async def test_create_from_video_extracts_audio_and_upserts_character_reference(monkeypatch):
    async def fake_materialize(_source_url, destination):
        Path(destination).write_bytes(b"video")

    async def fake_extract(_video_path, audio_path):
        Path(audio_path).write_bytes(b"audio")

    async def fake_save_generated_file_to_db(**kwargs):
        assert kwargs["content"] == b"audio"
        assert kwargs["file_role"] == "voice_reference_audio"
        assert kwargs["entity_type"] == "video_segment"
        assert kwargs["entity_id"] == "seg_1"
        return {
            "file_id": "file_1",
            "file_url": "/storage/audio/voice-reference.mp3",
        }

    monkeypatch.setattr(video_voice_reference_service, "_materialize_video", fake_materialize)
    monkeypatch.setattr(video_voice_reference_service, "_extract_first_audio_stream", fake_extract)
    monkeypatch.setattr(
        video_voice_reference_service,
        "save_generated_file_to_db",
        fake_save_generated_file_to_db,
    )

    result = await video_voice_reference_service.create_from_video(
        project_id="proj_1",
        episode_id="ep_1",
        character_name=" 男1 ",
        source_video_url="/storage/video/take-1.mp4",
        storyboard_item_id="sb_1",
        video_segment_id="seg_1",
        video_model="Seedance2",
        user_id="user_1",
        video_voice_reference_dao=FakeVideoVoiceReferenceDAO,
        episode_dao=FakeEpisodeDAO,
    )

    assert result["success"] is True
    assert result["reference"]["reference_id"] == "vvr_1"
    assert FakeVideoVoiceReferenceDAO.last_upsert == {
        "project_id": "proj_1",
        "episode_id": "ep_1",
        "storyboard_item_id": "sb_1",
        "video_segment_id": "seg_1",
        "character_name": "男1",
        "source_video_url": "/storage/video/take-1.mp4",
        "reference_audio_url": "/storage/audio/voice-reference.mp3",
        "video_model": "Seedance2",
        "created_by": "user_1",
        "metadata": {"file_id": "file_1"},
    }


@pytest.mark.asyncio
async def test_create_from_video_rejects_episode_from_another_project():
    with pytest.raises(
        video_voice_reference_service.VideoVoiceReferenceValidationError,
        match="Episode does not belong",
    ):
        await video_voice_reference_service.create_from_video(
            project_id="proj_other",
            episode_id="ep_1",
            character_name="女1",
            source_video_url="/storage/video/take-1.mp4",
            user_id="user_1",
            video_voice_reference_dao=FakeVideoVoiceReferenceDAO,
            episode_dao=FakeEpisodeDAO,
        )


@pytest.mark.asyncio
async def test_create_from_video_surfaces_silent_video_validation(monkeypatch):
    async def fake_materialize(_source_url, destination):
        Path(destination).write_bytes(b"video")

    async def fake_extract(_video_path, _audio_path):
        raise video_voice_reference_service.VideoVoiceReferenceValidationError(
            "The selected video has no audio track"
        )

    monkeypatch.setattr(video_voice_reference_service, "_materialize_video", fake_materialize)
    monkeypatch.setattr(video_voice_reference_service, "_extract_first_audio_stream", fake_extract)

    with pytest.raises(
        video_voice_reference_service.VideoVoiceReferenceValidationError,
        match="no audio track",
    ):
        await video_voice_reference_service.create_from_video(
            project_id="proj_1",
            episode_id="ep_1",
            character_name="女1",
            source_video_url="/storage/video/silent.mp4",
            user_id="user_1",
            video_voice_reference_dao=FakeVideoVoiceReferenceDAO,
            episode_dao=FakeEpisodeDAO,
        )
