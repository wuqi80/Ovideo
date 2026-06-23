from pathlib import Path

import pytest

from services.audio_generation_service import attach_local_generated_audio_file


class _Logger:
    warnings = []

    @classmethod
    def warning(cls, *args, **kwargs):
        cls.warnings.append((args, kwargs))


@pytest.fixture(autouse=True)
def _reset_logger():
    _Logger.warnings = []


@pytest.mark.asyncio
async def test_attach_local_generated_audio_file_saves_file_and_syncs_media(tmp_path: Path):
    audio_path = tmp_path / "sample.mp3"
    audio_path.write_bytes(b"audio-bytes")
    save_calls = []
    media_calls = []

    async def fake_save(**kwargs):
        save_calls.append(kwargs)
        return {"file_id": "file_1", "file_url": "/storage/audio/file_1.mp3"}

    async def fake_media(**kwargs):
        media_calls.append(kwargs)

    result = await attach_local_generated_audio_file(
        {"audio_url": "/uploads/audio/sample.mp3", "duration_ms": 123},
        audio_upload_dir=tmp_path,
        user_id="yuan",
        source="minimax",
        entity_type="storyboard",
        entity_id="shot_1",
        file_role="dialogue_audio",
        episode_id="ep_1",
        media_source="generated_audio_minimax",
        title="short title",
        logger=_Logger,
        save_generated_file_to_db=fake_save,
        create_media_library_item=fake_media,
    )

    assert result == {
        "audio_url": "/uploads/audio/sample.mp3",
        "duration_ms": 123,
        "file_id": "file_1",
        "file_url": "/storage/audio/file_1.mp3",
    }
    assert save_calls[0]["content"] == b"audio-bytes"
    assert save_calls[0]["file_type"] == "audio"
    assert save_calls[0]["source"] == "minimax"
    assert save_calls[0]["file_role"] == "dialogue_audio"
    assert save_calls[0]["original_ext"] == ".mp3"
    assert save_calls[0]["episode_id"] == "ep_1"
    assert media_calls[0]["file_record"] == {"file_id": "file_1", "file_url": "/storage/audio/file_1.mp3"}
    assert media_calls[0]["source"] == "generated_audio_minimax"
    assert media_calls[0]["title"] == "short title"


@pytest.mark.asyncio
async def test_attach_local_generated_audio_file_uses_basename_and_ignores_missing_file(tmp_path: Path):
    save_called = False

    async def fake_save(**_kwargs):
        nonlocal save_called
        save_called = True
        return {}

    result = await attach_local_generated_audio_file(
        {"audio_url": "https://cdn.example.com/path/missing.mp3"},
        audio_upload_dir=tmp_path,
        user_id="yuan",
        source="gemini",
        entity_type=None,
        entity_id=None,
        file_role="dialogue_audio",
        episode_id=None,
        media_source="generated_audio_gemini_speech",
        title=None,
        logger=_Logger,
        save_generated_file_to_db=fake_save,
        create_media_library_item=None,
    )

    assert result == {"audio_url": "https://cdn.example.com/path/missing.mp3"}
    assert save_called is False
    assert _Logger.warnings


@pytest.mark.asyncio
async def test_attach_local_generated_audio_file_keeps_result_when_save_or_media_fails(tmp_path: Path):
    audio_path = tmp_path / "sample.wav"
    audio_path.write_bytes(b"audio-bytes")

    async def broken_save(**_kwargs):
        raise RuntimeError("db down")

    result = await attach_local_generated_audio_file(
        {"audio_url": "/audio/sample.wav"},
        audio_upload_dir=tmp_path,
        user_id="yuan",
        source="minimax",
        entity_type=None,
        entity_id=None,
        file_role="sfx_audio",
        episode_id=None,
        media_source="generated_audio_minimax_sfx",
        title=None,
        logger=_Logger,
        save_generated_file_to_db=broken_save,
        create_media_library_item=None,
    )

    assert result == {"audio_url": "/audio/sample.wav"}
    assert _Logger.warnings

    async def fake_save(**_kwargs):
        return {"file_id": "file_2", "file_url": "/storage/audio/file_2.wav"}

    async def broken_media(**_kwargs):
        raise RuntimeError("media down")

    result = await attach_local_generated_audio_file(
        {"audio_url": "/audio/sample.wav"},
        audio_upload_dir=tmp_path,
        user_id="yuan",
        source="minimax",
        entity_type=None,
        entity_id=None,
        file_role="sfx_audio",
        episode_id=None,
        media_source="generated_audio_minimax_sfx",
        title=None,
        logger=_Logger,
        save_generated_file_to_db=fake_save,
        create_media_library_item=broken_media,
    )

    assert result["file_id"] == "file_2"
    assert result["file_url"] == "/storage/audio/file_2.wav"
