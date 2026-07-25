from __future__ import annotations

import pytest

from services.video_enhancement_service import (
    build_video_upscale_workflow,
    build_video_voice_workflow,
    normalize_video_resolution,
    prepare_video_upscale_task,
    prepare_video_voice_task,
)


@pytest.mark.parametrize(
    ("value", "expected"),
    [("720p", 720), ("1080P", 1080), ("2K", 1440), ("4K", 2160), (None, 1080)],
)
def test_normalize_video_resolution(value, expected):
    assert normalize_video_resolution(value) == expected


def test_upscale_workflow_uses_seedvr2_and_preserves_audio():
    workflow = build_video_upscale_workflow("clip.mp4", "1080p", 42)

    assert workflow["1"]["inputs"]["video"] == "clip.mp4"
    assert workflow["2"]["class_type"] == "SeedVR2LoadDiTModel"
    assert workflow["2"]["inputs"]["model"] == "seedvr2_ema_3b_fp8_e4m3fn.safetensors"
    assert workflow["2"]["inputs"]["blocks_to_swap"] == 0
    assert workflow["3"]["class_type"] == "SeedVR2LoadVAEModel"
    assert workflow["4"]["class_type"] == "SeedVR2VideoUpscaler"
    assert workflow["4"]["inputs"]["resolution"] == 1080
    assert workflow["4"]["inputs"]["batch_size"] == 1
    assert workflow["5"]["inputs"]["audio"] == ["1", 2]


def test_voice_workflow_replaces_all_runtime_placeholders():
    workflow = build_video_voice_workflow("clip.mp4", "voice.wav", "自然说话")
    encoded = str(workflow)

    assert "{video}" not in encoded
    assert "{Audio}" not in encoded
    assert "{prompt_AU}" not in encoded
    assert workflow["271"]["inputs"]["video"] == "clip.mp4"
    assert workflow["288"]["inputs"]["audio"] == "voice.wav"
    assert workflow["135"]["inputs"]["positive_prompt"] == "自然说话"


class FakeTaskService:
    async def resolve_agent_file(self, param, file_ref, username):
        if not file_ref:
            return None
        return {"param": param, "filename": f"resolved-{param}", "url": f"/download/{param}"}


@pytest.mark.asyncio
async def test_prepare_upscale_bypasses_ambiguous_db_workflow_template():
    data = {"video_filename": "/storage/clip.mp4", "resolution": "4K", "seed": 7}

    await prepare_video_upscale_task(data, "Yuan", FakeTaskService())

    assert data["workflow_name"] == "viedo_upscaler"
    assert data["workflow_json"]["2"]["class_type"] == "SeedVR2LoadDiTModel"
    assert data["workflow_json"]["4"]["inputs"]["resolution"] == 2160
    assert data["agent_files"][0]["param"] == "video_filename"


@pytest.mark.asyncio
async def test_prepare_voice_resolves_video_audio_and_reference_image():
    data = {
        "image_path": "/storage/frame.webp",
        "video_filename": "/storage/clip.mp4",
        "audio_filename": "/storage/voice.wav",
        "prompt_AU": "自然说话",
    }

    await prepare_video_voice_task(data, "Yuan", FakeTaskService())

    assert data["workflow_name"] == "video_infinitetalk"
    assert {item["param"] for item in data["agent_files"]} == {
        "image_path",
        "video_filename",
        "audio_filename",
    }
    assert data["workflow_json"]["271"]["inputs"]["video"] == "resolved-video_filename"
    assert data["workflow_json"]["288"]["inputs"]["audio"] == "resolved-audio_filename"
    assert data["seed"] >= 0
