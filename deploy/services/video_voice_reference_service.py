"""Extract and persist a stable character voice reference from a generated video."""
from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any, Dict, Optional

import aiohttp

from file_service import save_generated_file_to_db
from utils.net_guard import assert_public_http_url, safe_storage_path


_DEPLOY_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class VideoVoiceReferenceError(RuntimeError):
    pass


class VideoVoiceReferenceValidationError(VideoVoiceReferenceError):
    pass


async def _materialize_video(source_url: str, destination: str) -> None:
    clean_url = (source_url or "").split("?", 1)[0]
    if clean_url.startswith("/storage/"):
        shutil.copy2(safe_storage_path(clean_url, _DEPLOY_ROOT), destination)
        return
    if not clean_url.startswith(("http://", "https://")):
        raise VideoVoiceReferenceValidationError("Unsupported source video URL")
    assert_public_http_url(clean_url)
    timeout = aiohttp.ClientTimeout(total=120, connect=15)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(clean_url) as response:
            response.raise_for_status()
            with open(destination, "wb") as output:
                async for chunk in response.content.iter_chunked(128 * 1024):
                    output.write(chunk)


async def _extract_first_audio_stream(video_path: str, audio_path: str) -> None:
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise VideoVoiceReferenceError("Server media tools are unavailable (ffmpeg/ffprobe)")

    probe = await asyncio.create_subprocess_exec(
        "ffprobe",
        "-v", "error",
        "-select_streams", "a:0",
        "-show_entries", "stream=codec_type",
        "-of", "csv=p=0",
        video_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _stderr = await probe.communicate()
    if probe.returncode != 0 or "audio" not in stdout.decode("utf-8", "ignore").lower():
        raise VideoVoiceReferenceValidationError("The selected video has no audio track")

    proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-y",
        "-loglevel", "error",
        "-i", video_path,
        "-map", "0:a:0",
        "-vn",
        "-codec:a", "libmp3lame",
        "-b:a", "192k",
        audio_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _stdout, stderr = await proc.communicate()
    if proc.returncode != 0 or not Path(audio_path).is_file():
        raise VideoVoiceReferenceError(
            f"Failed to extract video audio: {stderr.decode('utf-8', 'ignore')[:300]}"
        )


async def create_from_video(
    *,
    project_id: str,
    episode_id: str,
    character_name: str,
    source_video_url: str,
    user_id: str,
    video_voice_reference_dao: Any,
    episode_dao: Any,
    storyboard_item_id: Optional[str] = None,
    video_segment_id: Optional[str] = None,
    video_model: Optional[str] = None,
) -> Dict[str, Any]:
    normalized_character = (character_name or "").strip()
    if not normalized_character:
        raise VideoVoiceReferenceValidationError("Character name is required")
    if not source_video_url:
        raise VideoVoiceReferenceValidationError("Source video URL is required")
    actual_project_id = await episode_dao.get_project_id(episode_id)
    if not actual_project_id or actual_project_id != project_id:
        raise VideoVoiceReferenceValidationError("Episode does not belong to the project")

    with tempfile.TemporaryDirectory(prefix="video_voice_reference_") as tmpdir:
        video_path = os.path.join(tmpdir, "source.mp4")
        audio_path = os.path.join(tmpdir, "voice_reference.mp3")
        await _materialize_video(source_video_url, video_path)
        await _extract_first_audio_stream(video_path, audio_path)
        saved = await save_generated_file_to_db(
            content=Path(audio_path).read_bytes(),
            file_type="audio",
            user_id=user_id,
            source="video_voice_reference",
            entity_type="video_segment" if video_segment_id else "storyboard_item",
            entity_id=video_segment_id or storyboard_item_id,
            file_role="voice_reference_audio",
            original_ext=".mp3",
            project_id=project_id,
            episode_id=episode_id,
            extra_metadata={
                "character_name": normalized_character,
                "source_video_url": source_video_url,
                "video_model": video_model,
            },
        )

    row = await video_voice_reference_dao.upsert(
        project_id=project_id,
        episode_id=episode_id,
        storyboard_item_id=storyboard_item_id,
        video_segment_id=video_segment_id,
        character_name=normalized_character,
        source_video_url=source_video_url,
        reference_audio_url=saved["file_url"],
        video_model=video_model,
        created_by=user_id,
        metadata={"file_id": saved.get("file_id")},
    )
    if not row:
        raise VideoVoiceReferenceError("Failed to save video voice reference")
    return {"success": True, "reference": dict(row)}
